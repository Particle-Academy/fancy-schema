# Changelog

Notable changes to `@particle-academy/fancy-schema`, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**BREAKING** marks anything that can stop working on upgrade. This package is
pre-1.0, so breaking changes land in MINOR releases — read those entries before
upgrading.

---

## [Unreleased]

### Fixed

- **`CHANGELOG.md` is now in the published tarball.** `files` did not whitelist it, so npm never shipped it — and this package puts breaking changes in MINOR releases and tells you in the README to read the entry before taking one. The instruction existed for the author, who has the file, and not for the consumer, who is the only one being instructed. Nothing for you to do; the file simply arrives from this release on.
- Dropped `docs` from `files`: it was declared and never existed, so the package claimed to ship it and did not.

## [0.2.1] - 2026-10-02

### Fixed

- **A git install produced a package that could not be imported.** `main` and
  `exports` point into `dist/`, which is correctly gitignored, and the build ran
  only from `prepublishOnly`. **npm runs `prepare` for a git/GitHub install, not
  `prepublishOnly`** -- so `npm install github:Particle-Academy/fancy-schema#v0.2.0`
  succeeded and the subsequent import failed with ERR_MODULE_NOT_FOUND.

  That is exactly the path consumers were told to use while the scoped npm name
  waits on its bootstrap, so the package was correct for the registry and broken
  for the only install anyone could actually perform. Reported by Prism, verified
  against the tag: zero files under `dist/` at v0.2.0.

  `prepare` now runs the build. It fires on a git install AND before publish, so
  it covers both paths.

## [0.2.0] - 2026-10-02

### Added

- **`patternProperties`, `propertyNames`, `minProperties` and `maxProperties`.**
  Requested by Prism with measured evidence: their `cases.schema.json` uses the
  first three in six places, and against their 24-document corpus this validator
  was wrong in **both directions** without them.

  - **It was too LENIENT.** An unimplemented keyword is ignored, so a
    per-language skip map accepted `{}` and `{"ruby": "..."}` — one claiming an
    exemption that exempts nothing, the other exempting a language the corpus
    does not have. `required` cannot express "non-empty" when the keys are open,
    which is why `minProperties` is the keyword that closes it.
  - **It was too STRICT.** Ignoring `patternProperties` left dynamic keys
    unmatched, and `additionalProperties: false` then rejected them — so a
    CORRECT document failed. That single gap was the whole of their 23/24
    against a standards validator's 24/24.

  **The lesson, which is worth more than the keywords:** "unknown keywords are
  ignored" is a sound default only where the keyword would have ADDED a
  constraint. `patternProperties` is also an INPUT to another keyword, so
  ignoring it did not relax the schema — it inverted it. A matched key now
  satisfies `additionalProperties: false`, and a non-matching one is still
  refused.

  Verified against all seven of Prism's own cases end to end; every one now
  behaves as their standards validator does.

### Fixed

- **A valid schema could crash the validator.** `pattern` compiled with the
  `u` flag, and **`u` is stricter than the language JSON Schema specifies.**
  ECMA-262 without `u` permits an identity escape of any non-syntax character,
  so `\-`, `\p` and `\a` are legal patterns that `new RegExp(p, "u")` throws a
  `SyntaxError` on. The throw escaped `validate()` rather than returning a
  result — the worst shape for this failure, because a crash on a VALID schema
  reads as a bug in the caller's own code.

  All regexes now compile unflagged. **What you must do: nothing** — unless you
  were catching a `SyntaxError` around `validate()`, in which case that path is
  now a normal error in the result.

  Found by Prism while writing a `patternProperties` patch, who measured exactly
  which escapes differ. It was already live in shipped `pattern`.

- **An uncompilable pattern is now reported, not thrown.** `pattern: "("` is a
  defect in the *schema*, and the author is owed it as an error naming the
  keyword alongside every other finding rather than as a stack trace. An
  uncompilable `patternProperties` key matches **nothing** — treating it as
  matching everything would turn a schema defect into a silent hole in
  `additionalProperties`.

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
