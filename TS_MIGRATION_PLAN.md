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


## Per-batch process

1. `node tools/require-to-import.cjs <files…>` (codemod; single + multi-line).
2. `npm run build` — must still emit `dist/index.js` (catches syntax breakage).
3. Run the batch's tests (`jest <paths>`); manually fix any codemod stragglers.
4. `npx eslint . --ext .ts` — confirm `no-require-imports` dropped.
5. Commit the batch.
- Final gate before merge: full `npm run test:ci` (coverage 96/83/95/96) + `npm run build`.

## Batch order (leaf-up)
- [x] **console → logger** (June 2026): 9 `console.*` in 6 source files → `logger`
  (`log`/`info`→`logger.info`, `error`→`logger.error`, `warn`→`logger.warn`;
  `console.x('label', v)` → `logger.x('label', { v })`). Added `import logger` to
  app.ts; updated aws/s3.test (console spy → `logger` mock assertion). ESLint
  `no-console: warn` added (`services/logger.ts` overridden off — it IS the
  logger). `logger.test.ts` keeps real console spies.
- [~] **B10b** (large, incremental) burn down the strict-type backlog.
  - Baseline **3884 source errors** (tests excluded — `tsconfig` now includes
    `__tests__` for the editor jest global, so `tsc --noEmit` total is ~8994;
    work the ~3884 SOURCE ones). Dominant: **TS7006 implicit-any (2337)**,
    TS2339 (495), TS2497 (277), TS2554 (158), TS7053 (139), TS7031 (123).
  - **DONE: typed `asyncHandler` → 3884 → 3076 (−808).** `handler: (...args:any[])
    => any` (NOT `RequestHandler`): contextually types every controller's
    `(req,res,next)` callback (clears their TS7006) WITHOUT mistyping the
    functions that **misuse** asyncHandler to wrap non-`(req,res,next)` helpers
    (email senders etc.) — `RequestHandler` surfaced +854 bogus TS2339 there.
    Added `types/express.d.ts` (augments `Request.user`/`tenantId`) as a
    foundation for when handlers get real `Request` types. Type-only change;
    778 controller tests green.
  - NEXT: per-function typing, domain/leaf-up. Remaining TS7006 (1530) are
    non-handler callbacks/service/dao params. (TS2497 ~277 only clears by
    modernizing those modules' exports — see B9b-part2 WON'T DO.) The latent
    **asyncHandler misuse** (wrapping non-handlers) is a real cleanup: removing
    it from those helpers (like the informEditor fix) would let handlers take
    real `Request` types and clear more.

## Out of scope (separate effort)

- The ~4951 strict-type backlog (`npm run typecheck`) — advisory, non-blocking.
- `drizzle/`, `migration/`, the `NotoSansTC` font blob, `__mocks__/` stay `.js`.
