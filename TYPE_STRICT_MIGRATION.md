# Strict TypeScript Migration — TaiGerPortalService

## Goal
`tsconfig.json` already has `strict: true` + `esModuleInterop: true`, but the
`.ts` files were never cleaned up, so `npm run typecheck` (`tsc --noEmit`)
reports **8,828 errors**. Drive that to **0**, replacing `any` with real
interfaces, so the backend is strictly typed and maintainable. Done in batches;
**every batch ends green** (no new errors introduced) with the affected jest
tests passing.

> The BUILD (`tsconfig.build.json`) uses `--noCheck`, so these are not currently
> a release gate — but they are the maintainability debt we're paying down.

## Starting state — 2026‑06‑19
- Total: **8,828** errors. Split: **5,264** in `__tests__`, **3,564** in source.
- By code: `TS2339` 3687 (property missing), `TS7006` 2459 (implicit‑any param),
  `TS7005` 498 (implicit‑any var), `TS2497` 393 (`export =` interop),
  `TS2554` 371 (arg count), `TS18047` 317 (possibly null), `TS2345` 198,
  `TS7053` 160, `TS2322` 113, `TS7034`/`TS7031` ~100 each, `TS7016` 59
  (missing `@types`), `TS2306` 35, …
- By area (source): controllers 1097, services 923, dao 608, utils 286,
  middlewares 220, builders 101, constants.ts 79, routes 75, models 58,
  database.ts 43, aws 40, app.ts 12, common 9, index.ts 7.

## Conventions
- **Missing `@types`** → install in `devDependencies` (Batch 0).
- **`export = {…}` modules** are the root cause of the 393 `TS2497`: with
  `esModuleInterop`, named imports (`import { x } from './m'`) aren't allowed
  from a `export =` module. Fix by converting those modules to **named ES
  exports** and leaving importers as named imports. Clean + interop‑correct.
  (Do NOT just sprinkle default imports.)
  - **Style (user preference):** put `export` on **each declaration** inline —
    `export const foo = …`, `export function bar() {}` — NOT a grouped
    `export { foo, bar }` block at the bottom. Only use an `export { … }` /
    `export { … } from '…'` statement to re‑export *imported* bindings (e.g. SDK
    command classes a module imports and forwards).
  - **Breakers to fix when converting a module:** whole‑object **default**
    importers (`import m from './m'` → `import * as m from './m'`) and
    `import m, {…}` forms. Named imports and `const { x } = require('./m')`
    destructures keep working unchanged.
- **Tests use modern ES imports, not `require()`** (user preference): convert
  `const { x } = require('../../m')` → `import { x } from '../../m'` (mocks are
  hoisted regardless of import position). Prefer a top‑level `import` +
  `jest.mocked(x)` over inline mid‑test re‑requires.
- **Express handlers** → type `(req: Request, res: Response, next: NextFunction)`.
  Add a shared `req.user` augmentation (`types/express.d.ts`) and per‑handler
  `req.body`/`req.params` interfaces instead of `any`.
- **Mongoose** → return types use the `@taiger-common/model` interfaces
  (`IStudentResponse`, `IApplicationPopulated`, …) for DAO methods; add local
  interfaces for locally‑defined schemas (e.g. `CommunicationDraft`).
- **Tests** → `jest.mocked(X)` or `(X.method as jest.Mock)` for auto‑mocked
  services; type the `mockReq`/`mockRes` helpers once in `__tests__/helpers`.
- Prefer real interfaces over `any`; use `unknown` + narrowing for genuinely
  dynamic shapes. Never widen tsconfig to hide errors.
- Each batch: fix → `tsc` count drops by the area's amount → run that area's jest
  tests → update the tracker below.

## Batch order (foundation‑up)
| # | Area | Approx errors | Strategy |
|---|---|---|---|
| 0 | Missing `@types` (`TS7016`) | 59 (+ downstream) | install `@types/*` in devDeps |
| 1 | `export =` → ES named exports | ~393 `TS2497` | aws, config, common, constants, database + importers |
| 2 | `models/` + `dao/` | ~666 | model interfaces; typed DAO returns (cascades to services/controllers) |
| 3 | `middlewares/` + `builders/` + `utils/` | ~607 | typed params, narrow `req` |
| 4 | `services/` | ~923 | typed args/returns from DAO interfaces |
| 5 | `controllers/` | ~1097 | Express req/res + body/param interfaces |
| 6 | `routes/` | ~75 | handler signatures |
| 7 | `__tests__/` | ~5264 | `jest.mocked`, typed helpers |

## Progress tracker
| Batch | Date | Errors before | Errors after | Tests |
|---|---|---|---|---|
| start | 2026‑06‑19 | — | 8828 | — |
| 0 — @types | 2026‑06‑19 | 8828 | 8705 | email/s3 green |
| 1a — config.ts | 2026‑06‑19 | 8705 | 8667 | email green |
| 1b — aws/* | 2026‑06‑19 | 8667 | 8629 | aws (26) green |
| 1c — constants.ts + models barrel | 2026‑06‑19 | 8629 | 8604 | constants/dao green |
| 2 — models/* + middlewares/* + utils/* + constants/email | 2026‑06‑19 | 8604 | 8459 | mw/utils/dao/aws (771) green |

## Notes / decisions
- **Batch 0 (@types):** installed `@types/{bcryptjs,compression,cookie-parser,cors,
  lodash,method-override,morgan,multer,multer-s3,node-schedule,passport,
  passport-jwt,passport-local,pdf-parse,pg,supertest,uuid,nodemailer}` in
  devDeps. Pin majors to the runtime package: `@types/uuid@^9` (uuid@9) and
  `@types/bcryptjs@^2.4` (bcryptjs@2) — the `latest` stubs (`@types/uuid@11`,
  `@types/bcryptjs@3`) are empty redirects for newer majors and don't type the
  installed versions. `bottleneck/es5` has no `.d.ts`; switched `aws/ses.ts` to
  `import Bottleneck from 'bottleneck'` (main entry ships `bottleneck.d.ts`).
  All `TS7016` (59) gone; net −123 (the libs becoming typed surfaced ~18 real
  usage mismatches now attributed to services/middlewares — fixed in their
  batches).
- **Batch 1a (config.ts):** converted `export = {…}` → inline `export const`.
  Gave the `env()` helper **overloads** (`env(name, default: string): string` /
  `env(name, default: number): number`, coercing numeric env values) so each
  exported constant keeps a clean `string` OR `number` type instead of a
  `string | number` union — without the overloads the union regressed ~80
  consumers. Net −38; `TS2497` 352→… as the importers were already named.
- **Batch 1b (aws/*):** converted `ses.ts`, `s3.ts`, `sts.ts`, `constants.ts`,
  `index.ts` to inline `export const`/`export function`; `aws/index.ts` and
  `ses.ts` re‑export the SDK command classes via `export { … }`. Fixed two test
  default imports (`import s3` / `import awsIndex` → `import * as …`). Net −38,
  all from `TS2497` (314 remain). 34 errors still inside `aws/*` are `TS7006`
  implicit‑any params (`bucketName`, `objectKey`, …) — deferred to the typed‑
  params batch. `__tests__/aws` 26 tests green.
- **Batch 1c (constants.ts + models barrel):** delegated to subagents. `constants.ts`
  → inline `export const`/`export function` (~80 decls); `Role` re‑exported via
  `export { Role }`. `models/index.ts` → per‑model `export const X = compile(...)`.
  Fixed 1 default importer of `constants` (a test). The models barrel barely moved
  `TS2497` because most consumers use `const { User } = require('../models')`
  (CommonJS destructure — no interop error), not `import { }`.
- **Batch 2 (models/* + middlewares/* + utils/* + constants/email):** converted 34
  models, 13 middlewares + `builders/BaseQueryBuilder`, 7 utils + `constants/email`
  to inline named exports (3 parallel subagents, **module‑side only**, disjoint
  file sets — no importer edits — to avoid concurrent‑edit races). Then a single
  global breaker sweep: 4 `TS1192` default‑import breakers fixed
  (`models/index.ts` `import * as userModels from './User'`; 3 test files →
  `import * as` / direct named import). Removed a dead `export default` the codemod
  surfaced in `utils/modelHelper/versionControl.ts` (the pre‑existing
  `module.default=` was a no‑op overwritten by `export =`; all importers are
  named). **Shape rule confirmed:** only `export = { literal }` (Shape A) modules
  were converted — `export = SingleVar` (Shape B: services, DAOs, query‑builder
  classes, `getProgramFilter`/`stripModel`) are *default*‑imported and produce no
  `TS2497`, so they're deferred (converting them only ripples to importers for no
  error reduction).
  - **KEY GOTCHA — typing surfaces hidden debt:** while a default‑import breaker
    (`TS1192`) is unresolved, tsc treats the binding as `any` (error recovery),
    which *suppresses* all downstream strict errors on it. Fixing the breaker to a
    correctly‑typed import RE‑surfaces them — here fixing `models/index.ts`'s User
    import added ~465 real `TS2339`/strict errors on `Model.find()/.findById()`
    calls across DAOs. That made the cluster read 7994 (broken/`any`) → 8459
    (fixed/typed). The 465 are real debt, not a regression — attributed to the
    DAO/service batches. Lesson: **measure the count only after breakers are fixed
    and types actually flow**, else the number lies low.
- (record subsequent per‑batch decisions + interfaces here)
