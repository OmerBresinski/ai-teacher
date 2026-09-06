# 0021 — Tie-in document contract: TeachDeck's Lesson, Worksheet and Series schemas in `@tj/domain`

- Status: Accepted
- Date: 2026-09-06
- Related PRD decisions: TD project item 1 (tie-in contract), item 5 (`reachedSlideId`/`taughtAt`), D-001 (Series), A9 (account copy); ADRs 0011, 0013, 0020

## Context

TeachDeck (`gregjwa/pres-ui-temp`, checkpoint `f3dbcf7`) defines the documents the editor, viewer,
present mode and exporters all read: `lib/model/types.ts` (Lesson, Slide, SlideElement, Worksheet,
WorksheetBlock, Series, Theme) and `lib/model/schema.ts` (Zod 4 schemas, `version: 1`,
`CURRENT_VERSION`, `migrate()`, `parseLesson`/`parseWorksheet`/`parseSeries`). A slide is 960×540
points; a worksheet page is A4 or Letter. Greg's row-1 decision is that this model is the product's.

Our side has stubs: `packages/domain/src/objects/lesson.ts` is `{ id, ...workspaceOwnedFields }`,
and `apps/web/src/mocks/library-schema.ts` holds library summaries only (ADR 0020: "`@tj/domain` is
not extended until the tie-in contract lands"). No API exists for documents; everything in this
project is frontend-only and the backend will connect later (TD project description note).

Two facts in TeachDeck's model need a decision rather than a copy:

- Inserted images are stored as base64 data URLs in `ImageElement.src` (see the quota comment in
  `components/editor/use-autosave.ts`). Fine for IndexedDB; not for a Postgres row or a list
  response.
- Two migrations exist: a shape migration (`migrate()` on `version`) and a layout re-fit
  (`fitVersion` against `FIT_VERSION` in `lib/model/themes.ts`, run by
  `lib/layout/use-fit-migration.ts`, which needs DOM font measurement and the editor's undo
  transaction).

## Decision

1. **Schema home.** TeachDeck's document types and Zod schemas are adopted **verbatim** into
   `@tj/domain` under `packages/domain/src/documents/`, exported as the subpath
   `@tj/domain/documents` and not from the root barrel (amended 2026-09-06, TEACH-96: the
   `objects/lesson.ts` stub is kept as the future persistence-row skeleton because
   `objects.test.ts` requires `workspaceId` and forbids `version` on every core object, so the
   editor document cannot live there): `lesson.ts` for
   `Lesson`, `Slide`, `SlideElement`, `QuestionData`, `Theme` types and the `LessonSchema`,
   `SlideSchema`, `SlideElementSchema`, `QuestionDataSchema`, `SlideKindSchema`,
   `AgeBandSchema`, `RichDocSchema` schemas; `worksheet.ts` for `Worksheet`, `WorksheetBlock`,
   `WorksheetHeader`, `PageSize`, `WorksheetSchema`, `WorksheetBlockSchema`; `series.ts` for
   `Series`, `SeriesSchema`. Constants (`SLIDE_W`, `SLIDE_H`, `PAGE_A4`, `PAGE_LETTER`) and the pure
   helpers `slideStepCount`, `hasRevealableAnswer` move with them. The three small pure values
   `schema.ts` imports — `MAX_CRITERIA` (`lib/model/worksheet-factories.ts`), the word-search size
   limits `WORD_SEARCH_MIN_SIZE`/`WORD_SEARCH_MAX_SIZE` (`lib/worksheet/word-search.ts`) and
   `normaliseHref` (`lib/text/links.ts`) — move into `@tj/domain` too, with their validation
   tests, so `@tj/domain` keeps depending on `zod` only (ADR 0013). Field names, enum values and
   error messages are unchanged so TeachDeck JSON files parse without translation.
2. **Workspace fields are not on the document.** `workspaceOwnedFields` (`workspaceId`,
   timestamps) belong to the persistence row the API adds later, not to the JSON the editor reads
   and writes. The editor document is TeachDeck's shape plus the two optional fields in item 4;
   a TeachDeck file is a valid product document and a product file without those fields is a
   valid TeachDeck file. Both stay `version: 1`; optional additions never bump the version.
3. **Versioning.** `CURRENT_VERSION` and `migrate()` move into `@tj/domain` beside the schemas and
   run at every boundary that accepts a document: JSON import, the mock store on load, and the API
   on read once it exists. The layout re-fit (`FIT_VERSION`, `fitVersion`, `use-fit-migration`)
   stays in `@tj/editor` and runs only when a lesson is opened for editing, as TeachDeck does
   (`docs/DEFERRED.md`, "Fit migration"). `fitVersion` is part of the schema.
4. **TD item 5 fields.** `LessonSchema` gains two optional fields now: `reachedSlideId?: Id` (the
   furthest slide shown in present mode) and `taughtAt?: string` (ISO, set when present mode exits
   past slide 1). Optional means no migration. Present mode writes them (ADR 0022 phase B).
5. **Images.** `ImageElement.src` stays a string and the contract is a **URL**: once the API exists,
   the editor uploads on insert and stores the `/files/:key` proxy URL (ADR 0011). Until then the
   editor keeps producing data URLs and the mock store accepts them; the summary's `cover` (item 6)
   strips data-URL `src` values so list responses stay small. The upload endpoint is API work
   outside this project.
6. **Library summary.** `DocumentSummary` in `apps/web/src/mocks/library-schema.ts` stays a
   hand-maintained, web-local shape (ADR 0020) and gains `cover: Slide | null` for lessons: the
   first slide's full element tree, so the library paints a real slide thumbnail from one list
   query. The mock store fills `count`, `themeId`, `subject`, `yearGroup` and `cover` from the
   document it holds when a document is created or saved; there is no shared `summarise()` in
   `@tj/domain` yet. The API decides its own list shape later.
7. **Interchange format.** The JSON export/import format **is** the domain document:
   `*.teachdeck.json` for a Lesson, `*.worksheet.json` for a Worksheet (TeachDeck
   `lib/export/json.ts` naming). Import is `migrate()` → `parseLesson`/`parseWorksheet` → create.
   A file from a newer version fails with TeachDeck's exact message.

## Consequences

- One Zod source for the editor, the import dialog, and later the API and worker; TeachDeck JSON
  files are valid product documents from day one.
- `@tj/domain` grows by ~1,000 lines and gains a `nanoid`-free surface: id generation
  (`lib/model/factories.ts` uses `nanoid`) stays in `@tj/editor`; domain holds shapes only.
- The stub `Lesson` object and its `objects.test.ts` case are replaced; `Artefact` and `Journey`
  stubs are untouched (Journey is superseded by Series, D-001, but its stub remains for history).
- `apps/web/src/mocks` holds full documents (ADR 0020 amendment): the store keeps a
  `Map<id, Lesson | Worksheet>` seeded from TeachDeck's `lib/model/starter.ts` demo lessons and
  `lib/worksheet/demo.ts`; summaries are maintained beside them. A reload reseeds, as today.
- Data-URL images are a known temporary shape; the ticket that adds uploads must also add a
  one-off rewrite of stored documents, which is why `src` is typed as a plain string now.
- Revisit when the API lands: the row shape (`workspaceId`, `kind`, `body jsonb`), the list
  endpoint's summary shape, and whether `migrate()` runs on read or on write.

## Amendment (2026-09-06, TEACH-96)

§1 named `packages/domain/src/objects/` and "replacing the stub". The schemas live in
`packages/domain/src/documents/` as the subpath `@tj/domain/documents`; the `objects/lesson.ts`
stub stays for the persistence row. The three pure values `schema.ts` imported (`MAX_CRITERIA`,
the word-search size limits, `normaliseHref`) moved with it.

## Amendment (2026-09-06, ADR 0024)

The three questions deferred above are answered by ADR 0024: the row shape is one `documents`
tenant table with `kind` + `body jsonb` and promoted list columns (§3); the list summary shape is
the `DocumentSummary` produced by a single `summarise()` in `@tj/domain` (§3), replacing the
web-local one of §6; and `migrate()` runs on write, so storage is always `CURRENT_VERSION` (§4).
`Lesson.brief` is added as an optional product field under the §2 rule (no version bump).

## Amendment (2026-09-06, ADR 0025)

§1 placed "the theme *catalogue*, id factories and starter content" in `@tj/editor`. The
catalogue, the grid, the layout recipes and the rich-doc builders move to the pure package
`@tj/slides` so the worker can lay out generated slides with the same recipes (ADR 0025 §9);
`@tj/editor` re-exports them. Under the §2 rule the Lesson gains optional `facts`, `generation`,
`artefacts`, `sources`; every slide element and worksheet block gains optional `generatedFrom`
and `authoredBy`; the Worksheet gains optional `lessonId` (ADR 0025 §1–§4, §20). No version bump.
