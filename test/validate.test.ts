import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, compile, type Schema } from "../src/index.ts";

/*
 * The cases Prism's G-73 actually needs, written first.
 *
 * Their requirement, verbatim: load a Draft 2020-12 `cases.schema.json` and
 * validate 24 corpus documents, "rejecting unknown properties and wrong types
 * (also $ref, oneOf, if/then)". Each of those five is a test below, and the
 * error SHAPE is tested as hard as the verdict — a validator that says "no"
 * without saying which document and which field just moves the work.
 */

const ok = (schema: Schema, value: unknown) => {
  const r = validate(schema, value);
  assert.equal(r.valid, true, `expected valid, got: ${JSON.stringify(r.errors)}`);
};
const bad = (schema: Schema, value: unknown) => {
  const r = validate(schema, value);
  assert.equal(r.valid, false, "expected invalid, got valid");
  assert.ok(r.errors.length > 0, "invalid result must carry at least one error");
  return r.errors;
};

test("type: accepts the declared type and rejects the others", () => {
  ok({ type: "string" }, "x");
  ok({ type: "integer" }, 3);
  ok({ type: "number" }, 3.5);
  ok({ type: "boolean" }, false);
  ok({ type: "null" }, null);
  ok({ type: "array" }, []);
  ok({ type: "object" }, {});

  bad({ type: "string" }, 3);
  bad({ type: "integer" }, 3.5);
  // null is its own type, never an object. A validator that lets null through
  // `type: "object"` turns every missing value into a silently valid one.
  bad({ type: "object" }, null);
  // Arrays are objects in JavaScript and are NOT objects in JSON Schema.
  bad({ type: "object" }, []);
  bad({ type: "array" }, {});
});

test("type accepts a union", () => {
  ok({ type: ["string", "null"] }, null);
  ok({ type: ["string", "null"] }, "x");
  bad({ type: ["string", "null"] }, 1);
});

test("required: names every missing property, not just the first", () => {
  const schema: Schema = { type: "object", required: ["a", "b", "c"] };
  const errors = bad(schema, { a: 1 });
  const missing = errors.filter((e) => e.keyword === "required").map((e) => e.detail);
  assert.ok(missing.some((d) => d?.includes("b")), "should report b");
  assert.ok(missing.some((d) => d?.includes("c")), "should report c");
});

test("additionalProperties: false rejects an unknown property AND names it", () => {
  // The headline requirement. The name matters: an unknown-property failure is
  // usually a schema that never learned about a field, and you cannot tell
  // which without the key.
  const schema: Schema = {
    type: "object",
    properties: { id: { type: "string" } },
    additionalProperties: false,
  };
  ok(schema, { id: "a" });
  const errors = bad(schema, { id: "a", nope: 1 });
  assert.ok(
    errors.some((e) => e.keyword === "additionalProperties" && e.instancePath === "/nope"),
    `expected an error at /nope, got ${JSON.stringify(errors)}`,
  );
});

test("properties are only checked when present", () => {
  const schema: Schema = { type: "object", properties: { n: { type: "number" } } };
  ok(schema, {});
  bad(schema, { n: "no" });
});

test("$ref resolves against $defs, including a sibling pointer", () => {
  const schema: Schema = {
    type: "object",
    properties: { who: { $ref: "#/$defs/person" } },
    $defs: {
      person: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  };
  ok(schema, { who: { name: "ada" } });
  const errors = bad(schema, { who: { name: 1 } });
  assert.equal(errors[0]?.instancePath, "/who/name", "path must point through the ref");
});

test("$ref handles recursion without blowing the stack", () => {
  // A tree schema referring to itself is the normal case, not an exotic one.
  const schema: Schema = {
    $defs: {
      node: {
        type: "object",
        properties: { children: { type: "array", items: { $ref: "#/$defs/node" } } },
        additionalProperties: false,
      },
    },
    $ref: "#/$defs/node",
  };
  ok(schema, { children: [{ children: [] }, { children: [{ children: [] }] }] });
  bad(schema, { children: [{ nope: 1 }] });
});

test("$ref to a missing pointer FAILS LOUDLY rather than passing", () => {
  // The dangerous default. A validator that treats an unresolvable $ref as
  // "nothing to check" reports every document as valid, which is the single
  // worst way for this to be wrong.
  const schema: Schema = { $ref: "#/$defs/nothere" };
  const errors = bad(schema, { anything: true });
  assert.equal(errors[0]?.keyword, "$ref");
});

test("oneOf: exactly one, and the error says how many matched", () => {
  const schema: Schema = {
    oneOf: [
      { type: "object", properties: { kind: { const: "a" } }, required: ["kind"] },
      { type: "object", properties: { kind: { const: "b" } }, required: ["kind"] },
    ],
  };
  ok(schema, { kind: "a" });
  ok(schema, { kind: "b" });
  bad(schema, { kind: "c" }); // none match

  // TWO matching is also a failure, and it is the one people forget.
  const loose: Schema = { oneOf: [{ type: "object" }, { type: "object" }] };
  const errors = bad(loose, {});
  assert.equal(errors[0]?.keyword, "oneOf");
});

test("anyOf and allOf", () => {
  ok({ anyOf: [{ type: "string" }, { type: "number" }] }, 1);
  bad({ anyOf: [{ type: "string" }, { type: "number" }] }, true);
  ok({ allOf: [{ type: "number" }, { minimum: 2 }] }, 3);
  bad({ allOf: [{ type: "number" }, { minimum: 2 }] }, 1);
});

test("if/then/else", () => {
  const schema: Schema = {
    type: "object",
    properties: { kind: { type: "string" } },
    if: { properties: { kind: { const: "paid" } }, required: ["kind"] },
    then: { required: ["amount"] },
    else: { required: ["reason"] },
  };
  ok(schema, { kind: "paid", amount: 1 });
  bad(schema, { kind: "paid" });
  ok(schema, { kind: "free", reason: "trial" });
  bad(schema, { kind: "free" });
});

test("if WITHOUT then or else never fails on its own", () => {
  // `if` is not an assertion. A schema with only `if` constrains nothing, and
  // a validator that fails the `if` branch turns a no-op into a rejection.
  ok({ if: { type: "string" } }, 42);
});

test("enum and const", () => {
  ok({ enum: ["a", "b"] }, "b");
  bad({ enum: ["a", "b"] }, "c");
  ok({ const: 7 }, 7);
  bad({ const: 7 }, "7");
  // Deep equality, not identity.
  ok({ const: { a: [1, 2] } }, { a: [1, 2] });
  bad({ const: { a: [1, 2] } }, { a: [2, 1] });
});

test("string, number and array constraints", () => {
  ok({ type: "string", minLength: 2, maxLength: 3 }, "ab");
  bad({ type: "string", minLength: 2 }, "a");
  ok({ type: "string", pattern: "^v[0-9]+$" }, "v12");
  bad({ type: "string", pattern: "^v[0-9]+$" }, "12");

  ok({ type: "number", minimum: 1, maximum: 10 }, 10);
  bad({ type: "number", exclusiveMaximum: 10 }, 10);
  ok({ type: "number", multipleOf: 0.5 }, 1.5);
  bad({ type: "number", multipleOf: 0.5 }, 1.2);

  ok({ type: "array", items: { type: "string" }, minItems: 1 }, ["a"]);
  bad({ type: "array", items: { type: "string" } }, ["a", 1]);
  bad({ type: "array", uniqueItems: true }, [{ a: 1 }, { a: 1 }]);
});

test("booleans are schemas: true accepts anything, false rejects everything", () => {
  ok(true, { whatever: 1 });
  bad(false, 1);
  // The idiomatic way to forbid one property while allowing others.
  const schema: Schema = { type: "object", properties: { banned: false } };
  ok(schema, { other: 1 });
  bad(schema, { banned: 1 });
});

test("errors carry a JSON Pointer path and the schema path that rejected", () => {
  const schema: Schema = {
    type: "object",
    properties: { rows: { type: "array", items: { type: "object", properties: { n: { type: "integer" } } } } },
  };
  const errors = bad(schema, { rows: [{ n: 1 }, { n: "two" }] });
  const e = errors[0]!;
  assert.equal(e.instancePath, "/rows/1/n", "must point at the failing element");
  assert.equal(e.schemaPath, "#/properties/rows/items/properties/n/type");
  assert.equal(typeof e.message, "string");
});

test("a JSON Pointer path escapes / and ~ per RFC 6901", () => {
  const schema: Schema = { type: "object", properties: { "a/b": { type: "string" } } };
  const errors = bad(schema, { "a/b": 1 });
  assert.equal(errors[0]?.instancePath, "/a~1b");
});

test("compile() validates many documents against one schema", () => {
  // Prism's actual shape: one schema, 24 documents, told which ones failed.
  const check = compile({ type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } });
  const docs = [{ id: "a" }, { id: 1 }, { id: "c", extra: true }, {}];
  const results = docs.map((d) => check(d));
  assert.deepEqual(results.map((r) => r.valid), [true, false, false, false]);
});

test("validation stops at a sane depth instead of hanging", () => {
  // A self-referential DOCUMENT (not schema) must not spin forever.
  const schema: Schema = { $defs: { n: { type: "object", properties: { c: { $ref: "#/$defs/n" } } } }, $ref: "#/$defs/n" };
  const deep: Record<string, unknown> = {};
  let cur = deep;
  for (let i = 0; i < 200; i++) { const next: Record<string, unknown> = {}; cur.c = next; cur = next; }
  const r = validate(schema, deep);
  assert.equal(typeof r.valid, "boolean");
});

test("unknown keywords are ignored, not treated as failures", () => {
  // $schema, $id, title, description, examples and anything we do not implement
  // must not reject a document. A validator that fails on vocabulary it does
  // not know rejects correct documents for its own shortcoming.
  ok(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.test/x.json",
      title: "A thing",
      description: "...",
      examples: [1],
      deprecated: true,
      type: "number",
    } as Schema,
    1,
  );
});
