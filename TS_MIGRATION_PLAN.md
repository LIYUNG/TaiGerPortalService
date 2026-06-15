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
- [x] **B9a** `module.exports` → `export =` (231 files). Uniform `export =` (NOT
  `export {}` / `export default`): `export =` emits a writable `module.exports`,
  so `require()`-consumers AND `jest.spyOn(require(mod), 'fn')` keep working.
  **Gotcha:** `export { a, b }` (ES named) are read-only live bindings → broke
  `jest.spyOn` on named exports (ai_assist). Side benefit: typecheck backlog
  4951 → 4170 (consumers' default imports now resolve). Full suite green (2381).
- [x] **B8** unused-vars sweep — **eslint `.ts` 104 → 0**. 38 unused imports removed
  via `eslint-plugin-unused-imports` autofix; 69 unused vars/args prefixed `_`
  (preserves side-effecting calls like `const job7 = schedule.scheduleJob(...)`,
  `const response = await s3.send(...)` — call kept, result intentionally ignored);
  1 dead `let updatedStudent` (decl + 2 assignments) prefixed by hand.
- [x] **B9b-part1** 171 `.test.js` → `.test.ts`. Tests already ran under ts-jest, so
  this was a clean rename; full suite green. `.test.ts` eslint override turns off
  `no-require-imports` + `no-unused-vars` (tests use require for jest mocking).
  Fixtures/mocks/`ai-assist.jest.config.js` stay `.js` (resolve fine).
- [x] **B9b-part2** WON'T DO (investigated + reverted). Moving `export =` →
  named/`export default` is NOT safe per-module: consumers use a **mix** of
  default imports (`import x from './m'; x.fn()` — needs the whole object, i.e.
  `export =`/default) and named imports (`import { fn }` — needs named exports).
  Converting a module's exports breaks its default-import consumers (verified:
  orchestrator → `undefined.runAiAssist`). It would require flipping every
  consumer's import style in lockstep, for only ~525 *advisory* TS2497 errors.
  `export =` is the correct form for a **commonjs**-target build — keep it.
- [x] **B10a** import hygiene (eslint autofix): `import/no-duplicates` (merged the
  codemod's split imports), `import/first`, `import/newline-after-import`. 26→0.
  `import/order` left OFF — reordering side-effect imports (`import './models'`)
  is unsafe. ESLint `.ts` (source+tests) = **0 problems**.
- [ ] **B10b** (large, incremental) burn down ~4170 strict-type errors —
  dominated by **TS7006 implicit-any params (2338)** + TS2339 (495) + TS2554
  (158). Real per-function typing work; do it domain-by-domain, leaf-up. NOT a
  one-pass job. (TS2497 ~525 would only clear with B9b-part2, which we won't do.)

## Out of scope (separate effort)

- The ~4951 strict-type backlog (`npm run typecheck`) — advisory, non-blocking.
- `drizzle/`, `migration/`, the `NotoSansTC` font blob, `__mocks__/` stay `.js`.
