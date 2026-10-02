# Judge rubric v2: in-session blind judging of lesson decks

Supersedes the seven-dimension in-session judge used in the earlier np1 rounds (September 2026 lab notes, not in the repo). The current protocol that uses this rubric is `docs/eval/PROTOCOL.md`. No model calls: every job below is run by an in-session Claude agent.

## Orchestrator protocol (not shown to judges)

Three separate jobs. Each agent does one job on one deck or one pair and sees only the inputs listed for it.

| Job | Unit | Inputs | Used for |
|---|---|---|---|
| A. Claim audit | one deck | deck, subject, year group. **No facts file** | audited false and misleading claims per claim (primary metric); the `correctness` score |
| B. Deck scores | one deck | deck, brief, facts file, practice-expectation line | absolute scores, for monitoring only |
| C. Pairwise preference | one pair | both decks as X and Y, brief, facts file, practice-expectation line | decisions |

Why they are separate:
- **A runs apart from B and C.** Judges that audited facts while also scoring or comparing decks were lenient: the ff pairwise judges found 0 wrong facts in decks where the combined judge had found 2. A has no facts file because it checks truth, not agreement with the facts, and the facts can themselves be wrong.
- **B scores one deck at a time.** Scores given inside a pair are anchored to the partner deck, so they cannot be compared across arms.
- **C only states a preference.** Every pair is judged twice, X/Y swapped, by two fresh agents. A pair is a win only if both orders pick the same deck. A split, or "no preference" in either order, counts as a tie.

**`correctness`** is mapped in code from A: 5 if no claim is misleading or false, 3 if some are misleading and none false, 1 if any is false.

**Practice-expectation line.** Computed by the orchestrator and pasted into the packets for B and C:
- `cycles = max(1, round((durationMin − 15) / 15))`, which gives 3 cycles for a 60-minute lesson and 2 for a 45-minute one. The 15 minutes taken off cover the starter, the exit and the transitions.
- Line template: `Expected in-deck practice for a <durationMin>-minute lesson: a retrieval starter of 3–5 quick items; a check of 2–3 items after each of the <cycles> learning cycles; an exit quiz of 4–6 short items; answers shown on a slide.`
- Sources: plan W2 (f) and the teacher review (Oak exit quizzes have about 6 items; Oak task slides have 3–6).

**Gates and metrics.** This section restates plan W4.
- Before any paid run, re-judge the 20 ff pairs with job C in both orders. Continue only if pairwise-winner agreement is at least 80%.
- Primary metrics:
  - pairwise win rate (C)
  - false and misleading claims per claim (A)
  - code-check tested-not-taught
  - above-band terms counted against the fixed list
- The mean of the B scores is secondary.
- Oak anchor: run B on 3 Oak lessons. If Oak scores below about 4.5, fix the rubric. For Oak there is no facts file, so `fidelity` is null.

**Blinding.** Decks carry only a letter. Never tell an agent which deck is new, what the arms are, or what the experiment tests.

---

## Job A: claim audit (paste verbatim, then the packet)

You are checking the factual claims in one lesson deck written for a UK class. The subject and year group are given. Judge each claim as a pupil of that age would read it.

**What counts as a claim.** A claim is every statement a pupil could be taught or tested on. Look for claims in:
- slide text
- worked-example steps
- model answers
- the correct option of each multiple-choice question
- anything a question takes as given
- teacher notes, since the teacher will say them aloud

These are not claims:
- distractors
- statements presented as a misconception to correct
- instructions

Record each claim as the deck states it. If a sentence links two facts by time, cause or comparison, the link is part of the claim. Two true facts can be joined into a false one.

**Tiers.** Give each claim exactly one tier:
- `true`: accurate as stated.
- `acceptable simplification`: leaves out detail or qualification in the way the curriculum for this year group does. A pupil will not need to unlearn it later.
- `misleading`: each part can be defended, but a pupil would come away believing something wrong. Causes include an overgeneralisation, a missing qualifier that changes the meaning, a wrong emphasis, or two facts fused.
- `false`: contradicted by reliable sources.

**Checking.** Check each claim against reputable sources, and search the web where you can. Two sources are better than one. For each claim, record how you checked it in `basis`:
- `two-sources`
- `one-source`
- `memory`, when you could not check it

For any tier other than `true`, `why` states what is actually the case and names the source.

Answer as JSON:

```json
{"claims": [{"where": "slide 5", "claim": "<quoted as written>", "why": "", "tier": "true", "basis": "two-sources"}]}
```

`tier` is one of `true`, `acceptable simplification`, `misleading` or `false`. `basis` is one of `two-sources`, `one-source` or `memory`.

---

## Job B: deck scores (paste verbatim, then the packet)

You are an experienced UK head of department reviewing one lesson deck: its slides, teacher notes and questions. You judge it against the brief, the facts it was built from, and the class it is for.

Score each dimension from 1 to 5. Anchors are given for 1, 3 and 5, and 2 and 4 lie between them. A competent teacher's own lesson scores 4. Give 5 only when there is nothing you would change. Write `why` before `score`, as one sentence that names the slide or question you used as evidence.

**Worksheets are a separate job.** Score practice on what is in the deck, against the expected in-deck practice line in the packet. Ignore any worksheet. Do not raise or lower a score because a worksheet is present or missing.

- `fidelity`: slide content matches the facts file.
  - 1: slides state things the facts file does not support, or change what the facts say.
  - 3: minor additions or rewordings that go beyond the facts.
  - 5: every taught point traces to the facts file.
  - Null when no facts file is given.
- `pitch`: language, examples and demand fit the year group.
  - 1: clearly above the year group (terms or demand from a later stage), or below it (content the class already knows presented as new).
  - 3: mostly right, with a few terms or sentences mis-pitched, or a term used but never taught.
  - 5: reading level, examples and demand sit squarely with the class.
- `coverage`: every objective and key idea is taught on a slide, not only in the notes or the vocabulary.
  - 1: an objective is never taught, or pupils are tested on content no slide teaches.
  - 3: every objective is taught, but a key idea appears only in the notes or the vocabulary.
  - 5: every key idea is taught on a slide before it is practised.
- `explanation`: key ideas are explained, not just stated.
  - 1: definitions restated with no build-up or example.
  - 3: ideas come with examples, but at least one is asserted rather than explained.
  - 5: each key idea is explained with an example, and the misconception it heads off is named.
- `practice`: the amount and kind of pupil work in the deck, measured against the expected line and the objective verb.
  - 1: far below the expected line, or the tasks do a different job from the verb, e.g. recall items for an Evaluate objective.
  - 3: roughly half of the expected line, or the tasks fit the verb but are only recall.
  - 5: meets the expected line, and includes tasks that do what the verb asks, e.g. a modelled judgement and a judgement question for Evaluate.
- `questionQuality`: each question is well formed.
  - 1: a multiple-choice stem shown without its options, a question that cannot be answered from what was taught, or duplicate or degenerate options.
  - 3: answerable, but the distractors are obvious, or the correct option can be spotted by its length or punctuation.
  - 5: distractors are real misconceptions, nothing gives the answer away, and the questions mix recall and reasoning.
- `lessonFlow`: where the practice sits and how the lesson moves.
  - 1: all practice comes after all the content, with no starter and no checks.
  - 3: a starter or some checks, but a learning cycle has no check, or the exit task is long written answers.
  - 5: a retrieval starter; a check after each learning cycle; teacher models, class tries together, then pupils work alone; a short exit quiz; answers revealed on a slide.
- `notes`: the teacher notes tell the teacher what to do.
  - 1: empty or generic, or they contain commentary about how the deck was made.
  - 3: they summarise the slide but name no question to ask and no misconception to watch for.
  - 5: they name what to say, a question to ask, and the misconception to head off.
- `coherence`: the slides build on each other.
  - 1: slides repeat the same point or question, or the order does not build.
  - 3: a clear order, but one or two slides restate an earlier one.
  - 5: every slide adds something, and the deck reads like a planned lesson.

Also list `testedNotTaught`: every question, model answer or exit item that relies on content no slide teaches. Content that appears only in the notes or the vocabulary does not count as taught. Quote each item with its slide number.

Answer as JSON:

```json
{"fidelity": {"why": "", "score": 4}, "pitch": {"why": "", "score": 4}, "coverage": {"why": "", "score": 4}, "explanation": {"why": "", "score": 4}, "practice": {"why": "", "score": 4}, "questionQuality": {"why": "", "score": 4}, "lessonFlow": {"why": "", "score": 4}, "notes": {"why": "", "score": 4}, "coherence": {"why": "", "score": 4}, "testedNotTaught": ["slide 9: '<question>' (<what is missing>)"], "summary": "<two sentences: the main strength and the main thing to fix>"}
```

---

## Job C: pairwise preference (paste verbatim, then the packet)

You are an experienced UK head of department. Two lesson decks, X and Y, were written from the same brief and the same facts. Read both in full.

**Worksheets are a separate job.** Compare only what is in the decks, using the expected in-deck practice line in the packet.

Decide which deck you would rather teach to this class tomorrow, unchanged. Weigh these, roughly in this order:
1. whether anything a pupil learns is wrong
2. whether the objectives are taught before they are tested
3. whether there is enough practice of the right kind, in the right places
4. pitch
5. the quality of the explanations, questions and notes

Choose `no preference` only when you would be equally content to teach either deck.

Answer as JSON:

```json
{"reason": "<at most 30 words naming the difference that decided it, with slide numbers>", "decidedBy": "coverage", "preference": "X", "strength": "clear"}
```

- `decidedBy` is one of `correctness`, `fidelity`, `pitch`, `coverage`, `explanation`, `practice`, `questionQuality`, `lessonFlow`, `notes` or `coherence`.
- `preference` is one of `X`, `Y` or `no preference`.
- `strength` is one of `clear` or `slight`, and is null when `preference` is `no preference`.
