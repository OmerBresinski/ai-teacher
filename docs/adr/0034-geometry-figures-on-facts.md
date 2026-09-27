# 0034 — Geometry and trigonometry figures: solver templates, figures on facts, on worksheets and in other slides

- Status: Accepted
- Date: 2026-09-27
- Amends: ADR 0032 (decisions 2, 4 and 6, and item 5 of its 2026-09-26 amendment)
- Related PRD decisions: Images project, section "Figures: geometry and trigonometry" (design
  session with Omer, 27 September 2026); the Figures inventory (TEACH-164 spike); ADRs 0021,
  0023, 0025, 0030, 0032
- Linear: Images project, "Figures: geometry and trigonometry"

## Context

ADR 0032 draws a Figure by code from a named template, on the diagram slide only, with the values
written by the diagram slide's Generate call. Two templates exist: `right-triangle` (TEACH-77) and
`energy-profile` (TEACH-94).

The founder wants every geometry and trigonometry figure in GCSE Mathematics (AQA 8300,
Foundation and Higher) and A level Mathematics (AQA 7357). A catalogue built on 27 September 2026
from both specifications and the June 2022 and June 2023 Higher papers lists about 70 figure
types: triangles and trigonometry, circles and the circle theorems, polygons and composite shapes,
similarity, transformations, coordinates and graphs, 3D solids, bearings, vectors, angle facts and
constructions. `right-triangle` draws none of the 23 figures in the June 2022 Higher papers
exactly: it has no angle input, no vertex labels and no rotation. ADR 0032 asks to revisit when the
needed figures fall outside a small template set; one template per figure type would be that case.

Most "find x" questions are asked on worksheets, on exit tickets and in worked examples, and ADR
0032 gives none of them a figure. A figure's values also live only on the slide's group
(`figure: { template, values }`), so the same question could show different numbers on a slide
and on its worksheet, and nothing checks a stated answer against the figure it refers to.

## Decision

1. **Solver templates.** Geometry and trigonometry are drawn by a small set of general templates,
   each of which solves its figure from a determining set of values:
   - `triangle`: any valid set of sides and angles, the ambiguous case included;
   - `circle`: parts, sectors in degrees or radians, segments, and the circle theorems;
   - `coordinate-plane`: points, lines, regions and transformations, and `function-graph`, the
     curves, on the same axes;
   - `polygon`: special quadrilaterals, regular polygons and composite shapes;
   - `solid-3d`: solids with hidden edges, 3D trigonometry, plans and elevations;
   - `bearings`, `vectors`, `angles-lines` and `construction-loci`.

   Similar and congruent shapes are a pair option on a template, not a template of their own.
   `right-triangle` stays, and Plan chooses between it and `triangle` by topic.

   One template per figure type is rejected: 40 or more templates sharing the same maths and marks,
   and a longer list for Plan to choose from. A construction language written by the model (points,
   circles and constraints for code to solve) is rejected for now: it moves geometry back towards
   the model, which ADR 0032 decision 1 rejects.
2. **Value and label.** Every length, angle and point a template draws from has a number to draw
   from and an optional printed label, as `right-triangle` has `length` and `label`. A label may be
   a letter or an expression ("x", "5x", "x - 5"); the model still supplies the true value, and the
   template's editorial rules check that the values agree (angle sums, the triangle inequality,
   a² + b² = c², inscribed angles, vector loops). Labels are Unicode text with the existing bold
   mark (°, π, √, ′, subscripts, Unicode fractions, a combining arrow over letters); there is no
   maths typesetting engine, so the editor, PowerPoint and Word show the same text.
3. **Graphs from named families.** `function-graph` takes a family (linear, polynomial,
   reciprocal, exponential, trigonometric, modulus, parametric) and its parameters. Nothing the
   model writes is parsed or evaluated as an expression.
4. **True scale where students measure.** `bearings`, `construction-loci` and grid figures on
   `coordinate-plane` are drawn to true scale and never clamped; they carry a scale bar that stays
   correct when the figure is resized. The other templates keep ADR 0032 decision 4: proportional,
   clamped, and captioned "Not drawn to scale" only when clamped. The exam habit of printing
   "Diagram not drawn accurately" on every figure is not adopted.
5. **A figure lives on its fact.** A worked example or a question in `LessonFacts` may carry
   `figure: { template, values }` (a `FigureRef`; optional, so `LessonFacts` gains no version).
   Plan's facts call writes it, Verify reads it and may patch it, and every artefact that uses the
   worked example or question draws from it: a diagram slide (whose Generate call stops inventing
   values; this amends item 5 of the ADR 0032 amendment), a worked-example or question slide, and a
   worksheet question. The drawn group keeps its own copy for redraw (ADR 0032 amendment, item 3).
6. **Answers checked against the figure.** Where a template can compute its unknown, code compares
   the stated answer with it. A disagreement is an editorial finding for Verify or Repair; it never
   fails a stage and never overwrites the answer.
7. **Figures beyond the diagram slide.** Worked-example, multiple-choice and open-response slides
   can carry a figure in a box of their own, and the diagram slide gains a second layout with a
   larger figure for dense templates. The existing diagram layout and its numbers stay. This amends
   ADR 0032 decision 2.
8. **Worksheets.** A worksheet question can carry one figure from its fact, drawn above or beside
   it. Print and PDF stay vector; Word export embeds a PNG of the figure rendered in the browser at
   export time (ADR 0023). This amends ADR 0032 decision 6.
9. **Editable values.** Selecting a figure in the editor opens a form of its values built from the
   template's schema. A change redraws the figure and updates its fact, and the cascade (ADR 0025
   §18, TEACH-134) proposes the matching changes to the answer, the worksheet and other slides.

Out of scope: A level mechanics diagrams, nets, implicit curves, cobweb diagrams, and scale
drawings with irregular outlines such as coastlines (those need a picture library or model-authored
geometry).

## Consequences

- The catalogue estimates that these templates draw 21 of the 23 figures in the June 2022 Higher
  papers and all 21 geometry and graph figures in the June 2023 Higher papers.
- Each template is a solver, its editorial rules, a fallback drawing, label layout and alt text;
  the energy profile showed that label layout is most of the work. A shared marks module (right
  angles, angle arcs, equal-side ticks, parallel arrows, dashed lines, north lines, points) and the
  value-and-label shape are built once, before the templates.
- Plan's facts call writes the figure values and Verify reads them, so both calls grow. The cost is
  measured on the eval set, which gains GCSE and A level geometry and trigonometry briefs.
- `LessonFacts`, the worksheet block union and the slide recipes gain optional fields; older
  lessons parse unchanged (ADR 0021 §2).
- A figure the teacher edits is teacher-authored, and the cascade never overwrites it silently
  (F07).
- Revisit the construction-language option if a common figure cannot be drawn without adding a
  template.
