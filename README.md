# fancy-schema

A **zero-dependency JSON Schema Draft 2020-12 validator** for TypeScript and
Node. Load a schema, validate documents, and get back errors that say *which
document* and *which field* — not just a verdict.

```bash
npm install @particle-academy/fancy-schema
```

```ts
import { compile } from "@particle-academy/fancy-schema";

const check = compile({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string" } },
});

for (const [i, doc] of documents.entries()) {
  const { valid, errors } = check(doc);
  if (!valid) {
    for (const e of errors) {
      console.error(`doc ${i}${e.instancePath} — ${e.message}`);
    }
  }
}
```

```
doc 2/extra — property "extra" is not allowed
doc 3 — missing required property "id"
```

## Why this exists

The suite had no validator. The only mention of one anywhere in it was a
comment saying hosts could layer Zod or Ajv on top — the gap stated out loud.
Meanwhile `fancy-conformance` *authors* three Draft 2020-12 schemas and has
`dependencies: {}`, so the package whose entire product is holding
implementations to a standard could not assert its own fixture tables conformed
to theirs.

The third-party answer did not clear this estate's freshness bar either: `ajv`
itself is current, but it needs `ajv-formats` for `format` keywords and that
was last published in March 2024.

## What it supports

`$ref` and `$defs` (including recursive schemas) · `type` (single or union,
with `integer` distinct from `number`) · `required` · `properties` ·
`additionalProperties` · `items`, `minItems`, `maxItems`, `uniqueItems` ·
`minLength`, `maxLength`, `pattern` · `minimum`, `maximum`,
`exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` · `enum`, `const` ·
`allOf`, `anyOf`, `oneOf`, `not` · `if` / `then` / `else` · boolean schemas.

## Decisions worth knowing before you rely on it

**An unresolvable `$ref` FAILS.** It is not skipped. A validator that treats a
missing `$ref` as "nothing to check here" reports every document as valid —
silent, total, and indistinguishable from success. There is a test that fails
if this ever becomes lenient.

**Unknown keywords are ignored, never failed.** `$schema`, `$id`, `title`,
`description`, `examples`, and any vocabulary not implemented here pass
through. A validator that rejects a document because of a keyword *it* does not
know is rejecting correct documents for its own shortcoming.

**`if` is not an assertion.** A failing `if` selects `else`; it never rejects on
its own. A schema carrying only `if` constrains nothing.

**Every missing required property is reported**, not just the first — otherwise
you learn about the next one only on the next run.

**`additionalProperties: false` names the property.** That failure is usually a
schema that never learned about a field rather than a bad document, and you
cannot tell which without the key.

**Errors carry a real JSON Pointer**, RFC 6901 escaping included: a property
named `a/b` appears as `/a~1b`.

**`multipleOf` compares a rounded quotient, not `%`.** `1.2 % 0.5` is
`0.19999999999999996` in IEEE 754, so the obvious implementation rejects valid
numbers.

**String lengths count code points.** `[..."🙂"].length` is 1, not 2, so
`maxLength: 1` accepts it — which is what the spec says and what
`"🙂".length` does not give you.

## Deliberately not here

- **Remote `$ref` fetching over the network.** A validator that makes HTTP
  requests is a validator that fails for network reasons, and that failure
  presents as a connectivity problem rather than a missing document. Bundle
  your schemas into one document with `$defs`.
- **Compilation to generated code.** Correctness and legible errors first; this
  validates corpora and config, not a request hot path.
- **`format` assertion** and custom keyword registration. Both wait for a
  consumer that actually asks, rather than being guessed at now.

## API

```ts
validate(schema: Schema, value: unknown): ValidationResult
compile(schema: Schema): (value: unknown) => ValidationResult

interface ValidationResult { valid: boolean; errors: ValidationError[] }

interface ValidationError {
  instancePath: string;  // RFC 6901 pointer to the failing value
  schemaPath: string;    // pointer to the keyword that rejected it
  keyword: string;
  message: string;
  detail?: string;       // the missing key, the unexpected property, the count
}
```

## Licence

MIT.
