# `@tj/domain`

Zod schemas and TypeScript types shared by every app and package in the Teaching Journey
monorepo: the core object skeletons from Master PRD §8, branded IDs, the universal state
vocabulary, background-job names / payloads / events, the `StorageAdapter` interface and a tiny
`Result` type.

It is the **only** internal package with no internal dependencies (ADR 0013). Its single runtime
dependency is `zod` (v4).

## Export map

Consumers import **source** (README "Internal packages are consumed from source"); every subpath
resolves to a file under `src/`. `bun run build` (tsup) additionally emits ESM + `.d.ts` into
`dist/` for the same entries to prove the package is tree-shakeable — nothing consumes `dist/`.

| Import                | File                    | Contents                                                                                                   |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@tj/domain`          | `src/index.ts`          | Everything below, plus `IsoDateTime`                                                                       |
| `@tj/domain/ids`      | `src/ids.ts`            | `WorkspaceId`, `UserId`, `JobId`, `JourneyId`, `LessonId`, `ArtefactId`, `SourceId`, `ObservationId`, `AdaptationId`, `ConceptId`, `CohortProfileId`, `SkillId`, `KnowledgeNodeId`, `ID_SCHEMAS`, `IdBrand`, `AnyId`, `newId()` |
| `@tj/domain/objects`  | `src/objects/index.ts`  | `Workspace`, `Journey`, `CohortProfile`, `Concept`, `Lesson`, `Artefact`, `Observation`, `Adaptation`, `Source`, `Skill`, `KnowledgeNode`, `OBJECT_SCHEMAS`, `ObjectName`, `workspaceOwnedFields` |
| `@tj/domain/documents` | `src/documents/index.ts` | **Subpath only, not in the root barrel.** `Lesson`, `Slide`, `SlideElement`, `QuestionData`, `Theme`, `Worksheet`, `WorksheetBlock`, `Series`, `RichDoc` types; `LessonSchema`, `SlideSchema`, `SlideElementSchema`, `QuestionDataSchema`, `WorksheetSchema`, `StoredWorksheetSchema`, `WorksheetBlockSchema`, `SeriesSchema`, `RichDocSchema`; `parseLesson()`, `parseWorksheet()`, `parseStoredWorksheet()`, `parseSeries()`, `isLesson()`, `isWorksheet()`, `isSeries()`, `migrate()`, `CURRENT_VERSION`, `normaliseHref()`, `slideStepCount()`, `hasRevealableAnswer()`, `SLIDE_W/H`, `PAGE_A4/LETTER`, `MAX_CRITERIA`, `WORD_SEARCH_MIN/MAX_SIZE` |
| `@tj/domain/states`   | `src/states.ts`         | `ArtefactState`, `LessonTaughtState`, `AttentionFlag`                                                      |
| `@tj/domain/jobs`     | `src/jobs.ts`           | `JobName`, `JobNameSchema`, `PingPayloadSchema`, `PingPayload(Input)`, `JobPayloadSchemas`, `JobPayloads`, `JobPayloadInputs`, `JobEventType`, `JobEventSchema`, `JobEvent`, `JobEventOf`, per-variant `Job*EventSchema`, `JobProgressSchema`, `JobErrorSchema`, `JOB_TERMINAL_EVENT_TYPES`, `JobTerminalEventType`, `isTerminalJobEvent()` |
| `@tj/domain/storage`  | `src/storage.ts`        | `StorageAdapter`, `StorageObject`, `StoragePutOptions`, `StorageSignedUrlOptions`, `storageKey()`, `parseStorageKey()`, `StorageKeySchema`, `StorageKey`, `StorageKeyError`, `ParsedStorageKey` |
| `@tj/domain/result`   | `src/result.ts`         | `Result`, `Ok`, `Err`, `ok()`, `err()`, `isOk()`, `isErr()`                                                |

Every Zod schema follows the **type + const same-name pattern**: `WorkspaceId` is both the schema
(`WorkspaceId.parse(x)`) and the inferred type (`const id: WorkspaceId`).

```ts
import { JobEventSchema, JobName, newId, type StorageAdapter, type WorkspaceId } from "@tj/domain";

const workspaceId = newId<WorkspaceId>();
const event = JobEventSchema.parse(payload); // JobEvent, discriminated on `type`
```

## IDs

All IDs are UUID strings validated with `z.uuid()` and branded per entity (`z.uuid().brand<"WorkspaceId">()`),
so a `JobId` cannot be passed where a `WorkspaceId` is expected.

`newId<T>()` mints a fresh id:

- **Server-side (Bun: `apps/api`, `apps/worker`, tests)** it returns a **UUIDv7** via
  `Bun.randomUUIDv7()`. UUIDv7 is time-ordered, so database inserts stay append-friendly and ids
  sort by creation time.
- **Browsers / Node** fall back to `crypto.randomUUID()`, which is a **UUIDv4** (random).

**Ordering is only guaranteed for ids minted server-side.** Both versions validate against every
`*Id` schema; treat client-minted ids as opaque and never sort by id in the UI. The Bun global is
read through `globalThis` with a local structural type, so the file compiles under both the Node
and React tsconfigs.

## Documents (the tie-in contract)

`src/documents/` holds the Lesson, Worksheet and Series **documents** the editor reads and writes:
TeachDeck's `lib/model/{types,schema}.ts` adopted verbatim ([ADR 0021](../../docs/adr/0021-tie-in-document-contract.md)),
plus two optional fields on `Lesson` (`reachedSlideId`, `taughtAt`, TD item 5). A TeachDeck JSON file
is a valid product document and vice versa; `migrate()` runs at every boundary that accepts one
(import, the mock store, later the API). Ids are TeachDeck's plain strings, not the branded ids in
`src/ids.ts`.

It is deliberately **not** re-exported from `@tj/domain`: `documents/lesson.ts` `Lesson` is the
editor document, while `objects/lesson.ts` `Lesson` is the future workspace-owned persistence row
(with `workspaceId` and without `version`, as `objects.test.ts` enforces). Import
`@tj/domain/documents` explicitly. The theme *catalogue*, id factories and starter content live in
`@tj/editor`; only the `Theme` type is here.

## Core objects (skeletons)

One file per object under `src/objects/`. Each schema is `z.strictObject` and carries **only**
ownership + audit fields: `id` (branded), `workspaceId`, `createdAt`, `updatedAt` (ISO 8601 UTC
strings), plus `version` for `Journey`. `Workspace` is the tenant root and has `id`,
`createdAt`, `updatedAt` — no `workspaceId`. A test asserts this invariant over `OBJECT_SCHEMAS`.

| Object          | File                | Filled by                                                    |
| --------------- | ------------------- | ------------------------------------------------------------ |
| `Workspace`     | `workspace.ts`      | F17 Workspace Accounts, Plans and Billing                    |
| `Journey`       | `journey.ts`        | F01 Journey Intake & Goal Capture                            |
| `CohortProfile` | `cohort-profile.ts` | F02 Cohort Profile                                           |
| `Source`        | `source.ts`         | F03 Sources                                                  |
| `Concept`       | `concept.ts`        | F05 Knowledge Layer: Progressions and Misconceptions Graph   |
| `KnowledgeNode` | `knowledge-node.ts` | F05 Knowledge Layer: Progressions and Misconceptions Graph   |
| `Lesson`        | `lesson.ts`         | F06 Lesson Builder and Coherent Artefact Generation          |
| `Artefact`      | `artefact.ts`       | F07 Artefact Editor and Teacher Authorship                   |
| `Observation`   | `observation.ts`    | F09 Assessment and Observation Capture                       |
| `Adaptation`    | `adaptation.ts`     | F10 Adaptation                                               |
| `Skill`         | `skill.ts`          | F13 Pedagogy Skills Runtime and Model Routing                |

### Adding an object skeleton

1. Add a branded id to `src/ids.ts` (`export const FooId = brandedId("FooId"); export type FooId = …`)
   and to `ID_SCHEMAS`.
2. Create `src/objects/foo.ts` with a `// Filled by F0x (<PRD name>)` comment and
   `z.strictObject({ id: FooId, ...workspaceOwnedFields })`.
3. Re-export it from `src/objects/index.ts` and add it to `OBJECT_SCHEMAS`. The tests check that
   every file in `src/objects/` is registered, declares its owner, and has `workspaceId`.
4. Do **not** add domain fields here — the owning feature PRD does that.

## States

The universal chip vocabulary (F18-R07): `ArtefactState = draft | reviewed | stale`,
`LessonTaughtState = planned | taught`, `AttentionFlag = none | needs_attention`. `AttentionFlag`
is a two-value enum rather than a boolean so it serialises like the other states and can grow a
reason code later without a type change.

## Jobs

- `JobName` is a const object (`JobName.ping`); `JobNameSchema = z.enum(JobName)`.
- Payloads are strict objects in `JobPayloadSchemas`, keyed by job name. `JobPayloads[K]` is the
  parsed type (defaults applied), `JobPayloadInputs[K]` the type accepted when enqueuing.
- `JobEventSchema` is a discriminated union on `type` over `queued | started | progress |
  completed | failed | cancelled`. Every variant is strict and carries `jobId`, `workspaceId` and
  `at` (ISO 8601 UTC). `progress` adds `progress: { percent?: 0–100; message?: string }`; `failed`
  adds `error: { message: string; retryable: boolean }`. `JOB_TERMINAL_EVENT_TYPES` lists the
  three terminal types; `isTerminalJobEvent()` narrows.

### Adding a job

1. Add the name to `JobName` (`export const JobName = { ping: "ping", renderSlides: "render_slides" } as const`).
2. Add a strict payload schema (`export const RenderSlidesPayloadSchema = z.strictObject({ … })`).
3. Register it in `JobPayloadSchemas` — the `satisfies Record<JobName, z.ZodType>` clause fails the
   typecheck until every name has a schema, and a test checks the keys match at runtime.
4. The worker (`apps/worker`) and API (`apps/api`) pick up the new key through `JobPayloads`.

## Storage

`StorageAdapter` (ADR 0011) is implemented by `@tj/storage` (local disk in development, Vercel
Blob in production). Keys are always `<workspaceId>/<segment>/…` so a tenant's files can be
enumerated and destroyed (F15-R02):

- `storageKey(workspaceId, ...parts)` builds a key and **throws `StorageKeyError`** when the
  workspace id is not a UUID, no segments are given, or a segment is empty / contains `/`, `\`,
  `..` or NUL (or is `.`).
- `parseStorageKey(key)` is the non-throwing inverse and returns `Result<{ workspaceId, parts }, string>`.
- `StorageKeySchema` validates a full key (UUID, `/`, path) for use inside other schemas.

## Result

`Result<T, E> = { ok: true; value: T } | { ok: false; error: E }` with `ok()`, `err()`, `isOk()`,
`isErr()`. Validators in domain code return a `Result` instead of throwing; `storageKey` is the
one deliberate exception (a programmer error, not user input).

## Rules

- **No internal dependencies.** `@tj/domain` imports `zod` and nothing else — never another
  `@tj/*` package. Everything else may depend on it; it depends on nothing (ADR 0013).
- **No domain fields in skeletons.** Feature PRDs own field design.
- **Strict objects everywhere.** Unknown fields fail loudly (F13-R02 allow-list mindset).
- **Timestamps are ISO 8601 UTC strings** (`IsoDateTime`), what `Date#toISOString()` produces.

## Scripts

| Script      | Command           |
| ----------- | ----------------- |
| `typecheck` | `tsc --noEmit`    |
| `lint`      | `biome check .`   |
| `test`      | `bun test`        |
| `build`     | `tsup` → `dist/`  |
