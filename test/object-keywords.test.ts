import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type Schema } from "../src/index.ts";

/*
 * `propertyNames`, `patternProperties`, `minProperties` / `maxProperties` — and
 * the regex-compilation bug that implementing them surfaced.
 *
 * Requested by Prism with measured evidence rather than a wish: their
 * `cases.schema.json` uses the first three in six places, and against the 24
 * corpus documents this validator was wrong in BOTH directions before they
 * existed.
 *
 *   - Too LENIENT on their `skip` maps. An unimplemented keyword is ignored, so
 *     `skip: {}` and `skip: {"ruby": "…"}` both passed. A skip map is how a
 *     corpus row claims a per-language exemption, so an empty one claims an
 *     exemption and exempts nothing, and `ruby` exempts a language the corpus
 *     does not have. That is the exact failure class the validator exists to
 *     catch, recreated inside it.
 *   - Too STRICT on their span attributes. Ignoring `patternProperties` left
 *     dynamic keys unmatched, and `additionalProperties: false` then rejected
 *     them — so a CORRECT document failed. Ignoring a keyword is safe for
 *     assertions and is NOT safe for anything `additionalProperties` consults.
 *
 * That asymmetry is the lesson worth keeping: "unknown keywords are ignored" is
 * a sound default only where the keyword would have ADDED a constraint. Where
 * another keyword reads its result, silence changes the answer.
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

test("minProperties / maxProperties count keys", () => {
  // Prism's `$defs/expectation` and both `skip` maps: non-empty is the whole
  // assertion, and `required` cannot express it because the keys are open.
  bad({ type: "object", minProperties: 1 }, {});
  ok({ type: "object", minProperties: 1 }, { a: 1 });
  ok({ type: "object", minProperties: 0 }, {});

  bad({ type: "object", maxProperties: 1 }, { a: 1, b: 2 });
  ok({ type: "object", maxProperties: 2 }, { a: 1, b: 2 });

  // Only objects are counted. A string of two characters is not two properties.
  ok({ minProperties: 5 }, "ab");
});

test("minProperties names the keyword and the count", () => {
  const [e] = bad({ type: "object", minProperties: 2 }, { a: 1 });
  assert.equal(e.keyword, "minProperties");
  assert.match(e.message, /1/);
  assert.match(e.message, /2/);
});

test("propertyNames validates each KEY as a value", () => {
  const schema: Schema = {
    type: "object",
    propertyNames: { enum: ["php", "ts", "py"] },
  };

  ok(schema, { php: "x", ts: "y" });
  ok(schema, {});
  bad(schema, { ruby: "unsupported" });
});

test("propertyNames points the error at the offending key", () => {
  // The key IS the failing thing, so the pointer has to name it. An error at
  // the object's own path makes the caller hunt for which key was wrong.
  const [e] = bad({ propertyNames: { enum: ["php"] } }, { ruby: 1 });
  assert.equal(e.instancePath, "/ruby");
  assert.match(e.schemaPath, /propertyNames/);
});

test("propertyNames composes with maxLength and pattern, as keys are strings", () => {
  ok({ propertyNames: { maxLength: 3 } }, { abc: 1 });
  bad({ propertyNames: { maxLength: 3 } }, { abcd: 1 });
  ok({ propertyNames: { pattern: "^span\\." } }, { "span.tool": 1 });
  bad({ propertyNames: { pattern: "^span\\." } }, { tool: 1 });
});

test("patternProperties validates the values of matching keys", () => {
  const schema: Schema = {
    type: "object",
    patternProperties: { "^span\\.": { type: "number" } },
  };

  ok(schema, { "span.quota": 1 });
  bad(schema, { "span.quota": "not a number" });
  // A key that matches nothing is simply not constrained by this keyword.
  ok(schema, { unrelated: "anything" });
});

test("a patternProperties match SATISFIES additionalProperties: false", () => {
  // THE false-rejection fix. `additionalProperties` means "not described by
  // `properties` OR `patternProperties`" — leaving the second out turns every
  // legitimate dynamic key into an intruder, which is how a correct document
  // failed.
  const schema: Schema = {
    type: "object",
    properties: { name: { type: "string" } },
    patternProperties: { "^span\\.": { type: "number" } },
    additionalProperties: false,
  };

  ok(schema, { name: "x", "span.quota": 1, "span.tool": 2 });
  // ...and it must NOT become a blanket opening.
  bad(schema, { name: "x", nope: 1 });
});

test("patternProperties and properties both apply to the same key", () => {
  // Overlap is legal and both constraints hold. Treating `properties` as a
  // short-circuit would silently drop the pattern's constraint.
  const schema: Schema = {
    properties: { "span.a": { type: "number" } },
    patternProperties: { "^span\\.": { maximum: 10 } },
  };

  ok(schema, { "span.a": 5 });
  bad(schema, { "span.a": 50 });
  bad(schema, { "span.a": "five" });
});

/*
 * The regex bug. Prism flagged it in their own patch; it was ALREADY LIVE in
 * the shipped `pattern` keyword, which compiled with the `u` flag too.
 *
 * JSON Schema specifies ECMA-262 regular expressions, which are UNFLAGGED. The
 * `u` flag is stricter than the language it is supposed to implement: it makes
 * identity escapes of non-syntax characters a SyntaxError. So `\-`, `\p` and
 * `\a` are legal in a JSON Schema pattern and threw out of `validate` — a
 * crash on a valid schema, not a validation failure, which is the worst
 * possible shape for it to take.
 */

test("a legal ECMA-262 pattern that the u flag rejects does not throw", () => {
  for (const pattern of ["\\-", "\\p", "\\a", "[\\-a]", "^span\\."]) {
    assert.doesNotThrow(
      () => validate({ pattern }, "x"),
      `pattern ${JSON.stringify(pattern)} must compile unflagged`,
    );
    assert.doesNotThrow(
      () => validate({ patternProperties: { [pattern]: true } }, { x: 1 }),
      `patternProperties key ${JSON.stringify(pattern)} must compile unflagged`,
    );
  }
});

test("those patterns still MATCH correctly once compiled", () => {
  // Not throwing is half of it. `\-` is an escaped hyphen, so it matches one.
  ok({ pattern: "\\-" }, "a-b");
  bad({ pattern: "\\-" }, "ab");
});

test("a genuinely invalid pattern is reported, not thrown", () => {
  // `(` is unclosed in any flavour. A schema author gets an error naming the
  // keyword rather than a SyntaxError escaping from validate().
  assert.doesNotThrow(() => validate({ pattern: "(" }, "x"));
  const [e] = bad({ pattern: "(" }, "x");
  assert.equal(e.keyword, "pattern");
  assert.match(e.message, /not a valid/i);
});

test("an invalid patternProperties key is reported, not thrown", () => {
  assert.doesNotThrow(() => validate({ patternProperties: { "(": true } }, { a: 1 }));
  const [e] = bad({ patternProperties: { "(": true } }, { a: 1 });
  assert.equal(e.keyword, "patternProperties");
  assert.match(e.message, /not a valid/i);
});

test("an unmatchable patternProperties key does not silently open additionalProperties", () => {
  // If a pattern cannot compile we report it — and we must NOT then treat every
  // key as matched, which would convert a schema error into a validation hole.
  const r = validate(
    {
      patternProperties: { "(": true },
      additionalProperties: false,
    },
    { anything: 1 },
  );
  assert.equal(r.valid, false);
});
