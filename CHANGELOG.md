# Changelog

Notable changes to `@particle-academy/fancy-schema`, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**BREAKING** marks anything that can stop working on upgrade. This package is
pre-1.0, so breaking changes land in MINOR releases — read those entries before
upgrading.

---

## [Unreleased]

## [0.1.0] - 2026-10-01

### Added

- **A zero-dependency JSON Schema Draft 2020-12 validator.** `validate(schema,
  value)` for one document and `compile(schema)` for many — the shape a corpus
  check actually wants: one schema, N documents, told which failed and why.
- Supported: `$ref` / `$defs` including recursive schemas, `type` (single or
  union, `integer` distinct from `number`), `required`, `properties`,
  `additionalProperties`, `items` / `minItems` / `maxItems` / `uniqueItems`,
  `minLength` / `maxLength` / `pattern`, `minimum` / `maximum` /
  `exclusiveMinimum` / `exclusiveMaximum` / `multipleOf`, `enum`, `const`,
  `allOf` / `anyOf` / `oneOf` / `not`, `if` / `then` / `else`, and boolean
  schemas.
- Errors carry an RFC 6901 `instancePath` (`/rows/1/n`, with `/` and `~`
  escaped), the `schemaPath` of the keyword that rejected, the keyword name, a
  one-line message, and a `detail` naming the missing key or unexpected
  property.

### Decisions that are behaviour, not preference

- **An unresolvable `$ref` FAILS rather than being skipped.** Treating a missing
  `$ref` as "nothing to check" reports every document as valid — silent, total,
  and indistinguishable from success. A test fails if this becomes lenient.
- **Unknown keywords are ignored, never failed.** Rejecting a document over a
  keyword the validator does not implement is rejecting a correct document for
  our own shortcoming.
- **`if` is not an assertion** — a failing `if` selects `else` and never
  rejects on its own.
- **Every missing required property is reported**, not just the first.
- **`multipleOf` compares a rounded quotient, not `%`** — `1.2 % 0.5` is
  `0.19999999999999996`, so the obvious implementation rejects valid numbers.
- **String lengths count code points**, so `maxLength: 1` accepts `"🙂"`.
- No network `$ref` fetching, no codegen, no `format` assertion. Each waits for
  a consumer that asks.

### Why it exists

Prism needed exactly this, searched the registry, found nothing, and waited.
The suite's only reference to a validator was a comment in `fancy-flow` saying
hosts could layer Zod or Ajv on top — the gap stated out loud. Meanwhile
`fancy-conformance` authors three Draft 2020-12 schemas with `dependencies: {}`
and nothing that checks them, so the package whose product is holding
implementations to a standard could not assert its own fixtures conformed.

The third-party route failed this estate's freshness bar: `ajv` is current, but
needs `ajv-formats` for `format` keywords, last published 2024-03-30.
