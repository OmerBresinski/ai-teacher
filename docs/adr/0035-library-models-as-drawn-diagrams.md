# 0035 — Diagram-library models as drawn diagrams, rendered in the worker

- Status: accepted
- Date: 2026-10-09
- Ticket: TEACH-247 part h
- Related: ADR 0025 (generation pipeline), 0023 (exports), TEACH-247 part b (#415, the diagram drawer)

## Context

The diagram library (`lab/library` on lab/lib-next: a kit plus 52 models, each with a params
schema, `validate()`, `builds()` and a DOM renderer) won the lab's lib arm: the writer picks a
model from a catalogue, a small call fills its params, code checks them and the model draws. The
lab drew models in Chromium and screenshotted them. Production has no browser in the worker, and
every surface (editor, Present, PNG, PDF print, PPTX) already shows the drawer's diagrams: an
image element `name: "Diagram"` whose `src` is an SVG data URL, with `builds` counted from its
`data-s` groups (TEACH-247 part b). The writer stage already has a `drawn` figure path
(`{ drawn: { src, aspect, alt } }`) that lays such an SVG into the diagram slot.

## Decision

1. **Same element, no new type.** A library model becomes the drawer's element: an SVG data URL in
   the diagram slot, through the existing `drawn` figure. The kit already tags each mark's build as
   `data-s="k"`, the attribute Present's `svgAtBuild` reads, so Present plays the model's builds;
   the editor, PNG, PDF and PPTX (rasterised by the existing canvas path) show the still.
2. **Rendered once, in the worker, on happy-dom.** `packages/generation/src/library/render.ts` runs
   the kit's own `mountSlide` on a happy-dom document. Text is measured from the Lexend advance
   tables production already uses (`@tj/slides` `textWidth`); `getBBox` is computed from the
   marks' geometry. The two globals the kit reads (`document`, `getComputedStyle`) are set only for
   the synchronous render and restored. No Chromium, no layout engine, no screenshot.
3. **Self-contained SVG.** Hidden marks (`.off`) and the caption foot are removed, the view box is
   cropped to the drawn marks, the primary theme's tokens go in a `<style>`, and Lexend is embedded
   as a woff2 data URL (about 53 KB), because an SVG shown through `<img>` cannot load web fonts
   and the words must render in the font they were measured in. A drawing over 400 KB (a world
   coastline) is refused.
4. **Writer and fill.** The writer's system text and schema get the prompt-engineer's menu line,
   catalogue lines and `dg-model-{side,full}` def from `lab/bakeoff/ab/lib-words/` verbatim
   (`library/words/`). The params are filled on the drawer's small-model call with the lab's fill
   and repair prompts, checked by the kit's `schemaCheck` and the model's `validate()`, then by
   `lib-meta.json` (`cannot`, and a question slide's last build before the answer).
5. **Fallback is the drawer.** A model whose fill is refused twice, whose call fails, that cannot
   draw the intent, or that does not render goes to `drawWriterDiagram` as the model's base kind
   (`bar_model` → `bar-model`, …) or `labelled-diagram`, with the intent as its request. From
   there today's chain applies (repair, restage); a slot is never left empty by the library.
6. **What ships.** The vendored kit and models are copied byte for byte from lab/lib-next
   0c27ede7 into `library/vendor/` (two comments reworded), and only models whose latest
   counter-judge passed and that render on happy-dom are registered (`library/models.ts`); the
   rest are listed with reasons in `library/catalogue.ts` `EXCLUDED`.

## Consequences

- The editor edits a library diagram as it edits a drawer diagram (move, resize, replace, delete);
  editing a model's params in the editor is not part of this decision.
- Each library diagram adds about 80-120 KB to the lesson document (the font is most of it).
- The library's corpus test runs in CI on happy-dom (`library/corpus.test.ts`): no throws, the
  audit's targeted cases, and alt text. Its Chromium clipping ratchet stays in the lab.
- A model added later ships by passing its counter-judge, rendering in `library.test.ts`, and being
  added to `models.ts`; new or changed writer wording goes through the prompt-engineer.
