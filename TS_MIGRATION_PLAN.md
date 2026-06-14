# TypeScript migration — `require()` → `import` + ESLint cleanup

Tracks the post-rename modernization of the (now `.ts`) backend. The mechanical
`.js`→`.ts` rename, multi-stage Docker, ts-jest, and transpile-only build are
already done and CI-green; this doc covers imports + eslint, done **in batches**.

## Strategy: import-only, file-independent (validated)

Convert `require(...)` → ES `import` **but keep `module.exports` as-is** in each
file. Verified safe: a `.ts` file with ES `import` + CommonJS `module.exports`
compiles, passes tests, and `require()`-consumers still receive the correct
value at runtime (via `esModuleInterop` default-interop). So each file converts
**independently** — no transitive CJS/ESM `.default` breakage, no need to touch
the export side or convert consumers in lockstep.

- `const X = require('Y')`            → `import X from 'Y'`
- `const { a, b } = require('Y')`     → `import { a, b } from 'Y'`  (single or multi-line)
- `require('Y')`                      → `import 'Y'`
- Left for **manual** fix (codemod skips): `const X = require('Y').Z`,
  `require('Y')(args)`, conditional/lazy requires inside functions, multiple
  declarators on one line.
- Named imports from a local CJS module (`module.exports = {a}`) run correctly
  but may add an **advisory** typecheck error until that module's exports are
  modernized — runtime/tests are unaffected (`--noCheck` build, transpile tests).

## ESLint setup (done)

- `@typescript-eslint/parser` + plugin installed; `.eslintrc.json` split:
  `.js`→airbnb (unchanged), `.ts`→focused TS rules.
- `.ts` rules are **warnings only** (non-blocking) so commits/lint-staged keep
  working while we burn the backlog down:
  - `@typescript-eslint/no-require-imports`: warn  ← migration driver
  - `@typescript-eslint/no-unused-vars`: warn (ignores `^_`)
- Inventory command: `npx eslint . --ext .ts`

## Inventory

| Rule | Baseline | Now |
|---|---|---|
| `@typescript-eslint/no-require-imports` | 1086 | **0** ✅ |
| `@typescript-eslint/no-unused-vars` | 104 | 104 (next batch) |
| **total** | 1190 | **104** (0 errors) |

require→import done: ~224 files via codemod; 4 mongoose nested-destructures
(`Types: { ObjectId }`) converted by hand; 7 intentional lazy/circular requires
inside functions kept as `require` with `// eslint-disable-next-line
@typescript-eslint/no-require-imports`. Codemod gotcha fixed: renamed
destructures `const { a: b } = require` must become `import { a as b }` (not
`{ a: b }`) — see `tools/` history. Full suite stayed green (2381 tests,
coverage 96.18/83.15/95.39/96.38).

## Per-batch process

1. `node tools/require-to-import.cjs <files…>` (codemod; single + multi-line).
2. `npm run build` — must still emit `dist/index.js` (catches syntax breakage).
3. Run the batch's tests (`jest <paths>`); manually fix any codemod stragglers.
4. `npx eslint . --ext .ts` — confirm `no-require-imports` dropped.
5. Commit the batch.
- Final gate before merge: full `npm run test:ci` (coverage 96/83/95/96) + `npm run build`.

## Batch order (leaf-up)

- [x] **B1** leaf utils: `aws/ cache/ common/ constants/ builders/`
- [x] **B2–B7** `dao/ services/ models/ middlewares/ routes/ controllers/ utils/ google/ prompt/` + root — all require→import done in one verified pass
- [ ] **B8** `@typescript-eslint/no-unused-vars` sweep (104) — per-var review (don't blind-autofix; some are real dead code, some false positives)
- [ ] **B9** (later) modernize `module.exports` → `export`, convert test files (.js→.ts), add type-aware eslint + import/order, burn down the ~4951 strict-type backlog

## Out of scope (separate effort)

- The ~4951 strict-type backlog (`npm run typecheck`) — advisory, non-blocking.
- `drizzle/`, `migration/`, the `NotoSansTC` font blob, `__mocks__/` stay `.js`.
