# Plan-write fix3 round: result (30 Sep 2026)

> Copied from Greg's local lab on 30 Sep 2026. Raw decks, judge JSON and score sheets stayed local; paths below that are not repo paths refer to that lab. "EVAL-REGISTRY §3" is the protocol now in [`docs/eval/PROTOCOL.md`](../../PROTOCOL.md). Branch heads are on GitHub as `spike/plan-write` and friends.

Arms: **H** is this round's deck (spike/plan-write eefb3b2e: stream mode, Sol planner, images on, Commons for named subjects and then Pexels). **C** is the final round's winner (Sol single stream, images off), **P** is production and **O** is the oracle (Opus). This is a 3-brief slice: y5-rivers, y6-ratio and y9-weimar for text, plus y4-romans, y7-particle and y8-rivers-flooding for slides against Chalkie. There was one run per brief.

Text judging used J6, J5-B and J5-C (the standard protocol (docs/eval/PROTOCOL.md)), with order 1 and order 2 in `judge/<brief>-o1.json` and `-o2.json`. A pairwise win counts only when both orders pick the same deck. Anything else is a tie. The files use several schemas. The tally normalised them (J5-B `questions`→`questionQuality`, `flow`→`lessonFlow`, nested `{score}`; in-file J5-C labels are positional in the swapped order) and matches every judge's own summary.

**Departures from protocol:** within each order, one agent ran every job and both J5-C deck orders. Facts were checked from memory, with no web search. Only 3 briefs were run, so read these results as a direction, not a verdict.

## Headline

**Text recovered and slides did not.** On text, H ties C 1–1–1 (fix1 was 0–6–2). It beats production 3–0–0, scores 3.71 against C's 3.86, and has 1 J6 fault in 6 judgments. On the same three briefs, fix1 scored 3.45 and lost to C 0–2–1. The starter is back in all three decks, and practice (3.50) now matches C.

On slides, **Chalkie wins all 3 briefs, "clear" in all 6 passes** (fix1 on the same briefs: 0–2–1). Empty picture slots are gone, and polish rose from 2.83 to 3.67. But the decks got thinner (lesson on slides 2.67 → 2.33), and pictures barely moved (1.67 → 1.83).

## Slides against Chalkie (lab visual judgments, unblinded against the packet keys)

| brief | pass 1 | pass 2 | result | fix1 |
|---|---|---|---|---|
| y4-history-romans | Chalkie, clear | Chalkie, clear | **Chalkie** | Chalkie (strong / clear) |
| y7-particle-model-new | Chalkie, clear | Chalkie, clear | **Chalkie** | Chalkie (clear / strong) |
| y8-geography-rivers-flooding | Chalkie, clear | Chalkie, clear | **Chalkie** | tie (Chalkie slight / ours slight) |

Ours 0, Chalkie 3, tie 0 (fix1 on these briefs: 0–2–1).

Mean scores out of 5 over 6 judgments on the same 3 briefs:

| | clarity | pictures | polish | lesson on slides |
|---|---|---|---|---|
| ours fix3 | **5.00** | 1.83 | **3.67** | **2.33** |
| ours fix1 | 4.50 | 1.67 | 2.83 | 2.67 |
| Chalkie (fix3 judgments) | 3.83 | 4.00 | 2.83 | 4.00 |
| Chalkie (fix1 judgments) | 3.50 | 3.83 | 2.67 | 3.83 |

Photos: 5 requested and 5 placed. There were 2 Commons photos each in y4 and y8 and 1 Pexels photo in y7, with no empty slots. That fixes fix1's biggest fault: y4 showed three empty boxes in fix1, and now shows a Roman wall and an aerial view of Housesteads.

What the judges said against us:
- **Thin content.** This came up in all 6 passes. y4 has three short teaching slides. In y7, slide 4 is the only teaching slide, and there is no particle diagram in a particle-model lesson. y8 has no runoff or infiltration diagram, and Chalkie teaches the hydrograph.
- **y8 slide 4 is unfinished.** It is a speech bubble holding only "explain rainfall reaching the river", which reads as a planner phrase that leaked onto the slide. Both passes named it the worst slide.
- **Pictures are decorative, not teaching.** The y7 title photo shows hypodermic needles on red ("reads as medical"). Chalkie's y4 pictures carry the content (coin, helmet, milestone, Bath).
- **The y4 slide 4 table** fills only a third of its panel.

For us: clarity scored 5 in every judgment, and the judges called our starter, checks, MC and exit ticket good structure. The judges also say Chalkie's decks are less polished (clipped boxes, faint hydrograph labels, audio-only tasks).

**Full visual run?** Not yet. A 0–3 result, with every pass "clear", is no better than fix1 on this slice. The empty-slot fix works, but thin slides now decide the result. Fix the thin teaching slides, the missing diagrams and the leaked planner phrase first.

## J6 faults (3 decks per order)

| arm | order 1 | order 2 | per deck |
|---|---|---|---|
| H | 0 | 1 | 0.17 |
| C | 0 | 0 | 0.00 |
| P | 0 | 1 | 0.17 |
| O | 4 | 2 | 1.00 |

- H: in y5, slide 10's key accepts only "wider", but slide 6 teaches wider and deeper, so "deeper" is another correct answer. Only order 2 flagged it.
- P: the y6 starter tests ratio order before slide 4 teaches it (order 2).
- O: in y5, slide 5 teaches a fast-source, slow-mouth velocity misconception, and slide 8 tests waterfalls, which are never taught (both orders). In y9, slide 8 lists the Dawes Plan as ending the crisis, and the trust question is taught only in notes (order 1).

## J5-C pairwise, both orders agreeing (W–L–T from H's side)

| pair | W–L–T | y5 | y6 | y9 | fix1 F, same briefs |
|---|---|---|---|---|---|
| H–P | **3–0–0** | H | H | H | 1–1–1 |
| H–C | **1–1–1** | C | tie | H | 0–2–1 |
| H–O | **1–1–1** | H | O | tie | 1–1–1 |

Decided by: over P, coverage and practice. Against C, H lost y5 on explanation and question quality, split y6 (practice against coverage), and won y9 on practice and flow. Against O, H won y5 on correctness (O's velocity error) and lost y6 on explanation and practice. y9 split.

## J5-B 1–5 (mean of 6 judgments)

| arm | pitch | coverage | explanation | practice | questions | flow | coherence | overall | o1 / o2 |
|---|---|---|---|---|---|---|---|---|---|
| H | 4.00 | 4.17 | **3.33** | 3.50 | **3.17** | 4.00 | 3.83 | **3.71** | 3.85 / 3.57 |
| C | 4.00 | 4.50 | 3.83 | 3.50 | 3.67 | 3.67 | 3.83 | 3.86 | 3.86 / 3.86 |
| P | 3.17 | 3.50 | 3.50 | 3.17 | 2.67 | 3.33 | 3.00 | 3.19 | 3.24 / 3.15 |
| O | 4.33 | 3.67 | 3.83 | 3.67 | 3.67 | 4.17 | 4.33 | 3.95 | 4.00 / 3.90 |

H is still behind C on explanation (−0.50), question quality (−0.50) and coverage (−0.33). It now matches C on practice and beats it on flow (+0.33). fix1's F scored 3.45 on the same three briefs, so H is +0.26 on them. C scores the same as in fix1 and the final round (3.86), so the judging is consistent.

## Timings and cost (from SCORES.md; median / max over 3 lessons, seconds from start)

All 6 lessons were fired at once, so these times include contention.

| arm | title | first content | midpoint | editable | done | $ median / max | $ total | fit 1st | overflow |
|---|---|---|---|---|---|---|---|---|---|
| H (text briefs) | 1.3 / 1.3 | 18.7 / 26.0 | 30.0 / 41.8 | 52.8 / 58.4 | 64.6 / 73.3 | 0.0331 / 0.0369 | 0.0980 | 67% | 0 |
| visual briefs | 1.0 / 1.3 | 24.4 / 29.0 | 37.5 / 53.2 | 58.2 / 62.5 | 70.2 / 79.7 | 0.0299 / 0.0373 | 0.0863 | 75% | 0 |
| fix1 F (p50 / p90, 8) | 1.2 / 2.0 | 18.8 / 22.3 | 35.4 / 38.4 | 47.7 / 59.1 | 81.2 / 88.9 | 0.0327 / 0.0343 | 0.2579 | 88% | 0 |

Round total: $0.1843, with a mean of $0.031 per lesson, the same as fix1. Only y7 (40.5 s, 6 slides) is near the 40 s editable target. First-fit dropped (67–75% against 88%), but Tidy cleared every overflow.

## Next

1. Text: H is close enough to C to run all 8 text briefs, to confirm the recovery and check that the y5 key fault does not recur.
2. Slides: before a full visual run, make teaching slides carry more of the lesson. Draw the diagrams the topic needs (particle arrangement, runoff and infiltration). Never render a bare planner phrase as a slide (y8 slide 4). Prefer photos that teach over decorative title photos.
