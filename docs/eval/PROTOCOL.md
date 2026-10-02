# Judging protocol for lesson quality

The standard way every lesson-quality change is judged, in use since 24 Sep 2026. The rubric files
it uses are `docs/eval/DECK-CHECKLIST.md`, `docs/eval/deck-checklist-schema.json` and
`docs/eval/judge-rubric-v2.md`. `docs/eval/README.md` has the step-by-step for running a round.

This is separate from the pipeline eval set in `docs/eval.md` (`bun run eval:schema` and
`bun run eval:paid`), which checks that lessons are produced and well formed, not how good they are.

## Judges

- Judges are in-session Claude agents on the default model (Opus), not the lesson-generation
  models, and they make no paid API calls.
- Sonnet is not a substitute judge: on the same sets it raised 60% more flags, agreed with the
  default model on only 60% of the "yes" flags, and correlated at r = 0.5.
- Each agent does one job on one deck (or one pair) and sees only that job's inputs.

## Blinding

- Every deck is exported to plain text (below) and labelled with an opaque letter or id only.
- The key that maps letters to arms is kept in a separate file that no judge sees.
- Never tell a judge which deck is new, what the arms are, or what the test is about.
- Unblind only after every judgment in the batch is written down.

## The three measures, in order of weight

### J6: yes/no fault checklist (primary)

- Rubric: `docs/eval/DECK-CHECKLIST.md`; output shape: `docs/eval/deck-checklist-schema.json`.
- One agent per deck, acting as a head of department. Every check is a yes/no question where yes
  means a fault, and "unsure = no". Each fault quotes the deck word for word.
- Checks: false and misleading statements, errors in worked examples, and per question a wrong keyed
  answer, a second defensible answer, or an answer that needs something no earlier slide teaches.
- The judge must web-search any statement it is not certain of (numbers, dates, names, causes,
  quotations).
- Reported as total faults per deck; fewer is better.
- Validation (24 Sep, 24 sets): it ranks arms the same way as the holistic judges; two identical runs
  agreed on 98% of items and 87% of the "yes" flags (per-set fault counts r = 0.88); it correlates
  with the out-of-5 overall at r = −0.5 to −0.6. The rubric's examples came from the same sets, so
  the agreement figures are an upper bound.

### J5-C: blind head to head in both orders (the ship gate)

- Rubric: `docs/eval/judge-rubric-v2.md`, Job C.
- The judge reads two decks for the same brief (as X and Y) and picks the one it would rather teach
  tomorrow, unchanged.
- Every pair is judged twice with X and Y swapped, **by two fresh agents**. A pair is a win only if
  both orders pick the same deck; a split, or "no preference" in either order, is a tie.
- **Ship rule: a change ships only if it wins more head to heads than it loses, and its J6 fault
  total is not higher than the baseline's.** No single-deck score decides a ship.
- Rubric v2's re-judge agreement on 20 earlier pairs was 90% (18 of 20).

### J5-B: scores out of 5 (secondary)

- Rubric: `docs/eval/judge-rubric-v2.md`, Job B.
- One agent per deck scores seven dimensions (pitch, coverage, explanation, practice, questions,
  flow, coherence) with anchors at 1, 3 and 5, writing its reason and evidence slide before each
  score. `overall` is the mean of the seven.
- Used for monitoring and for explaining a head-to-head result, never for a ship decision on its own.
- Job B's packet carries a practice-expectation line computed from the lesson length in minutes
  (formula in `docs/eval/judge-rubric-v2.md`). It is a guide for the judge only; lessons carry no
  timings.

## Batch anchoring

Scores out of 5 are anchored to the batch they were given in. **Compare them only within one
judging batch**, with both arms judged together. The same code has scored 3.34, 3.37 and 3.50 in
three batches, and one prompt version scored 3.12 in one batch and 3.42 to 3.61 in others. When a
result is compared with an earlier run, compare deltas within each batch, not raw numbers.

Fault counts (J6) and head-to-head results (J5-C) are less sensitive to batch, but the ship gate is
still run with both arms in the same batch.

## Not current

- Rubric v2 Job A (tiered claim audit), the `notes` and `fidelity` scores, and the earlier judge
  codes J0 to J4 and J7 were used in earlier rounds. They are optional now. J6 replaced Job A as the
  fact measure.
- The "Gates and metrics" section of `docs/eval/judge-rubric-v2.md` records the September plan that
  introduced rubric v2; the gates above supersede it.

## Exporting decks to text for judges

Judges never see rendered slides. Each deck is exported to plain text with
`docs/eval/tools/deck-text.ts`, a standalone Bun script with no model calls:

```sh
bun docs/eval/tools/deck-text.ts <deck.lesson.json> <out.txt>
```

The input is a lesson document as JSON (the `Lesson` body from `@tj/domain/documents`). The output
is:

- a header: lesson title, subject, year group, minutes, slide count and the numbered objectives;
- for each slide, a `=== Slide N (kind) ===` line, then its text elements in reading order (top to
  bottom, then left to right), with the heading marked `#`;
- pictures as one line each: `[<name>: <alt text>]`, and empty diagram slots as
  `[diagram placeholder: <label>]`;
- multiple-choice options as `( ) <text>`, with `[correct]` on the keyed one;
- text revealed on click prefixed `[revealed on click]`;
- the hidden answer panel as `-- Answer panel (hidden until revealed) --` with `Answer:` and `Why:`
  lines (multiple choice, true/false, open response, sort, fill-gap, matching and image match;
  an unknown question type stops the export);
- the teacher notes under `-- Notes --`.

Decoration is left out (accent bars, the kind tag, step-number badges, cards with no text), because
judges in earlier rounds read those as slide text.

Decks from other products (for example a Chalkie PDF or PPTX) are exported by hand to the same
shape: slide text, questions with their keyed answers, and one line describing each picture.

`docs/eval/DECK-CHECKLIST.md` describes its packet with `## Slide N` headings and `Question (...)`
blocks, which was an earlier export shape. The judge only needs to find slides, questions and keyed
answers, so tell it in the packet header which markers the export uses (`=== Slide N`, `[correct]`,
`Answer:`).
