# Plan-write final round: result (30 Sep 2026)

> Copied from Greg's local lab on 30 Sep 2026. Raw decks, judge JSON and score sheets stayed local; paths below that are not repo paths refer to that lab. "EVAL-REGISTRY §3" is the protocol now in [`docs/eval/PROTOCOL.md`](../../PROTOCOL.md). Branch heads are on GitHub as `spike/plan-write` and friends.

Arms (see SCORES.md): **A** Sol plan + luna writers, **B** luna single stream, **C** Sol single stream. **P** production and **O** the oracle (Opus) decks are the references. 8 briefs, one run per arm, images off.

Judging: standard protocol (the standard protocol (docs/eval/PROTOCOL.md)). J6 yes/no checklist, J5-B 1–5 on seven dimensions and J5-C pairwise, run in order 1 (X = alphabetically first arm) and order 2 (X = alphabetically second) by different agents. A pairwise win counts only when both orders pick the same deck; otherwise it is a tie. Tallied by a local script reading `judge/<brief>-o1.json` and `-o2.json`.

## Headline

**C (Sol single stream) is the quality winner.** It has 0 J6 faults in all 16 judgments. It beats production 8–0, B 8–0 and A 6–0 with 2 ties, and it is the only arm that gets close to the oracle (1–4–3). It also has 0 overflow and the best fit-first-time rate (92%). It costs the most, though: 3.3¢ per lesson, and editable arrives at 46.9 s p50.

## J6 faults (16 judgments per arm: 8 decks × 2 orders)

| arm | order 1 | order 2 | mean per 8 decks | per deck | false/misleading (o1/o2) | exact-count agreement | any-fault agreement |
|---|---|---|---|---|---|---|---|
| A | 7 | 6 | 6.5 | 0.81 | 4 / 3 | 5/8 | 7/8 |
| B | 7 | 8 | 7.5 | 0.94 | 3 / 2 | 3/8 | 4/8 |
| **C** | **0** | **0** | **0.0** | **0.00** | 0 / 0 | 8/8 | 8/8 |
| P | 7 | 7 | 7.0 | 0.88 | 3 / 4 | 6/8 | 6/8 |
| O | 4 | 4 | 4.0 | 0.50 | 2 / 2 | 8/8 | 8/8 |

Agreement is per deck: the two orders gave the same fault count (exact), or both found some fault or both found none (any). Overall: exact 30/40 and any 33/40. The disagreements are mostly B's question faults (another correct answer, notes that do not match the key, tested before taught), which one judge flagged and the other did not.

Per deck (o1, o2), with briefs in the order y3, y4, y5, y6, y8, y9, y10, y11:
A (2,1) (0,0) (1,1) (0,0) (1,0) (2,2) (0,0) (1,2) · B (1,2) (0,1) (0,1) (1,0) (2,2) (1,1) (1,0) (1,1) · P (2,2) (2,2) (0,0) (1,0) (1,1) (0,1) (1,1) (0,0) · O (1,1) (1,1) (2,2) 0 elsewhere · C 0 everywhere.

Notable faults: A y3 puts the shell dissolving before the sediment hardens; A y9 has a wrong sort key and notes that name the wrong MCQ option; A y11 notes match every distractor to the wrong option. P y10 says nickel is less reactive than hydrogen. P y8 misstates how Churchill's speech ends (checked on the web). O y5 teaches "fast near source, slow near mouth".

## J5-C pairwise, both orders agreeing (W–L–T from the first arm's side)

| pair | W–L–T | y3 | y4 | y5 | y6 | y8 | y9 | y10 | y11 |
|---|---|---|---|---|---|---|---|---|---|
| A–P | 5–3–0 | P | A | P | A | A | P | A | A |
| B–P | 7–1–0 | B | B | P | B | B | B | B | B |
| **C–P** | **8–0–0** | C | C | C | C | C | C | C | C |
| A–B | 5–2–1 | B | A | tie | A | A | B | A | A |
| A–C | 0–6–2 | C | tie | C | tie | C | C | C | C |
| B–C | 0–8–0 | C | C | C | C | C | C | C | C |
| A–O | 1–6–1 | O | A | tie | O | O | O | O | O |
| C–O | 1–4–3 | tie | tie | C | O | tie | O | O | O |

The orders agreed on 57 of 64 pairs (89%). All 8 C–P and B–C results were agreed. Most were marked "clear" in both orders.

## J5-B 1–5 per dimension (mean of 16 judgments; compare within this batch only)

| arm | pitch | coverage | explanation | practice | questions | flow | coherence | overall | o1 / o2 |
|---|---|---|---|---|---|---|---|---|---|
| A | 3.69 | 3.94 | 3.12 | 3.12 | 3.12 | 3.31 | 3.56 | 3.41 | 3.45 / 3.38 |
| B | 3.62 | 3.19 | 2.94 | 2.75 | 2.94 | 3.38 | 3.25 | 3.15 | 3.20 / 3.11 |
| **C** | 4.00 | **4.19** | 3.88 | 3.50 | 3.75 | 3.69 | 4.00 | **3.86** | 3.82 / 3.89 |
| P | 2.81 | 3.06 | 3.38 | 2.56 | 2.44 | 3.06 | 2.81 | 2.87 | 2.89 / 2.86 |
| O | 4.50 | 3.69 | 3.94 | 3.62 | 3.94 | 3.88 | 4.38 | 3.99 | 3.95 / 4.04 |

## Timings, cost and fit (seconds from generation start; p50 / p90 over 8 lessons)

| arm | title | first content | midpoint | last | editable | done | $ per lesson p50 / p90 | $ mean | $ total (8) | calls p50 | fit first time | overflow after Tidy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 1.2 / 1.7 | 33.1 / 37.8 | 37.0 / 46.3 | 38.1 / 48.1 | 38.1 / 48.1 | 77.0 / 96.4 | 0.0225 / 0.0285 | 0.0235 | 0.1880 | 12 | 52/72 (72%) | 27 slide-themes in 2 lessons (y10 14, y8 13) |
| B | 1.1 / 1.5 | 11.5 / 15.0 | 15.7 / 23.7 | 20.1 / 26.8 | 20.1 / 26.8 | 60.0 / 61.8 | 0.0053 / 0.0065 | 0.0055 | 0.0437 | 9 | 60/72 (83%) | 30 slide-themes in 3 lessons (y9, y3, y8: one slide on all 10 themes each) |
| C | 1.1 / 1.9 | 19.6 / 24.4 | 28.7 / 35.7 | 46.9 / 53.9 | 46.9 / 53.9 | 84.2 / 100.6 | 0.0323 / 0.0370 | 0.0326 | 0.2605 | 6 | 66/72 (92%) | 0 |

All arms delivered 80 of the 80 slides requested, and no lesson failed. "Done" covers verify, evaluate and repair (illustrate is off with images off). Fit first time counts content slides that fit on all 10 themes before any re-write. Production was not timed in this round. Its last measurement (pw2, r5 ruler) was first 32.9 s, editable 36.4 s, $0.0078. The oracle is a reference only, with no latency or cost.

Against the targets (reported, not gated; Greg, 30 Sep): the unit cost target is $0.015–0.02 per lesson. Only B meets it. C is 1.6–2.2× the target and A is just over it. For editable at 40 s, B passes on every lesson, A passes at p50 but not at p90, and C fails on every lesson (43.6–54.3 s). No arm shows the first content slide within 5 s. B comes closest at 11.5 s.

## Ship gate against production

Gate: J5-C in both orders wins more briefs than it loses against P, and the arm has no more J6 false or misleading faults than P (P: 3.5 mean).

| arm | vs P (W–L–T) | false/misleading (mean) | all J6 faults (mean) | gate |
|---|---|---|---|---|
| A | 5–3–0 | 3.5 (equal) | 6.5 vs 7.0 | **passes, narrowly.** It loses y3, y5 and y9 to production, two of them on correctness. |
| B | 7–1–0 | 2.5 | 7.5 vs 7.0 | **passes.** It loses only y5, but it has slightly more question faults than production. |
| C | 8–0–0 | 0 | 0 vs 7.0 | **passes clearly.** |

## Recommended default: C (Sol single stream)

Quality first, and C leads on every quality measure. It has 0 faults, against 6.5–7.5 for the other arms and 4 for the oracle. It wins every head to head with P, A and B that the judges agree on, and it scores top of the three arms on all seven dimensions. It also has 0 overflow and 92% fit first time. Against the oracle it is 1–4–3, and the remaining gap is pitch, practice and coherence richness, not errors.

What C costs, reported alongside:
- **Cost:** 3.26¢ per lesson on average ($0.0323 p50, $0.0370 p90). That is 1.4× A, about 6× B and about 4× production's last measurement, and over the $0.015–0.02 target.
- **Latency:** the first content slide shows at 19.6 s (p50), faster than A's 33.1 s but slower than B's 11.5 s. Editable arrives at 46.9 / 53.9 s, over the 40 s target on every lesson. It streams slides progressively, so the midpoint shows at 28.7 s.

If cost or the 40 s target has to hold, B is the fallback. It passes the ship gate at 7–1, costs 0.55¢ and is editable at 20 s, but it loses to C 0–8 and has the most faults. A sits in between. It is editable sooner than C (38.1 s against 46.9 s p50) and costs less (2.35¢), but its first content slide is the slowest of the three arms (33.1 s), it loses to C 0–6–2, and its fault count is at production's level, so it is not worth choosing over C or B.

## Caveats

- In every order, one agent ran all the jobs (J6, J5-B and J5-C), not a fresh agent per job. Most facts were checked from memory. Only y8's Churchill claim was checked on the web.
- Blinding was partial in several orders. In y3-o1, y3-o2, y6-o1 and y10-o1, the pair list showed which deck was P or O, because P and O appear in fewer pairs. In y5-o1 and y9-o1 it could have hinted at them. In y11-o2, pair files were matched to deck numbers, and in y5-o2 the key was read before J5-C. Most other orders picked winners blind and assigned X and Y only after unblinding, so the order swap is nominal there.
- One run per arm per brief. P and O decks come from earlier runs, not this build.
- The y8-o1 judge found no brief file with objectives, so it judged each deck on its own stated objectives.
