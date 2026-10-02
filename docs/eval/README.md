# How lesson quality is judged

Every lesson test is judged by blind Claude agents (Opus), run in a coding-agent session with no
paid API calls. There are three jobs, and each agent does one of them. The agents never know which
deck is ours, which is a competitor's, or what the test is about. Each deck is exported to plain
text first (slide by slide, questions with their keyed answers, and a line describing each picture)
and labelled only A or B.

The full protocol is `docs/eval/PROTOCOL.md`. For the pipeline eval set (`bun run eval:schema`,
`bun run eval:paid`), which checks that lessons are produced and well formed, see `docs/eval.md`.

## Files

| Path | What it is |
|---|---|
| `docs/eval/README.md` | This overview, the how-to and the results index |
| `docs/eval/PROTOCOL.md` | The current judging protocol and the deck-to-text export |
| `docs/eval/DECK-CHECKLIST.md` | The yes/no fault checklist given to J6 judges |
| `docs/eval/deck-checklist-schema.json` | The JSON shape a J6 judge returns |
| `docs/eval/judge-rubric-v2.md` | Rubric v2: Job B (scores out of 5) and Job C (head to head); Job A is optional now |
| `docs/eval/tools/deck-text.ts` | Exports a lesson document to the plain-text packet judges read |
| `docs/eval/results/2026-09-30/` | Reports from 30 Sep 2026 (index below) |

## 1. The yes/no fault checklist (J6, main measure)

Rubric: `docs/eval/DECK-CHECKLIST.md`. Output shape: `docs/eval/deck-checklist-schema.json`.

One agent checks one deck, acting as a head of department. Every check is a yes/no question where
**yes means a fault**; if the agent is unsure, the answer is no. Each fault quotes the deck word for
word. The checks are:

- **false**: a statement contradicted by reliable sources. The agent must web-search anything it
  isn't sure of: numbers, dates, names, causes and quotations.
- **misleading**: defensible, but a pupil would come away believing something wrong. This covers
  overgeneralising, dropping a qualifier, stating a contested reading as fact, or using a term
  English schools don't use.
- **wrong working**: an arithmetic slip, a wrong method, or a wrong or missing unit in a worked
  example.
- For every question:
  - **keyWrong**: the keyed answer is wrong.
  - **anotherCorrect**: a pupil could defend a second option.
  - **notTaught**: the answer needs something no earlier slide teaches.

The number we report is the total faults per deck, and fewer is better. It's the most stable measure
we have: two runs agreed on 87% of the flagged faults.

## 2. Blind head to head (J5-C, the ship decision)

Rubric: `docs/eval/judge-rubric-v2.md`, Job C.

An agent reads two decks for the same brief and picks the one it would rather teach tomorrow,
unchanged. It weighs, roughly in this order:

1. anything wrong;
2. objectives taught before they're tested;
3. enough practice of the right kind;
4. pitch;
5. the quality of explanations, questions and notes.

Every pair is judged twice with the order swapped, by two fresh agents. It only counts as a win if
both orders pick the same deck; otherwise it's a tie. **A change only ships if it wins more head to
heads than it loses and has no more faults.**

## 3. Scores out of 5 (J5-B, secondary)

Rubric: `docs/eval/judge-rubric-v2.md`, Job B.

One agent scores one deck, with anchors given for 1, 3 and 5. A competent teacher's own lesson
scores 4, and a 5 means nothing needs changing. The agent writes its reason before its score, naming
the slide it used as evidence. The seven dimensions are:

- **pitch**: language and demand fit the year group;
- **coverage**: every objective is taught on a slide before it's practised;
- **explanation**: ideas are explained with examples, not just stated;
- **practice**: enough pupil work, of the kind the objective verb asks for (for example, an
  "evaluate" objective needs evaluating, not recall);
- **questions**: good distractors, and nothing gives the answer away;
- **flow**: starter, checks after each chunk, then modelled, guided and independent practice;
- **coherence**: every slide adds something, and the deck reads as one planned lesson.

The overall score is the mean. **Scores only compare within one judging batch.** The same code has
scored 3.34 in one batch and 3.50 in another, so never compare numbers from different runs.

`docs/eval/judge-rubric-v2.md` also has a **notes** score, a **fidelity** score (checked against the
lesson's facts) and a claim audit (Job A). Those were used earlier and are optional now.

## How to run a judging round with an agent

1. **Export decks to text.** For each lesson document (JSON), run
   `bun docs/eval/tools/deck-text.ts <deck.lesson.json> <out.txt>`. Export a competitor's deck by
   hand to the same shape. Details in `docs/eval/PROTOCOL.md`.
2. **Blind them.** For each brief, name the two exports `A.txt` and `B.txt`, assigning arms to
   letters at random per brief. Write the mapping to a key file kept outside the folder the judges
   read. Strip anything that names an arm, a model or a product.
3. **Run the checklist per deck (J6).** One fresh agent per deck: paste `docs/eval/DECK-CHECKLIST.md`,
   then the packet header (subject, year group, which markers the export uses) and the deck text.
   Collect the JSON in the shape of `docs/eval/deck-checklist-schema.json` and total the faults.
4. **Run the head to head in both orders (J5-C).** For each brief, one fresh agent with A as X and B
   as Y, and a second fresh agent with B as X and A as Y, each given Job C from
   `docs/eval/judge-rubric-v2.md`, the brief and the practice-expectation line. Record a win only
   where both orders pick the same deck; otherwise a tie.
5. **Run the out-of-5 per deck (J5-B).** One fresh agent per deck with Job B from
   `docs/eval/judge-rubric-v2.md`. Judge both arms in this same batch.
6. **Unblind.** Only after every judgment is written down, read the key file and map the results to
   arms. Report faults per arm, head-to-head wins, losses and ties, and the out-of-5 means, and apply
   the ship rule: more wins than losses and no more faults.

Note in the report any departure from the protocol, such as one agent reading both orders of a head
to head (it counts for a little less) or facts checked without web search.

## Caveats

- Judges are Opus agents running in a coding-agent session, not the lesson models. Sonnet was
  tested as a judge and disagreed too much to use.
- The protocol asks for two fresh agents for the two orders of a head to head. In some recent runs
  one agent read both orders, which counts for a little less.
- In Job B, the "expected practice" line is worked out from lesson length in minutes. That's only a
  guide for the judge; lessons themselves carry no timings.

## Results index

Handoff to Omer: [`docs/eval/HANDOFF-2026-09-30.md`](HANDOFF-2026-09-30.md). Lab harness: [`docs/eval/lab/`](lab/README.md).

Reports from 30 Sep 2026, in `docs/eval/results/2026-09-30/`:

| File | What it is |
|---|---|
| [`docs/eval/results/2026-09-30/oracle-scores.md`](results/2026-09-30/oracle-scores.md) | Standard judging of the "oracle" (a strong model given only our slide format) against production, 8 briefs |
| [`docs/eval/results/2026-09-30/oracle-synthesis.md`](results/2026-09-30/oracle-synthesis.md) | How the oracle designed its lessons, the two format faults it hit, and a proposed pipeline that copies its approach |
| [`docs/eval/results/2026-09-30/r6-result.md`](results/2026-09-30/r6-result.md) | Fit-lab round 6 (arm G) against production, 8 briefs: fails the ship gate 3–5 |
| [`docs/eval/results/2026-09-30/final-round-result.md`](results/2026-09-30/final-round-result.md) | Plan-write final round: Sol single stream wins (0 faults, beats production 8–0) |
| [`docs/eval/results/2026-09-30/fix1-result.md`](results/2026-09-30/fix1-result.md) | fix1: images and diagrams on; text regresses, visual 1–7–1 against Chalkie |
| [`docs/eval/results/2026-09-30/fix3-result.md`](results/2026-09-30/fix3-result.md) | fix3 (current head): text recovers, Chalkie still wins visually 3–0 |
| [`docs/eval/results/2026-09-30/layout-audit-summary.md`](results/2026-09-30/layout-audit-summary.md) | Layout audit against Chalkie: headline numbers and ten ranked fixes |
| [`docs/eval/results/2026-09-30/root-cause-chalkie.md`](results/2026-09-30/root-cause-chalkie.md) | Why Chalkie's slides beat ours, with ranked fixes |
| [`docs/eval/results/2026-09-30/spend-summary.md`](results/2026-09-30/spend-summary.md) | OpenAI test spend totals to 30 Sep |
| [`docs/eval/results/2026-09-30/architecture-synthesis.md`](results/2026-09-30/architecture-synthesis.md) | Recommended generation architecture, alternative arms, eval matrix and build order |
| [`docs/eval/results/2026-09-30/chalkie-fit.md`](results/2026-09-30/chalkie-fit.md) | Research: how Chalkie fits lessons to a fixed slide count, and what we could adopt |
| [`docs/eval/results/2026-09-30/chalkie-rivers.md`](results/2026-09-30/chalkie-rivers.md) | Chalkie Y8 rivers deck, 15 Sep against 30 Sep, judged blind on this protocol |
| [`docs/eval/results/2026-09-30/stress-brief-y7-particles.md`](results/2026-09-30/stress-brief-y7-particles.md) | The Y7 particles stress brief: eight objectives on six slides |

Summary on this rubric (30 Sep):

| Test | Faults | Head to head | Out of 5 |
|---|---|---|---|
| Opus given only our slide format vs our production | 5 vs 9 | Opus won 7, lost 1 | 3.96 vs 2.95 |
| Our r6 test pipeline vs production | 5 vs 8 | r6 won 3, lost 5 | 3.29 vs 3.29 |
| Chalkie rivers today vs Chalkie rivers 15 Sep | 1 vs 0 | the old one won | 3.00 vs 3.43 |

Each row is its own batch, so compare within a row, not across rows. In all three, one agent read
both head-to-head orders.
