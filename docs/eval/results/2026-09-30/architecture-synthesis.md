# Architecture synthesis (30 Sep 2026)

No model calls. Cost and latency are estimates from the per-model rates measured in the September model bench (lab notes, not in the repo); only the title card is measured. Names in code font such as `checkSpine`, `pack.ts`, `writerSchema` and `contractText` are proposed or spike-branch code, not on `master`.

**Evidence:** code-owned structure lost twice (F 1–6, r6 3–5); the oracle won 7–1 with one mind choosing the arc; Sol beat luna 12–0–4. So the model owns the arc and code owns the rules.

## 1. Recommended: Sol plans matrix + spine, code gates, luna fills contracts

| # | Step | Who | Output |
|---|---|---|---|
| 0 | Title card | code | saved at about 1 s |
| 1 | Plan: one streamed, strict-schema call | **gpt-6.1-sol, low** | In key order: **header**: class read, one misconception, through-line, objectives (each with `depth`, `shape`, `visual`, `builds-to`). **spine**: required keys `r02…rNN`, each a role enum, objective ids, point/check ids, form+layout enum, callout/visual flag, no prose. **detail** per objective: 1–3 teach points, show case or visual brief, check items with `assesses: pointId`, distractors mapped to named errors. |
| 2 | Gate | code (`checkSpine`, `pack.ts` as validator) | named rule failures → one Sol repair → minimal deterministic repair |
| 3 | Writers, parallel, each starting as its objective's detail closes | **gpt-6-luna** | slot fields, then notes, in one call. Shared cached prefix = whole plan. Each also gets its row, `writerSchema`/`contractText`, and one checked oracle slide of the same form. |
| 4 | Hinges and question sets written twice | **gpt-6-luna** | keep the first write that fits and passes the answer-key check |
| 5 | Lint and fit | code | text-kind, duration and answer-key lints, then `fitsPlanned` on 10 themes. A failure gets a field re-ask restating its text kind, then a same-unit sibling layout, then a flag. Never shorten, never split. |
| 6 | Push and save | code | SSE per slide; agenda on title when header closes; saved fitted; illustrate and Verify alongside |

**How each requirement holds:**
- **Exact N.** Required keys are enforced by strict decoding (`minItems` is not). Nothing later adds or removes pages.
- **Taught before checked.**
  - The gate asserts that each objective has a teach point on a row and at least one check item.
  - Each `assesses` point sits on an earlier row.
  - Teach points are slide fields; notes come after the slide; a lexical check finds each check's key terms in earlier slide text.
- **Too many objectives.**
  - A teach slide may cluster up to 3 objectives, each named on it.
  - A check item may assess up to 2 objectives.
  - The floor is `1 + ⌈K/3⌉ + ⌈K/8⌉` slides, so the Y7 particles brief (`docs/eval/results/2026-09-30/stress-brief-y7-particles.md`, K = 8) fits 6 slides, thin but complete.
  - Below the floor, the input check asks the teacher before the call. Nothing is dropped silently.
- **Fit.** Measured contracts, count-bound schemas, text-kind lint, write-twice.
- **Visuals.** An objective with `visual ≠ none` needs a photo, figure or diagram row. A photo placeholder is allowed.
- **Callouts.** The misconception is routed to a callout, a true/false slide or a hinge distractor, or the plan is rejected.
- **Variety and practice.**
  - No neighbouring slides share a layout.
  - At N ≥ 8: at least 3 forms, pupils respond on at least 40% of slides, and at least one practise row (r6's loss).
- **Structure.** Only the title is fixed; starter, hinge and closing are Sol's choice; exit ticket on the worksheet.
- **Minimal repair** only moves a check after its teach row, swaps a same-unit sibling form, or merges two thin teach rows; never re-orders the arc.

**Cost:**
- Sol: about 2.5k in (cached prefix) and about 1,100–1,250 out, so $0.012–0.014.
- Luna writers: about $0.0003 each.
- **Total: about $0.017 at 10 slides and $0.020 at 15.** The cap binds at 15.
- Levers: Verify on luna; arm A at N ≥ 12.

**Latency:**

| Milestone | p50 / p90 |
|---|---|
| Title | about 1 s |
| Spine closes | 8 / 11 s |
| First content slide | 16 / 20 s |
| **Editable, 10 slides** | **25 / 33 s** |
| **Editable, 15 slides** | **27 / 35 s** |

## 2. Changes to the plan-then-write baseline

1. **Schema.** Add the header matrix with `assesses` ids. Spine rows become enum/id-only required keys with no prose aims, so Sol's output is nearly flat in N and N is exact. Prompts go via prompt-engineer.
2. **Stream order.** Header, then spine, then detail. Writers start per objective, not after the whole plan.
3. **Gate.** `checkSpine` plus assesses order, visuals, misconception routing, neighbours, practice floor and cluster limits, with one repair call. `pack.ts` is the validator and minimal repair, property-tested in CI over K 1–8 × N 6–15 × 7 bands.
4. **Writers.** A cached whole-plan prefix, one exemplar slide per form, fields before notes, and write-twice for hinges and question sets.
5. **Fit and save.** Lints before `fitsPlanned`, SSE per slide, and Tidy `split:false`.
6. **Logging.** Out tokens, cost, gate first-pass rate, repairs.

## 3. Alternative arms

- **A. Coverage pack.** Sol writes the header and detail only, and pure `pack.ts` orders the rows by fixed ladders.
  - *Might win:* most repeatable, cheapest at 15. *Risk:* F/G template feel. Free to test on the main arm's matrices.
- **B. One Sol stream writes the slides (N ≤ 10).**
  - *Might win:* single-context coherence (oracle 4.25 vs 2.62). *Risk:* $0.018, no margin. Kept only if it wins J5-C within $0.02.

Not built: the exemplar library (luna plans, a library that goes stale) and generate-and-select (scores structure, not teaching). Their write-twice and exemplar-slide ideas are kept.

## 4. Eval matrix

**Briefs (14):**
- Current: y3 rocks, y4 plants, y6 ratio, y8 persuasive writing, y9 Weimar, y10 electrolysis.
- New: Reception counting to 10, Y1 phonics (split digraphs), Y7 particles (8 objectives), Y7 PE (creating space), Y8 art (tone), Y10 GCSE Macbeth (ambition), Y12 A-level Hess's law, Y13 psychology (Freud).
- Half come with teacher objectives.

**Cells:** 14 briefs × N {6, 10, 15} × 3 repeats = **126 lessons**.

**Code metrics (every lesson):**

| Metric | Pass |
|---|---|
| objectives taught on a slide before checked | 100% |
| count = N | 100% |
| overflowing slides, 10 themes | 0 |
| first-time fit | ≥ 85% |
| visuals per eligible objective | ≥ 1 |
| misconceptions routed / planned callouts placed | 100% / ≥ 90% |
| layout variety | no adjacent repeats; ≥ 3 forms at N ≥ 8; distinct ÷ (N−1) reported |
| respond share, N ≥ 8 | ≥ 40% |
| duration tokens, notes-only tests | 0 |
| cost / title / editable p90 | ≤ $0.02 / ≤ 5 s / ≤ 40 s |
| repeat variance per cell | form-sequence edit distance ≤ 3; objectives stable; cost spread reported |

**Standard judging (`docs/eval/PROTOCOL.md`):**
- J6 on all N = 10 decks (repeat 1), plus the stress brief at 6.
- J5-C in both orders, with two fresh agents per pair:
  - main vs production, 14 briefs at N = 10. This is the ship gate: wins > losses, and J6 faults not higher.
  - main vs arm A, and main vs arm B, on 8 briefs.
- J5-B repeat spread, 4 briefs, one batch.

**Spend (estimate):**

| Item | Cost |
|---|---|
| Main arm | $2.27 |
| Arm A | $0.05 |
| Arm B | $0.50 |
| Production | $0.14 |
| **Total** | **≈ $3.0**, staged, inside the $5 budget, logged in the lab spend ledger |

Judging runs in session.

## 5. Build order, each step with its falsifier

1. **Gate + pack property test (free).**
   - *Fails if:* any wrong N, uncovered objective or check before teach, or any K at or under the floor reported infeasible.
2. **Planner v3, plan only, 16 briefs (about $0.20).**
   - *Fails if:*
     - gate first pass is under 80%;
     - out tokens exceed 1,300 at 15;
     - spine p90 exceeds 11 s;
     - it has more J6 faults than plain v2;
     - it loses pairwise to plain v2.
   - Arm A packs the same matrices; killed if it loses pairwise at 10 or a repeat changes > 2 forms.
3. **Writers, 8 decks at 10 (about $0.03).**
   - *Fails if:* first-time fit < 85%, any overflow after the chain, a notes-only test, or a duration token.
4. **Streamed integration, 5 runs at 10 and 15 (about $0.10).**
   - *Fails if:* title > 1.5 s, editable p90 > 38 s, or cost > $0.02 at 15.
5. **Stage-1 eval: 14 briefs × N 10, against production.**
   - *Fails if:* J5-C wins ≤ losses, or it has more J6 faults.
6. **Full 126 lessons, plus arm B.**
   - *Fails if:* any hard metric is missed, or repeat edit distance exceeds 3.
   - B replaces main at N ≤ 10 only if it wins J5-C within $0.02.
