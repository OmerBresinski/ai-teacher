# Plan-write fix1 round: text result (30 Sep 2026)

> Copied from Greg's local lab on 30 Sep 2026. Raw decks, judge JSON and score sheets stayed local; paths below that are not repo paths refer to that lab. "EVAL-REGISTRY §3" is the protocol now in [`docs/eval/PROTOCOL.md`](../../PROTOCOL.md). Branch heads are on GitHub as `spike/plan-write` and friends.

Arms: **F** is this round's deck (spike/plan-write bbc1993a: stream mode, Sol planner, images on, diagrams merged). **C** is the final round's winner deck, Sol single stream with images off, re-judged here. **P** is production and **O** is the oracle (Opus). 8 briefs, one run of F.

Judging: J6, J5-B and J5-C (the standard protocol (docs/eval/PROTOCOL.md)), run as order 1 and order 2 in `judge/<brief>-o1.json` and `-o2.json`. A pairwise win counts only when both orders pick the same deck; otherwise it is a tie. The files use several schemas; the tally normalised them (J5-B `questions`→`questionQuality`, `flow`→`lessonFlow`, nested `{score}`) and matches every judge's own summary.

**Departures from protocol:** within each order, one agent ran every job and both J5-C deck orders. Facts were checked from memory, with no web search. y4 o1 had no brief. So these results count for less than standard judging.

## Headline

**F is a step back from C on text.** Its J6 faults went from 0 to 3, it loses to C 0–6–2, and it scores 3.40 against C's 3.87. It still beats production 5–1–2. The judges' repeated reasons are a missing retrieval starter (cited in 8 of 16 F judgments) and thin practice.

## J6 faults (8 decks per order)

| arm | order 1 | order 2 | per deck |
|---|---|---|---|
| F | 3 | 3 | 0.38 |
| C | 0 | 0 | 0.00 |
| P | 5 | 7 | 0.75 |
| O | 3 | 5 | 0.50 |

F's faults, found in both orders:
- y6 slide 8 reveals 15 as the answer; the correct answer is 21, and the notes say 21. This is a false key.
- y5 slide 4 tests "tributary" before any slide teaches it.
- y3 slide 8: burial and decay are defensibly swappable in the sort, so there is another correct answer.

## J5-C pairwise, both orders agreeing (W–L–T from F's side)

| pair | W–L–T | y3 | y4 | y5 | y6 | y8 | y9 | y10 | y11 |
|---|---|---|---|---|---|---|---|---|---|
| F–P | **5–1–2** | F | F | P | tie | tie | F | F | F |
| F–C | **0–6–2** | tie | C | C | C | C | tie | C | C |
| F–O | **1–6–1** | O | O | F | O | O | tie | O | O |

Most losses were decided by practice or coverage. F's only win over O (y5) came because O teaches a velocity misconception.

## J5-B 1–5 (mean of 16 judgments)

| arm | pitch | coverage | explanation | practice | questions | flow | coherence | overall | o1 / o2 |
|---|---|---|---|---|---|---|---|---|---|
| F | 3.88 | 3.69 | 3.44 | **2.75** | 3.44 | **3.00** | 3.62 | **3.40** | 3.38 / 3.43 |
| C | 3.94 | 4.44 | 3.81 | 3.38 | 3.75 | 3.81 | 3.94 | 3.87 | 3.88 / 3.86 |
| P | 3.00 | 3.19 | 3.19 | 2.44 | 2.50 | 3.12 | 2.81 | 2.89 | 2.88 / 2.91 |
| O | 4.50 | 3.88 | 3.88 | 3.50 | 3.88 | 4.00 | 4.44 | 4.01 | 4.05 / 3.96 |

F's biggest drops from C are coverage (−0.75), flow (−0.81) and practice (−0.63). C's scores match the final round's (3.86), so the judging is consistent between rounds.

## Timings and cost (from SCORES.md; p50 / p90, seconds from start)

| arm | title | first content | midpoint | editable | done | $ p50 / p90 | $ total (8) | fit 1st | overflow |
|---|---|---|---|---|---|---|---|---|---|
| F | 1.2 / 2.0 | 18.8 / 22.3 | 35.4 / 38.4 | 47.7 / 59.1 | 81.2 / 88.9 | 0.0327 / 0.0343 | 0.2579 | 88% | 0 |
| C (final) | 1.1 / 1.9 | 19.6 / 24.4 | 28.7 / 35.7 | 46.9 / 53.9 | 84.2 / 100.6 | 0.0323 / 0.0370 | 0.2605 | 92% | 0 |

Cost is flat. Editable is +0.8 s at p50 and +5 s at p90, and still fails 40 s on every lesson. Images: 5 photos placed and 3 slots left empty; 4 diagrams drawn and 2 placeholders left.

## Next

Find what dropped the starter and practice between 8d5734c9 and bbc1993a (stream-lesson.v2, the photo pick reasoning room). Restore C's text quality before judging images again.
