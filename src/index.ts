/**
 * A zero-dependency JSON Schema **Draft 2020-12** validator.
 *
 * Load a schema, validate documents, and get back errors that say WHICH
 * document and WHICH field — not just a verdict. The verdict alone moves the
 * work rather than doing it.
 *
 * Deliberately NOT here: remote `$ref` fetching over the network (a validator
 * that makes HTTP requests is a validator that fails for network reasons, and
 * the failure presents as a connectivity problem rather than a missing
 * document), compilation to generated code, and custom keyword registration.
 * Each waits for a consumer that actually asks.
 */

export type Schema = boolean | SchemaObject;

export interface SchemaObject {
  $ref?: string;
  $defs?: Record<string, Schema>;
  type?: JsonType | JsonType[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: Schema;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  not?: Schema;
  if?: Schema;
  then?: Schema;
  else?: Schema;
  /** Annotations and vocabulary we do not implement are ignored, never failed. */
  [key: string]: unknown;
}

export type JsonType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface ValidationError {
  /** RFC 6901 JSON Pointer to the failing value, e.g. `/rows/1/n`. */
  instancePath: string;
  /** Pointer to the keyword that rejected it, e.g. `#/properties/n/type`. */
  schemaPath: string;
  /** The keyword that failed. */
  keyword: string;
  /** Human-readable, one line. */
  message: string;
  /** Extra specifics — the missing key, the unexpected property, the count. */
  detail?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Guards a self-referential DOCUMENT from spinning forever. */
const MAX_DEPTH = 256;

/** RFC 6901: `~` becomes `~0` and `/` becomes `~1`, in that order. */
function escapePointer(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapePointer(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function typeOf(value: unknown): JsonType {
  if (value === null) return "null";
  // Arrays are objects in JavaScript and are NOT objects in JSON Schema.
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "number") return Number.isInteger(value) ? "integer" : "number";
  if (t === "boolean") return "boolean";
  if (t === "string") return "string";
  return "object";
}

function matchesType(value: unknown, want: JsonType): boolean {
  const got = typeOf(value);
  // Every integer is also a number; the reverse is not true.
  if (want === "number") return got === "number" || got === "integer";
  return got === want;
}

/** Structural equality, for `const` and `uniqueItems`. Key ORDER is not significant. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

interface Ctx {
  root: Schema;
  errors: ValidationError[];
  depth: number;
}

function err(ctx: Ctx, instancePath: string, schemaPath: string, keyword: string, message: string, detail?: string) {
  ctx.errors.push({ instancePath, schemaPath, keyword, message, ...(detail === undefined ? {} : { detail }) });
}

/**
 * Resolve a local `#/...` pointer against the root schema.
 *
 * Returns `undefined` when it does not resolve, and the caller FAILS on that
 * rather than skipping. An unresolvable `$ref` treated as "nothing to check"
 * reports every document as valid, which is the worst way for a validator to
 * be wrong: silent, total, and indistinguishable from success.
 */
function resolveRef(root: Schema, ref: string): Schema | undefined {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined; // remote refs are out of scope, deliberately
  let node: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const token = unescapePointer(raw);
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[token];
    if (node === undefined) return undefined;
  }
  return node as Schema;
}

function validateNode(schema: Schema, value: unknown, instancePath: string, schemaPath: string, ctx: Ctx): void {
  // A boolean IS a schema: `true` accepts anything, `false` rejects everything.
  if (schema === true) return;
  if (schema === false) {
    err(ctx, instancePath, schemaPath, "false", "schema is `false`, so no value is valid");
    return;
  }
  if (schema === null || typeof schema !== "object") return;

  if (ctx.depth > MAX_DEPTH) {
    err(ctx, instancePath, schemaPath, "depth", `exceeded maximum depth of ${MAX_DEPTH}`);
    return;
  }

  // $ref. In 2020-12 a $ref sits ALONGSIDE its siblings rather than replacing
  // them, so this does not return early.
  if (typeof schema.$ref === "string") {
    const target = resolveRef(ctx.root, schema.$ref);
    if (target === undefined) {
      err(ctx, instancePath, `${schemaPath}/$ref`, "$ref", `cannot resolve "${schema.$ref}"`, schema.$ref);
      return;
    }
    ctx.depth++;
    validateNode(target, value, instancePath, `#${schema.$ref.slice(1)}`, ctx);
    ctx.depth--;
  }

  if (schema.type !== undefined) {
    const wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!wanted.some((t) => matchesType(value, t))) {
      err(
        ctx,
        instancePath,
        `${schemaPath}/type`,
        "type",
        `expected ${wanted.join(" or ")}, got ${typeOf(value)}`,
        typeOf(value),
      );
      return; // every other keyword would now fail for the same reason
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((c) => deepEqual(c, value))) {
    err(ctx, instancePath, `${schemaPath}/enum`, "enum", `value is not one of the ${schema.enum.length} allowed`);
  }

  if ("const" in schema && !deepEqual(schema.const, value)) {
    err(ctx, instancePath, `${schemaPath}/const`, "const", `value does not equal the required constant`);
  }

  const kind = typeOf(value);

  if (kind === "string") {
    const s = value as string;
    // Unicode code points, not UTF-16 units: "🙂".length is 2 and its JSON
    // Schema length is 1, so maxLength 1 must accept it.
    const len = [...s].length;
    if (schema.minLength !== undefined && len < schema.minLength) {
      err(ctx, instancePath, `${schemaPath}/minLength`, "minLength", `shorter than ${schema.minLength}`, String(len));
    }
    if (schema.maxLength !== undefined && len > schema.maxLength) {
      err(ctx, instancePath, `${schemaPath}/maxLength`, "maxLength", `longer than ${schema.maxLength}`, String(len));
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(s)) {
      err(ctx, instancePath, `${schemaPath}/pattern`, "pattern", `does not match /${schema.pattern}/`);
    }
  }

  if (kind === "number" || kind === "integer") {
    const n = value as number;
    if (schema.minimum !== undefined && n < schema.minimum) {
      err(ctx, instancePath, `${schemaPath}/minimum`, "minimum", `less than ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && n > schema.maximum) {
      err(ctx, instancePath, `${schemaPath}/maximum`, "maximum", `greater than ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && n <= schema.exclusiveMinimum) {
      err(ctx, instancePath, `${schemaPath}/exclusiveMinimum`, "exclusiveMinimum", `not greater than ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && n >= schema.exclusiveMaximum) {
      err(ctx, instancePath, `${schemaPath}/exclusiveMaximum`, "exclusiveMaximum", `not less than ${schema.exclusiveMaximum}`);
    }
    if (schema.multipleOf !== undefined) {
      // Compare the rounded quotient rather than using `%`, which is wrong for
      // floats: 1.2 % 0.5 is 0.19999999999999996, not 0.2.
      const q = n / schema.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9) {
        err(ctx, instancePath, `${schemaPath}/multipleOf`, "multipleOf", `not a multiple of ${schema.multipleOf}`);
      }
    }
  }

  if (kind === "array") {
    const arr = value as unknown[];
    if (schema.minItems !== undefined && arr.length < schema.minItems) {
      err(ctx, instancePath, `${schemaPath}/minItems`, "minItems", `fewer than ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && arr.length > schema.maxItems) {
      err(ctx, instancePath, `${schemaPath}/maxItems`, "maxItems", `more than ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (deepEqual(arr[i], arr[j])) {
            err(ctx, `${instancePath}/${j}`, `${schemaPath}/uniqueItems`, "uniqueItems", `duplicates item ${i}`);
          }
        }
      }
    }
    if (schema.items !== undefined) {
      ctx.depth++;
      arr.forEach((item, i) => validateNode(schema.items!, item, `${instancePath}/${i}`, `${schemaPath}/items`, ctx));
      ctx.depth--;
    }
  }

  if (kind === "object") {
    const obj = value as Record<string, unknown>;

    if (schema.required !== undefined) {
      // Every missing key, not just the first — a caller fixing one at a time
      // learns about the next only on the next run.
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) {
          err(ctx, instancePath, `${schemaPath}/required`, "required", `missing required property "${key}"`, key);
        }
      }
    }

    if (schema.properties !== undefined) {
      ctx.depth++;
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          validateNode(
            sub,
            obj[key],
            `${instancePath}/${escapePointer(key)}`,
            `${schemaPath}/properties/${escapePointer(key)}`,
            ctx,
          );
        }
      }
      ctx.depth--;
    }

    if (schema.additionalProperties !== undefined) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (known.has(key)) continue;
        if (schema.additionalProperties === false) {
          // Name the property. An unknown-property failure is usually a schema
          // that never learned about a field, and you cannot tell which
          // without the key.
          err(
            ctx,
            `${instancePath}/${escapePointer(key)}`,
            `${schemaPath}/additionalProperties`,
            "additionalProperties",
            `property "${key}" is not allowed`,
            key,
          );
        } else {
          ctx.depth++;
          validateNode(
            schema.additionalProperties,
            obj[key],
            `${instancePath}/${escapePointer(key)}`,
            `${schemaPath}/additionalProperties`,
            ctx,
          );
          ctx.depth--;
        }
      }
    }
  }

  if (schema.allOf !== undefined) {
    ctx.depth++;
    schema.allOf.forEach((sub, i) => validateNode(sub, value, instancePath, `${schemaPath}/allOf/${i}`, ctx));
    ctx.depth--;
  }

  if (schema.anyOf !== undefined) {
    if (!schema.anyOf.some((sub) => branchPasses(sub, value, ctx))) {
      err(ctx, instancePath, `${schemaPath}/anyOf`, "anyOf", `matched none of the ${schema.anyOf.length} alternatives`);
    }
  }

  if (schema.oneOf !== undefined) {
    const matched = schema.oneOf.filter((sub) => branchPasses(sub, value, ctx)).length;
    if (matched !== 1) {
      err(
        ctx,
        instancePath,
        `${schemaPath}/oneOf`,
        "oneOf",
        `matched ${matched} of the ${schema.oneOf.length} alternatives, expected exactly 1`,
        String(matched),
      );
    }
  }

  if (schema.not !== undefined && branchPasses(schema.not, value, ctx)) {
    err(ctx, instancePath, `${schemaPath}/not`, "not", "value matches a schema it must not match");
  }

  // `if` is NOT an assertion. Its own failure selects `else`; it never rejects.
  // A validator that fails the `if` branch turns a no-op into a rejection.
  if (schema.if !== undefined) {
    const taken = branchPasses(schema.if, value, ctx) ? schema.then : schema.else;
    if (taken !== undefined) {
      ctx.depth++;
      validateNode(taken, value, instancePath, `${schemaPath}/${taken === schema.then ? "then" : "else"}`, ctx);
      ctx.depth--;
    }
  }
}

/** Does a sub-schema pass, without recording its errors? Used by the combinators. */
function branchPasses(schema: Schema, value: unknown, parent: Ctx): boolean {
  const probe: Ctx = { root: parent.root, errors: [], depth: parent.depth + 1 };
  validateNode(schema, value, "", "#", probe);
  return probe.errors.length === 0;
}

/** Validate one document against one schema. */
export function validate(schema: Schema, value: unknown): ValidationResult {
  const ctx: Ctx = { root: schema, errors: [], depth: 0 };
  validateNode(schema, value, "", "#", ctx);
  return { valid: ctx.errors.length === 0, errors: ctx.errors };
}

/**
 * Bind a schema once and validate many documents against it.
 *
 * This is the shape a corpus check actually wants: one schema, N documents,
 * told which ones failed and why.
 */
export function compile(schema: Schema): (value: unknown) => ValidationResult {
  return (value: unknown) => validate(schema, value);
}
