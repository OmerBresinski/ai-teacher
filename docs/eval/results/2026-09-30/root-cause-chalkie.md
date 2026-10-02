# Why Chalkie's slides beat ours: root cause (30 Sep 2026)

> File references are to [`spike/plan-write`](https://github.com/OmerBresinski/ai-teacher/tree/spike/plan-write) at eefb3b2e (`plan-write.ts` = `packages/generation/src/stages/plan-write.ts`, `illustrate.ts` = `packages/generation/src/stages/illustrate.ts`, `schema.ts` = `packages/slides/src/diagrams/schema.ts`). Chalkie decks are described, not copied.

## Summary

This compares three matched decks (y4 Romans, y7 particle model, y8 rivers), ours from the fix3 run and Chalkie's, slide by slide.

**The root cause is our lesson shape. It spends the slide budget on questions, and it does so before any teaching gets a slide.** Two rules cause it. The planner is told that "pupils answer, sort, match or write on about half the slides". The stream swap then makes a retrieve starter, a check after each idea, a hinge, a practice slide and an exit all mandatory, and says that when slides are short "checks cover two objectives each rather than losing the starter, the practice or an objective". With the title and objectives also fixed, a 10-slide deck has only 3 teaching slides left, and a 6-slide deck has 1. Chalkie spends about two thirds of its slides on teaching and keeps checking to one or two slides at the end.

Three further causes make each teaching slide we do have thinner and barer than Chalkie's:

2. **Slot capacity is measured at our large type on the worst of 10 themes.** Our body text is about 43 px at 1440, against Chalkie's 20 to 24 px. So an explain slide holds 3 sentences, a photo slide 2 sentences and a list 2 points. A Chalkie teaching slide carries 40 to 70 words. Ours carries 26 to 43.
3. **A picture costs text, and diagrams die in code.** The photo form holds 2 sentences, fewer than the 3 an explain slide holds without a photo. The figure form is offered to the planner but nothing ever draws it (plan-write.ts: "a figure brief (drawn later by no step here)"). A diagram that fails the schema, such as a flow arrow label over 14 characters, falls back to a stub slide. Of the 3 diagrams we planned, 2 died this way, and each one was the slide that taught an objective.
4. **Pictures are allowed only on teaching slides, and there are few of those.** The v3 swap bars pictures from every other slide, so a deck of ours gets 1 or 2 photos. Chalkie gets 3 to 10, most of them sources or examples that carry content.

## 1. What makes each Chalkie slide teach

| Deck | Chalkie teaching slides | What they carry |
|---|---|---|
| Romans (10 slides) | invasion, roads, towns and baths, Boudicca, Hadrian's Wall (5), plus a hook | 34–50 words each; a heading, a 3–5 sentence story with dates and names, and a callout (fun fact, remember, watch out, key point). The pictures are sources: the Claudius coin, a helmet, a road engraving, a milestone, Bath, an excavation. Two slides carry two photos, each with its own caption paragraph. |
| Particles (6 slides) | states, heating curve, density/diffusion/pressure/worked example (3) | 49–72 words each. There are two drawn diagrams (particle arrangement in the three states, and a labelled heating curve), a misconception callout and 4 dense cards with a worked density calculation. |
| Rivers (10 slides) | natural causes, human causes, hydrograph, hard engineering, soft engineering (5), plus a hook | 24–68 words each. A real hydrograph shows lag time. Two photos per cause or strategy each sit over their own paragraph, and there is a named real case (the 2019 floods, York and the Foss Barrier). |

Chalkie's structure is a hook, the objectives, 3 to 5 teaching slides, then 1 or 2 activities (audio questions, a quiz or an evaluation), each followed by its answer reveal.

## 2. Our decks and where each gap comes from

| Deck | Our slides by role | Gap | Pipeline decision that caused it |
|---|---|---|---|
| Romans | title, objectives, starter, **teach**, **teach**, check, **teach**, MCQ, open response, exit | 3 teaching slides against 5; Boudicca, towns and baths, and Hadrian's Wall are absent | PLAN_RULES says "about half the slides" are questions and "leave the rest for a later lesson"; stream swap v3 makes the frame mandatory |
| Romans | slide 4 diagram-slot table fills a third of its panel | an empty box | diagram-slot body(2) plus a small table; no content-sized layout |
| Particles | title, objectives, starter, **teach**, hinge, exit | 1 teaching slide against 3; the objectives shrink to 2 | the frame takes 5 of 6 slides; "checks cover two objectives rather than losing the starter" |
| Particles | slide 4 was planned as a `figure` (particle diagram) | no particle diagram at all | log: "slide drawn without its picture". The figure form is never drawn (plan-write.ts ~1163) |
| Particles | title photo shows syringes on red | the picture is decorative and misleading | Pexels search: shortlisted 0, `judged: fallback`, and the picker took the first few in the pool (illustrate.ts:467) |
| Rivers | slide 4 is the stub "explain rainfall reaching the river" | objective 1 is never taught | the stream diagram broke schema (`arrow` ≤14 chars, schema.ts:149); the writer failed twice, so plan-write.ts:1258 put in a "missing-material" stub |
| Rivers | 2 teaching slides (impacts, trade-offs) against 5 | causes, hydrograph and the strategies are missing | the same frame rules |
| All | every teaching slide holds 26–43 words | thin | slot-contracts.ts: explain body(3), photo body(2), list 2 points, compare 2×2 phrases, measured at stepDown 0 on all 10 themes |

## 3. Numbers, ours against Chalkie (same 3 briefs, 26 slides each)

| Measure | Ours (fix3) | Chalkie |
|---|---|---|
| Teaching slides | **6** (3 / 1 / 2) | **13** (5 / 3 / 5) |
| Question or check slides (not counting reveals) | **13** (50%) | **5** (19%) |
| Mean words per teaching slide | ~35 | ~52 |
| Taught words per deck on slides (Romans / particles / rivers) | 98 / 42 / 71 | ~209 / ~186 / ~278 |
| Diagrams drawn | 1 (a sparse table) | 3 (particle states, heating curve, hydrograph) |
| Diagrams planned but killed in code | 2 of 3 | 0 |
| Pictures that carry content | 2 | ~15 |
| Decorative pictures | 3 (title photos; one is wrong) | ~5 (AI scene-setters) |
| Judge score for lesson on slides | 2.33 | ~4 |

## 4. Ranked root causes and fixes

These respect the fixed rules: nothing is shortened after it is written, there are no splits, nothing is taught only in the notes, fit comes first, and the title and objectives slides are fixed.

1. **The lesson frame takes the teaching slides (about 50% of the gap).** Fix in `packages/generation/src/prompts/plan-lesson.ts` PLAN_RULES and `stream-lesson.ts` STREAM_SWAPS[3]. Replace "about half the slides" with a teaching-first budget: at least half the rows after slide 2 teach, and there are at least as many teaching slides as objectives. Checks, the hinge and practice fit into what is left. When slides are short, merge the starter into the hook or objectives and drop the separate practice before dropping teaching. Delete "leave the rest for a later lesson", because it licenses thin coverage.
2. **The slot capacity is sized for 43 px type (about 25%).** Fix in `packages/slides/src/slot-contracts.ts`, the theme body size and `slot-contracts.measure.ts`. Add a teaching body size of about 30–32 px at 1440, still readable from the back, and re-measure. Explain goes to about 5 sentences, photo to 4 plus a callout, list to 3–4 points. This is a Greg decision, because the layout audit recommended keeping the large type.
3. **Diagrams die in code (about 15%).** Fix in `stages/plan-write.ts` and `slides/src/diagrams/schema.ts`. Either build the figure form or remove it from the palette menu (`plan-write/menu.ts`) so the planner picks a diagram kind that draws. Tell the writer schema limits in the contract rather than failing on them (arrow labels ≤14 characters). When a diagram fails, re-plan it as a teaching slide without the picture, not a stub. Add the primitives this subject set needs: particle states and a labelled curve (line-graph already exists).
4. **Pictures cost text and only fit on teaching slides (about 10%).** Fix in the `slot-contracts.ts` photo form (the body should be at least explain's), a two-photo compare layout, and the v3 picture swap. Allow a source photo on the hook or objectives slide. In `illustrate.ts:467`, drop the no-shortlist fallback: no photo is better than a wrong one.
