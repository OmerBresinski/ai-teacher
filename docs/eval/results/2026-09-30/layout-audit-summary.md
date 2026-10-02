# Layout audit summary: our slides vs Chalkie (30 Sep 2026)

> Summary of the local audit (the per-form section, renders and side-by-side shots stayed local; Chalkie slides are described, never copied). Most fixes below landed on [`spike/layout-polish`](https://github.com/OmerBresinski/ai-teacher/tree/spike/layout-polish), merged into `spike/plan-write`.

**Question.** Why do our slides look plain next to Chalkie's, form by form, and what layout changes fix that?

**Scope.**
- All 8 round-2 Sol-planner decks: the round-2 lesson JSON.
- y10-electrolysis and y3-rocks re-rendered on Night Lab (dark) and Playground (playful). Only `themeId` changed.
- Forms missing from S2 came from two more decks: vocabulary, discussion and sort from the pw2 L2 y8-persuasive deck, true/false from the fit-lab r6 y8-persuasive deck.
- Worked examples were also rendered fully revealed (`STEPS=n`).
- Comparison set: all 86 Chalkie slides in the local Chalkie reference set.
- Every render is 1440×810, light theme, at reveal step 0 (what the class first sees), through a local render stack.

## Headline numbers

| | ours (93 slides) | Chalkie (86 slides) |
|---|---|---|
| Mean empty area | **58%** | 33% |
| Slides ≥60% empty | **47 (51%)** | 3 (3%) |
| Slides with a photo or drawn diagram | **0** | ~60 (≈70%) |
| Class-visible "Diagram to add" / "Photo:" boxes | **12** (7 of 8 S2 decks, plus 2 photo boxes) | 0 |
| Clipped or overlapping content at 1440 | 4 slides | 0 seen |

Our text is larger than Chalkie's:
- Our body text is 29 px on the 960-wide canvas, about 43 px at 1440.
- Chalkie's body text is about 20–24 px at 1440.

So legibility at distance is a strength to keep. The gap is space use, imagery and hierarchy, not type size.

## Ranked issues and fixes

Ranked by how much each hurts perceived quality: how often it appears × how bad it looks from the back of the room.

Each fix is tagged by who owns it:
- **Recipe** is a layout recipe in `packages/slides`.
- **Theme** is a theme token in `packages/slides`.
- **Writer** needs new content from the writer.
- **Ops** is pipeline configuration.

| # | Issue | Where | Fix | Owner | Fit note |
|---|---|---|---|---|---|
| 1 | **No pictures anywhere, and visible "Diagram to add" / "Photo:" briefs.** 0 of 93 slides have an image. 12 show the brief to the class. | explain, photo, title, compare | (a) Turn images on: put the Pexels key in the agent path (**ops**). (b) Present mode never shows a brief. With nothing placed, the recipe falls back to text-only: the body goes full width at a bigger scale (**recipe**). (c) Diagram rendering: the writer emits a small typed spec (bar model, flow/cycle, labelled cross-section, axes-and-curve, number line, table), rendered as theme-coloured SVG (**writer + recipe**). Photo fallback for the rest. | ops, recipe, writer | The text-only fallback must re-measure. The full-width body has more capacity, so it only loosens. The SVG zone gets a fixed box, and label text inside is measured like any text. |
| 2 | **Question sets are 73–83% empty** (21 slides, 2–3 per deck). | starter, check, exit | Recipe "question cards": one full-width card per question with a big number badge, stacked and vertically centred as a group. Type steps up when there are 2–3 questions (26 → 32–34 px). Reveal the answer *inside* its card (a second line in muted accent) instead of the reserved bottom zone. Optionally put a 30% image or icon column at the right for starters. | recipe | Capacity = cards × card height at the chosen scale. The answer line must be in the measured height, so the reveal cannot overflow. Pick the scale from the measured text, never after it. |
| 3 | **Answer given away on matching and sort.** The right column is in pair order, and sort cards are numbered 1–4 in the correct order. | matching, sort | Shuffle the display order deterministically (seeded by slide id, never equal to the answer order). Label left items 1–3 and right items A–C, and show them as cards. Sort items get letters, not numbers. | recipe | No capacity change: same boxes, new order. |
| 4 | **Worked examples blank at step 0, and revealed steps cramped.** Equations wrap mid-line. | worked-example | Steps as full-width rows: a number badge, then the working in maths set no-wrap, then the reason in muted text on the right. The problem and step 1 are visible at step 0, with later steps revealed. For ratio and fraction maths, the writer adds a bar-model spec (see #1). | recipe (+ writer for bar models) | Measure each equation as an unbreakable line. If it does not fit at the scale, drop the scale for the whole slide, never wrap. |
| 5 | **Fit failures the class sees.** Hinge option D is off the slide, a title objective is clipped, a sort row is on the accent bar, and the open-response reveal overlaps its label. | hinge, title, sort, open-response | The fit check must use the accent-bar safe area (y ≤ 520 of 540) and measure every reveal state. When wrapped options exceed the height, a hinge with long options switches to a 2×2 grid, then to a smaller scale. | recipe (fit) | This is the honesty fix itself: capacity is measured against the real safe area and the final reveal state. |
| 6 | **Dark theme unreadable on compare cards and answer box. The accent bar is hard-coded orange in every theme.** | compare, open-response, all | Card fill, card ink, answer-box fill and the accent bar come from theme tokens, resolved at render time rather than baked into element fills at generation. Add a lint that no text/fill pair falls below 4.5:1 in any theme. | theme | None. |
| 7 | **Title slide hierarchy inverted, with no image.** | title | Title at 48–56 px on the left half with a photo on the right (or a colour block if there is no photo). Subject/year as a small tag. Objectives move to their own numbered-card slide, or shrink to a strip under the title. Title-case the lesson name. | recipe (+ ops for photo) | Measure the title at the large scale. When a long title needs more than 3 lines, step the size down. |
| 8 | **Open response: a big empty answer box on the board.** | open-response | Drop the box on the presented slide. Instead: the prompt vertically centred at a larger scale in a framed prompt card, with 2–3 sentence starters or success criteria as small cards below, and an optional image. The box stays on the pupil handout, not the board. | recipe + writer (starters/criteria) | Starters are optional content, so capacity is measured with and without them. |
| 9 | **Vocabulary, true/false and discussion look like plain text.** | vocabulary, true-false, discussion | Vocabulary: term cards (term bold at body size, definition at body size in ink, not grey small), with an optional icon or image per term. True/false: the statement in a large card, with True/False chips in green/red using tick/cross icons. Discussion: the question in a speech-bubble frame plus an image, with stems as chips. | recipe | Definitions move from `small` to `body`, so each card holds fewer words. Re-measure. The writer's definition length limit may need to drop. |
| 10 | **Sequence renders as bullets half the time. The compare label is tiny.** | sequence, compare, explain side panel | A sequence always uses the numbered step or chevron recipe, and the recipe picks vertical or horizontal by item length. Compare cards get a sub-heading at 20+ px, with an optional image header per column. The key-idea panel uses regular weight with a label and icon, not bold paragraphs. | recipe | Vertical steps hold more words per step than 4 narrow cards. Measure both and pick. |

**What to keep.**
- The large type scale: ours reads better from the back than Chalkie's.
- The hinge option cards.
- The explain-callout card with icon.
- The Playground ornaments.
- One layout skeleton across themes.

**Order of work.**
1. #3 (shuffle) and #5 (fit honesty) first: they are correctness.
2. Then #6 (dark theme).
3. Then #2 and #4: the largest space wins, all recipe-only.
4. Then #1: images on, plus the diagram spec. This is the biggest perceived-quality gain, but it needs writer content.
5. Then #7–#10.
