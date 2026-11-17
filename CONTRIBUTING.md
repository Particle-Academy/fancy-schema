# Contributing to @particle-academy/fancy-schema

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Commands

```bash
npm run build   # tsup -> dist/
npm run lint    # tsc --noEmit
npm test        # node --import tsx --test test/*.test.ts
```

`prepare` runs the build, so a git-tag install builds `dist/` on install
(`dist/` is gitignored). Keep it: v0.2.0 lacked it and imported as
`ERR_MODULE_NOT_FOUND`.

## Tests

Tests live in `test/` (`validate.test.ts`, `object-keywords.test.ts`,
`prism-corpus.test.ts`, fixtures in `test/fixtures/`). One test fails if an
unresolvable `$ref` ever becomes lenient; keep it.

## Changelog

Update `CHANGELOG.md` in the same commit as the change.
