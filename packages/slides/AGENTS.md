# AGENTS.md — `packages/slides` (`@tj/slides`)

The pure slide recipes (ADR 0025 §9): theme catalogue and projector floors (`themes.ts`,
`FIT_VERSION`), the 960×540 grid, `layoutSlide` and its placeholder copy, the rich-doc builders
(`docFromText`, `docFromBullets`, `docFromNumbered`), text-style resolution, the "Why?" panel
metrics, and `materialiseSlide` / `materialiseBlock`, which fill a recipe from a model-produced
spec (ADR 0025 §8). The layout linter (`lint.ts`: `lintSlide`, `lintAsDrawn`, `renderedHeights`)
and the headless fit check (`fit-check.ts`: `fitsPlanned`, `slideFits`; `fit-report.ts`:
`fitReport`) live here too, so generation and the editor measure a slide with one ruler. Read the
root [`AGENTS.md`](../../AGENTS.md) first.

- **No React, no Tiptap, no CSS.** Dependencies are `@tj/domain`, `nanoid` and `zod` only;
  `src/bundle.test.ts` builds the entry for Bun and fails on any of them. Anything that needs the
  DOM, the editor's DOM `Measurer` included, stays in `@tj/editor`; the headless ruler
  (`measureHeadless`) is here.
- **The recipes are the single source of geometry.** `@tj/editor` re-exports every module here from
  `src/model/*`; `@tj/generation` imports it directly. Never change a recipe number here without
  running the moved `layouts.test.ts` and the editor suite.
- **The model produces content, never geometry (ADR 0025 §8).** A `SlideSpec` / `BlockSpec` carries
  text slots and `factRefs`; `materialise*` places it and stamps `generatedFrom` + `authoredBy: "ai"`
  on every element and block. Text enters only through the doc builders, so no empty text node is
  ever written (Tiptap refuses one).
- Tests: `bun test` in this directory.

## Adding a layout

Layouts land in parallel PRs, so a new one registers only in three union-merged files
(TEACH-106 part b) and never edits a shared line elsewhere:

1. Its own files: `src/templates/<id>.ts` (the `layout<Id>(c, input)` recipe), `<id>-capacity.json`
   (exported by the `./templates/*-capacity.json` pattern in `package.json`; no new line there),
   `<id>-fixtures.ts`, tests and its writer prompt.
2. `src/templates/<id>.ts` exports `<id>Fields` (its input fields, all optional) and `<id>Def`
   (a `TemplateDef`: `kind`, `layout`, `samples`, and `adaptive` with its relayout recipe when it
   is adaptive). `src/templates/registered.ts` gets one line in each list: the imports,
   `<id>: <id>Fields;` in `RegisteredInputs`, `<id>: <id>Def,` in `REGISTERED`. That puts it in
   `TemplateId`, `TemplateInput`, the slide kinds, `layoutTemplate`, `templateSamples()` (so the
   every-theme test) and outside the old-lesson snapshot.
3. Its writer file in `packages/generation/src/writer/` exports `<id>Writer` (a `WriterDef`:
   `toInput`, `adaptive`, and its lay-draft rules `holdDraft`, `showsRevealsInDraft`,
   `itemIcons`). `packages/generation/src/writer/registered.ts` gets an import line and
   `<id>: <id>Writer,`. Nothing in `lay-draft.ts` or `materialise.ts`.
4. An adaptive layout only: `"<id>",` in
   `packages/domain/src/documents/adaptive-template-ids.ts`.

Each registry line names the layout, one line per entry, added at the end of its list; never edit
an existing line in the same PR. A multi-line block is not safe: the union merges away a line two
blocks share (`  },`) and leaves broken code. `.gitattributes` gives the three files
`merge=union`, and `biome.json` leaves their imports unsorted, so lines from two PRs merge in
either order. GitHub does not apply the driver and may still show the second PR as DIRTY;
`bun run land` then rebases it locally, where the driver applies, and refuses it only if a real
conflict remains. Do not add a new layout to the hand-kept lists in `index.ts`, `relayout.ts`,
`samples.ts`, `every-theme.test.ts`, `fixtures/old-lesson-inputs.ts`, `materialise.ts`,
`lay-draft.ts` or `layout-ref.ts`; they hold the layouts from before the registries.

`src/templates/registered-merge.test.ts` is the check: in a scratch repo, two branches each add a
dummy layout (with lay-draft rules) to the three files at the same places, and
`git merge-tree --write-tree` merges them keeping every added line exactly once, with no conflict (and conflicts without the union driver). Run it with
`bun test src/templates/registered-merge.test.ts` after changing any of the three files' shape.
