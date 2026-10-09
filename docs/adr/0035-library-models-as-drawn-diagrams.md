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
6. **What ships.** The kit and models are vendored from lab/lib-next `32dd891e` (library round 2
   plus the long-label fixes) into `library/vendor/`, byte for byte except two reworded comments.
   Every registered model that draws outside a browser is shipped (`library/models.ts`, 52). The two
   left out are listed with reasons in `library/catalogue.ts` `EXCLUDED`: `states_of_matter` needs
   DOMPoint and SVG transform lists, and `river_real` loads 29 MB of river data at run time.
7. **Bounded and on a deadline.** Before anything draws, the writer's params are held to the
   schema's bounds. Lists, numbers and strings that have no bound get a default one (60 items,
   ±1,000,000, 400 letters), and `__proto__`, `constructor` and `prototype` keys are dropped. The
   draw runs on one shared worker thread (`library/render-worker.ts`, built as
   `dist/library-render-worker.js`). Each drawing gets a 3 s deadline, and the thread is ended and
   replaced after a missed deadline, after a fault, and every 40 drawings. A miss falls back to
   the drawer.

## Consequences

- The editor edits a library diagram as it edits a drawer diagram (move, resize, replace, delete);
  editing a model's params in the editor is not part of this decision.
- Each library diagram adds about 80-120 KB to the lesson document (the font is most of it).
- Measured on the bundled draw thread: the first drawing takes about 180 ms (the thread loads
  happy-dom, the kit and the model), and later ones about 11 ms each. RSS goes from 32 MB to
  about 116 MB with the thread loaded, and stays near 216 MB across 60 drawings with one recycle.
- Fidelity (9 Oct): on 115 corpus extremes (each model's first preset as is, with the longest
  labels and with the extreme numbers), the worker's SVG and the same models laid out natively in
  Chromium were compared pixel by pixel at 1440 wide. 95 differ in under 0.2% of pixels and all
  others in at most 3%, except one sequences_patterns case, where the whole row sits a little
  further along (17%, same content). By eye, every pair has the same text fit and layout.
  Getting there took two fixes: Lexend's weight 500 is measured between the 400 and 600 tables,
  and curves and arcs are sampled for `getBBox`. `corpus.test.ts` checks the same extremes for
  words drawn off the slide.
- The library's corpus test runs in CI on happy-dom (`library/corpus.test.ts`): no throws, the
  audit's targeted cases, and alt text. Its Chromium clipping ratchet stays in the lab.
- A model added later ships by passing its counter-judge, rendering in `library.test.ts`, and being
  added to `models.ts`; new or changed writer wording goes through the prompt-engineer.

## Amendment (2026-10-09, TEACH-247 part i): a library drawing must agree with its slide

prod-lib-1 (four teaching errors in nine library slides) showed that a model's numbers are true to
its params but not always to the slide. Three rules now hold in `packages/generation/src/library`:

- **No silent clamp.** Params outside the bounds a drawing is held to are refused
  (`boundsRefusals`, in `checkParams` and again in `renderLibraryModel`); the repair call or the
  drawer takes over. `clampToSchema` stays as the bound definition, never as a silent fix.
- **A number the drawing is built from is never defaulted.** `DRAWING_PARAMS` (fill.ts) names
  them per model (equal_groups groups and size, fractions' fractions and, for a fraction of an
  amount, amount, …); the always-needed ones are `required` in the filler's schema, and one the
  fill leaves out is refused (one repair call, then the drawer).
- **The drawing must not contradict the words that describe it** (`consistency.ts`): the slide's
  heading and the model's caption only. Every model: letters the words name as labels ("A, B and
  C") are drawn. Number models (`NUMBER_MODELS`) also: every drawn sum is arithmetically right on
  every side; a fraction the words name is drawn; and when the words take a fraction of an amount,
  that whole is drawn and every number in a drawn sum is given by the words or worked from them in
  one step (8 + 8 = 16 for "half of 16" passes, 4 ÷ 2 = 2 does not). Number words ("twenty-five"),
  tenths as decimals, and units (20p is £0.20; kinds must agree) are normalised. Only a
  contradiction refuses, never an absence. A contradiction falls back to the drawer.
- **A library model is a still.** The kit's builds start from an empty frame, so Present opened on a
  blank box. The drawn SVG carries no `data-s` tags: every surface, Present included, shows the
  drawing as it ends. Decision 2's "Present plays the model's builds" is withdrawn for library
  models until their first build is a full drawing.
