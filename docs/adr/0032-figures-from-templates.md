# 0032 — Figures are drawn by code from named templates, with a `path` element

- Status: Accepted (amended 2026-09-26; decisions 2, 4 and 6 and item 5 of that amendment amended by ADR 0034, 2026-09-27)
- Date: 2026-09-26
- Related PRD decisions: Images project, "Later phases" item 1 (native diagrams); PRD
  "Diagrams: figures in worksheets and slides" (13 Sep 2026); Greg's decision on TEACH-164
  (25 Sep 2026, option A3, subject figures first); ADRs 0021, 0023, 0025
- Linear: TEACH-164

## Context

Lessons need pictures that are not photographs: a right-angled triangle with labelled sides, a
chemistry energy profile, a bar model. The lesson model has no way to produce one today:

- The slide element union (`packages/domain/src/documents/slide.ts:292`, schema `:520`) has
  `line` with straight endpoints only (`LineElement`, `:226`), eight preset `ShapeKind`s and no
  curve, arc or polygon. PPTX export maps each type by hand (`packages/editor/src/export/pptx.ts:665`);
  every other surface (editor, viewer, present, print, PNG, thumbnails) renders through
  `ELEMENT_VIEWS` (`packages/editor/src/slide/elements/index.ts:21`).
- ADR 0025 §8: the model produces content, never geometry; `materialiseSlide` places everything.
- The 13 Sep PRD showed a `small` model writing correct SVG for a 15-figure worksheet for
  $0.008, and recommended shipping model-authored SVG behind a sanitiser and validator.
  Published evidence (VGBench) says models are unreliable at holding geometric constraints in
  SVG, and a validator cannot catch a triangle that is well formed but wrong for the question.
- pptxgenjs 4.0.1 (`packages/editor/package.json:77`) writes custom geometry (`custGeom` with
  `moveTo`, `lnTo`, `cubicBezTo`, `arcTo`) at runtime, although its typings omit `custGeom`.

## Decision

1. **A Figure is drawn by code, not by the model.** A **Figure template** in `@tj/slides`
   (`right-triangle`, `energy-profile`, `bar-model`, …) takes values and labels and returns
   native slide elements. The model names the template in the spec's `template` field and
   supplies the values and labels only. Model-authored SVG and model-placed coordinates are
   rejected for figures.
2. **One slide kind, `diagram`.** Its recipe puts the Figure where `image-text` puts its
   photograph (`imageTextSlide`, `packages/slides/src/layouts.ts:442`), beside a heading and a
   body that may set a task about the figure. No kind per template. Figures inside other kinds'
   recipes (worked example, questions) are later work.
3. **A Figure is one `group`** of native elements, so it moves, resizes and fits as a unit;
   `fitSlide` never pulls a label off its side. Editing a label needs Ungroup.
4. **Proportional, clamped.** A template draws in proportion to its values and clamps extreme
   ratios for legibility; a clamped figure carries a "Not drawn to scale" caption. Labels always
   carry the true values.
5. **A new `path` element** (`type: "path"`): `points` as fractions of the element's box (the
   `line` convention), `smooth`, `closed`, `fill`, `stroke`, `strokeWidth`, `dash`,
   `arrowStart` / `arrowEnd`. One pure function in `@tj/slides` turns smooth points into cubic
   Béziers; the editor's SVG view and the PPTX `custGeom` both call it, so screen and PowerPoint
   draw the same curve. Move, resize and rotate only; no point editing; not in the insert rail.
   Adding the member is backward compatible and keeps `version: 1` (ADR 0021 §2); an older
   build rejects a document that contains one.
6. **Slides only.** A worksheet figure block is later work. Templates return elements in a local
   box so that block can reuse them and the editor's element views.

## Consequences

- Figures cost no model tokens beyond the spec's values, stay editable element by element, and
  export as native PPTX shapes and vector print. Correctness is the template's job and is
  testable without a model.
- Coverage grows one template at a time, in the order the TEACH-164 inventory ranks them; a
  figure without a template is not drawn. Apparatus and biology drawings need a picture library
  (a separate Images decision).
- Every exporter must handle `path`: PPTX gets its own case and a local type for `custGeom`;
  the DOM renderer covers the rest. Word export (worksheets) cannot embed SVG, which is one
  reason worksheets are deferred.
- The "no picture reference" rules (`packages/generation/src/specs.ts:314`,
  `prompts/plan-facts.ts:113`) refuse "the diagram" in stems; the ticket that makes `diagram`
  generatable revisits them.
- Revisit if the inventory shows most needed figures fall outside a small template set, or if a
  measured sample shows model-authored SVG is reliable for the long tail.

## Amendment (2026-09-26, TEACH-77): generated only; a Figure carries its alt text and values

Decided in the 26 Sep design session (Omer, with Greg's agreement) and built in TEACH-77:

1. **`diagram` is generated only.** `SLIDE_KIND_ORDER` leaves it out and `PICKER_HIDDEN_KINDS`
   (`packages/slides/src/layouts.ts`) names it, so Add slide and the Slide layout menu do not offer
   it until there is a template picker. A diagram slide still converts to any other kind.
2. **A Figure's alt text is an optional `alt` on its `group`**, written by the template from its
   values ("Right-angled triangle. Base 3 cm, height 4 cm, hypotenuse x.", plus " Not drawn to
   scale." when it is not). The renderer draws such a group as `role="img"` with `aria-label` set
   to it, so the labels inside read as part of the image. PowerPoint gets no alt text: pptxgenjs
   4.0.1 has none for shapes or text boxes (`ShapeProps` / `TextPropsOptions` lack `altText`).
   That is a known limitation, not a bug.
3. **The group stores `figure: { template, values }`** (`FigureRef`, with the names in
   `FIGURE_TEMPLATE_NAMES`, both in `@tj/domain`): the values as the model gave them, never the
   geometry. Repair and cascade redraw from them instead of re-deriving values from label text,
   and "edit a value, redraw" becomes possible later. `alt` and `figure` are optional, so
   `version` stays 1 (ADR 0021 §2).
4. A diagram slide counts as an explain / teaching slide (built in TEACH-89).
5. Plan names the template on the outline entry as a `figureBrief` (built in TEACH-89).

A spike finding decides the validation design. A slide call that still breaks a **shape** rule
after its retry throws a `StageFailure` (`callStructured`, `packages/generation/src/call.ts:555`),
and Generate rethrows it, which fails the whole stage
(`packages/generation/src/stages/generate.ts:314-318`). So a template's value rules are
**editorial** (`editorialIssue`): for `right-triangle`, at least two lengths, a² + b² = c² within
1 %, the hypotenuse longer than each leg, labels of at most 12 characters. Drawing never throws:
`drawFigure` parses the values against the template's shape first, and values without that shape,
or values that cannot give the figure (fewer than two lengths, a hypotenuse no longer than a leg),
get a schematic fallback drawing captioned "Not drawn to scale". An editorial miss can still reach
the drawing, so a label past the cap wraps inside its box, and one past three lines is cut with an
ellipsis on the figure while the alt text keeps all of it.
