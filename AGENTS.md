# Using @particle-academy/fancy-schema — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm install @particle-academy/fancy-schema
```

The scoped npm name is not published yet. Until it is, install from the git tag:

```bash
npm install github:Particle-Academy/fancy-schema#v0.2.1
```

- **Node:** `>=22`. No runtime dependencies.
- ESM and CJS builds; types included.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). fancy-schema is not yet listed there; it appears once
the npm name is published. Find it then with `search-backend-packages`
(stack `node`) and `check-versions`.

## API essentials

```ts
import { compile, validate } from "@particle-academy/fancy-schema";

validate(schema, value)   // -> { valid, errors }
compile(schema)           // -> (value) => { valid, errors }; reuse it across documents
```

Each `ValidationError` carries `instancePath` (RFC 6901 pointer to the failing
value), `schemaPath` (pointer to the rejecting keyword), `keyword`, `message`
and an optional `detail` (the missing key, the unexpected property, the count).

Supported keywords are listed in the README under "What it supports".

## Traps

- **An unresolvable `$ref` fails validation.** It is never skipped.
- **Unknown keywords are ignored**, never failed (`$schema`, `$id`, `title`,
  any vocabulary not implemented).
- **No `format` assertion** and no custom keywords. A schema relying on
  `format` to reject values will accept them.
- **No remote `$ref` fetching.** Bundle schemas into one document with `$defs`.
- **`if` alone constrains nothing**; a failing `if` selects `else`.
- **Every missing required property is reported**, not just the first.
- **String lengths count code points**, so `maxLength: 1` accepts one emoji.
- **Git-tag installs in CI:** npm records a `github:` dependency in the lockfile
  as `git+ssh://git@github.com/...`, so `npm ci` on a runner without an SSH key
  can fail. Rewrite the URL first:

  ```bash
  git config --global url."https://github.com/".insteadOf ssh://git@github.com/
  ```
