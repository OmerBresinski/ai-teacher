# AGENTS.md — `packages/slides` (`@tj/slides`)

The pure slide recipes (ADR 0025 §9): theme catalogue and projector floors (`themes.ts`,
`FIT_VERSION`), the 960×540 grid, `layoutSlide` and its placeholder copy, the rich-doc builders
(`docFromText`, `docFromBullets`, `docFromNumbered`), text-style resolution, the "Why?" panel
metrics, and `materialiseSlide` / `materialiseBlock`, which fill a recipe from a model-produced
spec (ADR 0025 §8). Read the root [`AGENTS.md`](../../AGENTS.md) first.

- **No React, no Tiptap, no CSS.** Dependencies are `@tj/domain`, `nanoid` and `zod` only;
  `src/bundle.test.ts` builds the entry for Bun and fails on any of them. Anything that needs a
  `Measurer` or the DOM stays in `@tj/editor`.
- **The recipes are the single source of geometry.** `@tj/editor` re-exports every module here from
  `src/model/*`; `@tj/generation` imports it directly. Never change a recipe number here without
  running the moved `layouts.test.ts` and the editor suite.
- **The model produces content, never geometry (ADR 0025 §8).** A `SlideSpec` / `BlockSpec` carries
  text slots and `factRefs`; `materialise*` places it and stamps `generatedFrom` + `authoredBy: "ai"`
  on every element and block. Text enters only through the doc builders, so no empty text node is
  ever written (Tiptap refuses one).
- Tests: `bun test` in this directory.
