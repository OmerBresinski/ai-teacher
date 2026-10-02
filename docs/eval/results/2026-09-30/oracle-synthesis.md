# Oracle synthesis: how a strong model designs a 10-slide lesson in our format

Inputs: 8 briefs, 8 final decks, 44 checked versions and 8 rationales, written by a strong model (the "oracle") given only our slide format. They are lab working files and are not in the repo; quotes below are short. Every version was re-run through the lab fit-check script (it measures each slide on 10 themes) for this write-up. The renderer claims were probed with synthetic one-slide decks through the same check, and read in the renderer source (`packages/slides/src/`, read-only).

## Headline

- The model plans **the whole lesson first, as one arc**, and then picks forms by matching each idea's natural shape to a form's fixed unit count. Of 80 slides, 62 (78%) fitted on every theme at the first check.
- Nearly all fit trouble came from **two palette faults**: the hinge "Why?" lane and the question-set answer panel. These caused 12 of the 18 slides that ever failed, and most of the 44 versions. The other 6 were sentences written where the form wants a phrase.
- It **never changed a slide's form** to fix fit (0 of 18). It shortened text 36 times, switched a feature off or cut a question 10 times, and moved content to notes 8 times. About 20 of the 36 shortenings did nothing, because the cause was structural. In 4 decks it restored the longer text once it found the real cause.

---

## 1. The shared approach: the order of decisions

All 8 rationales follow the same order. The headings they used are close to identical, which is itself evidence of a fixed method.

1. **Read the class.** Age, prior knowledge and the one misconception that matters. "Most will have met plant parts in Year 3" (y4). "They usually name a device without saying what it does" (y8). "Most can already solve one-sided linear equations but make sign and inverse errors" (y11). "The lesson hangs on one misconception: pupils carry over the molten rule" (y10).
2. **Choose three outcomes, and name the one the lesson builds to.** 8 of 8 decks have exactly 3 objectives. "That last point is what the lesson builds towards. It links the two halves of the topic" (y3). "Objective 3 is the big idea" (y5). Outcomes are written as pupil actions with a concrete example ("2 : 5, so 8 juice goes with 20 water", y6).
3. **Pick one through-line.** This is a single context or question that every slide serves. "The whole lesson runs on one topic pupils have real opinions about: a ban on phones at break" (y8). "The lesson follows one raindrop downhill" (y5). "How could money be worth less than firewood, and why did that matter?" (y9). "All numbers stay inside times-table facts, so the difficulty is in the reasoning" (y6).
4. **Fix the lesson shape as a named arc before any slide.** Each rationale states it in one line: "Hook, then teach, check, teach, check, and an exit ticket" (y3). "Retrieve, model, check, model harder, practise, apply, exit" (y11). "Retrieve, then one new idea, then the rule, then modelled use, then check, practise, apply, and assess" (y10). The order is argued from dependency. "Scaling comes before sharing because it is the simpler idea" (y6). "Devices are the smaller unit. Once pupils have the words, the three-stage structure has something to hang on" (y8).
5. **Budget time, not slides.** "Ten slides for 60 minutes … each slide has to carry about six minutes of classroom activity" (y3, y4, y10 say nearly the same). Timings are written into the notes and add up (y3: "about 57 minutes").
6. **Place the checks before the teaching slides.** One hinge per deck (8 of 8) sits at the lesson's turning point, "the go/no-go point before independent practice" (y10), and "before any new content is added on top" (y4). Every other check sits right after the teaching it tests.
7. **Choose each form by the content's shape and count.** "The four stages match the sort form's four cards exactly" (y3). "Two groups set against each other is exactly what the compare cards are built for" (y4). "The cause really is a chain, so ordered cards fit it better than bullets" (y9). "The two rules really are a pair … That fits two cards with two points each exactly" (y10). When the count does not match, it re-scopes the content rather than cram it. For example, y5 drops the three river courses because "compare holds exactly two sides".
8. **Add a visual only where the idea is spatial or surprising.** A diagram is used where "it is a process in cross-section" (y3), where "structure has to be seen" (y4), or where the idea "is spatial: four ions, two heading to each electrode" (y10). A photo is used for a real case that surprises: the Thames source (y5), a woman burning banknotes (y9), granite next to pumice (y3). No visual at all in English: "a stock photo of a speaker would take space without teaching anything" (y8).
9. **Write questions from misconceptions.** Every hinge distractor maps to a named error: "10 = additive error (+9 to both), 36 = sides swapped, 16 = gave the total" (y6). The notes say what to reteach for each distractor (8 of 8).
10. **Put the activity in the notes.** Demos, pair talk, timings, reteach advice and stretch tasks all go there. Notes average 375 characters per slide. "The notes hold the hands-on work that makes that possible … and each slide stays simple" (y3).

What it used (80 slides): title with agenda 8, exit ticket 8, hinge 8, diagram slot 7, starter set 6, sequence 5, compare 5, worked example 5, open response 5, explain-callout 4, vocabulary 3, photo 3, matching 3, sort 3, true/false 3, discussion 2, check set 2. **Never used:** `objectives` slide, `explain`, `list`, `figure`, `fill-gap`. It wrote no plain text slide at all. Half of all slides (40 of 80) ask pupils to respond.

## 2. Where the 8 differ, and why

**By age.**
- Years 3 to 5 lean on the concrete. There are real objects and demos in the notes (rocks, celery, jar of sediment), gestures for vocabulary, and checks pupils answer without writing: sort, matching, true/false, "fingers" and "stand/sit". The 2 discussion hooks are both about something pupils touch or care about (y3, y8).
- Years 8 to 11 lean on modelling and writing. There are 5 worked examples (all in Years 6, 10 and 11) and open-response writing (y8, y9, y10, y11, and y4 as a transfer task). The hinge sits before independent writing.

**By subject.**
- **Maths (y6, y11):** worked example, then hinge, then a second worked example, then practice. Diagrams carry the model (bar model, balance scale). No photos. Distractors come from computation errors. The practice set of 4 has its on-slide reveal switched off.
- **Science (y3, y4, y10):** led by one misconception, with the diagram placed where the process is. The practical lives in the notes.
- **Geography and history (y5, y9):** a narrative through-line and one real-case photo. `compare` is used for contrasts (source vs mouth, winners vs losers) and `sequence` for causal chains. y9 uses sequence twice "on purpose": "shows that the recovery undoes the chain".
- **English (y8):** no visual. Vocabulary, then an annotated extract (callout), matching, a weak vs strong compare, a hinge, then writing.

**By topic.** The count in the content picks the form: 3 fossil stages go to `sequence`, the fourth is added on the `sort`; 4 river features go to `vocabulary` and `sort`; 2 electrodes go to `compare`. Where the topic had no retrievable prior lesson (y3, y8), the model opened with a discussion hook instead of a retrieval starter.

## 3. How it treated the slide count

**Objectives:** 3 per lesson in all 8. Middle slides (slides 3 to 9): 7 per deck, so about 2.3 per objective.

**Always combined or dropped (8 of 8):**
- Objectives were put on the title slide (agenda layout). "Saves one of the ten" (y3); "frees a slide for the hinge question" (y8, y9).
- No separate objectives slide in any deck.
- Vocabulary was taught in place in 5 of 8 decks. "A separate grid would have cost a content slide" (y9).

**Cut to a later lesson, not squeezed in:** soils and rock properties (y3), photosynthesis (y4), the three river courses and human uses (y5), simplifying ratios (y6), a full model speech and delivery (y8), the Munich Putsch and source work (y9), half equations as Higher only (y10), fractions in equations (y11). Each rationale names the cut and says where it belongs.

**Pushed to notes:** the activity (demos, talk, timings), the extra examples ("your turn" twins, y6, y11), the fourth step a form cannot hold (fossil stage 4, y3; substitution check, y11), and reteach advice. No deck puts taught content only in the notes. What goes there is what the teacher does or says.

**Teach, show and check per objective** (T = teach, S = show or model, C = check, A = apply or write):

| deck | objective 1 | objective 2 | objective 3 | shared |
|---|---|---|---|---|
| y3 rocks | S photo, S diagram, T callout (one per rock type) | (same slides: how each is made) → C matching | T sequence → C sort | hinge on O2 and O3 together; exit |
| y4 plants | S diagram, T vocabulary | T sequence → C hinge | T compare → C true/false → A open | starter; exit |
| y5 rivers | T vocabulary, S diagram | T compare, S photo | C hinge | sort (O1), true/false (O1); exit |
| y6 ratio | T callout | S worked → C hinge | S diagram, S worked → C true/false | practice set (O2 and O3); exit |
| y8 persuasive | T vocabulary, S callout → C matching | T sequence, S compare → C hinge | A open | discussion hook; exit |
| y9 weimar | S photo, T sequence, S diagram | T compare | T sequence → A open | hinge (O1), placed after O2; exit |
| y10 electrolysis | S diagram | T compare, S worked → C hinge, C matching | T callout, A open | starter; exit |
| y11 linear | S diagram, S worked → C hinge | S worked → C sort → practice set | A open | starter; exit |

The pattern: each objective gets one or two teaching slides, and a check follows at once. Checks are not one per objective. There is one hinge per lesson where the lesson turns, and some checks cover two objectives (y3's hinge, y6's practice set). The exit ticket has one line per objective in 8 of 8.

## 4. How it met the fit check

**It planned to units, then fixed fit after.** Each agent wrote the whole deck within the palette schema's "Holds" (the lab description of each form's capacity, given to the designers) and then ran the check. No v1 slide broke a unit limit. All 18 failures were measured fit.

**Versions:** 44 checks in total (per deck: 2, 5, 5, 4, 7, 8, 8, 5). The first pass came at v2 (y3), v3 (y5), v4 (y4, y6, y11), v5 (y8, y10) and v7 (y9). 10 more versions came after a pass. They were probes (re-adding the hinge explanation to see whether it could live: y5, y8, y9, y10, 5 versions) or quality edits (y4, y9, y11).

**What failed at v1:** 18 of 80 slides.

| form | failed | cause |
|---|---|---|
| hinge | 5 of 8 | "Why?" lane (all 5) plus option overflow (y8, y9) |
| starter set | 5 of 6 | answer panel covers a question |
| check set | 2 of 2 | answer panel covers a question |
| exit set | 0 of 8 | — |
| sort | 3 of 3 | sentence cards where labels fit |
| matching | 2 of 3 | sentence phrases on the right |
| discussion | 1 of 2 | a 100-character, three-clause prompt |

**What it changed, counted per slide per version** (an edit is one slide changed in one version step):

| kind of edit | count | fixed the slide? |
|---|---|---|
| **Shortened text** (same form, same units) | **36** | Finally fixed 8 slides: y3 matching and sort, y4 starter, y5 sort, y8 discussion and matching, y9 starter, y11 sort. About 20 edits had no effect. 3 made it worse (y8 v3 discussion 4→6 themes; y9 v4 starter 1→6; y10 v3 starter 5→8). |
| **Switched a feature off** | 7 | Hinge explanation removed 5 times, and it fixed all 5. `revealAnswers: false` on the 4-question check set twice, and it fixed both. |
| **Cut a question** | 3 | Starter from 3 to 2 questions (y6, y10, y11). Fixed all 3. y6 dropped `7 × 4`; y10 moved its question to the notes; y11 merged two questions into one. |
| **Changed form** | **0** | — |
| **Moved content to notes** | 8 | The 5 hinge explanations, the working in y6's answers (2 slides) and y10's third starter question. The practice answers under reveal-off were in the notes already. |
| **Restored longer text** after the real cause was found | 5 slides | y4 hinge options, y6 starter and practice questions, y9 hinge options, y10 starter text. |

In short, the shortening was mostly wasted effort against faults that length cannot fix. Where shortening did work, the cause was a sentence written into a unit that wants a label or phrase: sort cards, matching right sides, the discussion prompt. The designers themselves judged those cuts better teaching: "The shorter cards are also better for 7-year-old readers" (y3); "pupils have to infer each operation" (y11). Two moves to notes are real losses: the on-screen "Why?" in 5 of 8 hinges, and y8's full call to action, "for your friends and for yourself".

## 5. Format faults the designers hit

Each fault was checked with probe decks through the lab fit-check script and in the renderer source.

1. **Hinge "Why?" panel. The designers said it "fails at any length". That is not quite right: it fails whenever any option runs past about 14 characters, whatever the explanation says.**
   - Probe, with a one-word explanation: options of 5 to 14 characters pass on 10 of 10 themes, 16 characters fail on 4 of 10, and 20 fail on 10 of 10. The 3 hinges that kept their explanation (y3, y6, y11) all have options of 9 characters or fewer, and one has a 130-character explanation.
   - Cause: `multipleChoiceSlide` (`packages/slides/src/layouts.ts`) sizes the 2×2 card band above a fixed one-line "Why?" lane (`explanationReserve`, `RESERVED_LINES["multiple-choice"] = 1`, in `explanation-metrics.ts`). With the lane reserved, each card holds one line. A two-line option grows into the lane, and `findLaneOverflow` (`lint.ts`) fails it. Without an explanation there is no lane (`owesExplanationLane`), so the cards can grow.
   - The check never measures the explanation itself. A 130-character reason passes, even though the lane holds one line.
   - **Verdict: a palette limit that is undocumented and badly designed, not a measuring bug.** The lane is reserved for the whole slide life for a panel that only appears after the reveal. Fixes: overlay the panel on the three wrong cards after the reveal, or give the recipe a one-column variant when there is an explanation. At minimum, the palette schema should say "with an explanation, options are one word or number".
2. **Question-set answer panel covers the questions. This is a bug, and part of it is a real limit.**
   - Probe results:
     - Starter, 3 questions of 25 characters: one-word answers fail on 6 of 10 themes, while 30-character answers pass.
     - Check, 2 questions: one-word answers fail on 8 of 10, while 30-character answers pass.
     - Check, 4 questions: fails at every length.
     - Exit: holds 4 questions up to about 50 characters.
   - **Shorter answers making the fit worse is a bug.** y9 saw it ("cutting two answers to a single word made it *worse*"), and y10 v3 went from 5 to 8 themes after shortening.
   - Where to look: the answer placement in `coded-slides.ts` (`withAnswersReveal` / `answersRoom` / `laidOutFits`) and the size choice in `structure.ts` (`layoutQuiz` picks body size, or one step down "when that keeps the set on one slide", and `answersPanel` is anchored to the foot). The non-monotonic result points at the size choice or the fallback placement (`body.h * 0.7`), not at capacity. I did not pin the exact line.
   - Production also has a fallback, `answersClear`: it moves answers to their own slide. A generated deck of fixed count cannot use it, so the check fails instead.
   - **The real limit:** a 4-question check set with an on-slide reveal. The exit recipe (`exitLines`, measured) holds 4, so the check set could use that recipe.
3. **Sort cards and matching phrases** overflow when written as sentences. **This is a real limit** (the card holds a label), and the palette schema's "short labels" is right. Designers still wrote sentences at v1 in 5 of 6 cases.
4. **Discussion prompt** of about 100 characters with three clauses. **A real limit:** one question.
5. **Limits the designers named that are not fit failures.** All are real palette limits, so they are product decisions, not bugs:
   - No figure template for the key visual in 7 of 8 decks. That leaves an empty diagram slot for the bar model, balance scale, electrolysis cell, river profile, bread-price chart, plant parts and rock layers. "The class sees an empty space until someone draws it" (6 rationales).
   - `sequence` holds 3 steps, but fossil formation and sharing a ratio each have 4.
   - A worked example has 3 lines, so there is no room for the check line.
   - `compare` is fixed at 2 × 2.
   - `matching` is exactly 3 pairs, while vocabulary holds 4.
   - No sort-into-groups form (y3 and y4 both wanted one).
   - No source or extract form (y8, y9).
   - No practical or demo form (y3, y4, y10).

## 6. Proposal: a luna pipeline that copies this approach

The oracle's quality comes from **decisions 1 to 7 made once, for the whole lesson, before any slide text is written**. It does not come from writing skill. A cheap model can make those decisions if code gives it a small, closed menu and does the counting.

### Steps

| step | who | sees | produces |
|---|---|---|---|
| A. Lesson plan | **luna call 1** | the brief (topic, year, level, slide count), the palette summary (each form's unit counts and what shape of content it suits, not the examples), and the arc menu (below) | the class read (prior knowledge, one misconception), 3 objectives with the one it builds to, one through-line context, and a **slide table**: role, objective(s) served, form, one-line purpose, and the content's count ("3 stages", "2 groups") |
| B. Plan check | code | the slide table | Enforces the frame: slide 1 is the title with agenda; slide 2 a starter or hook; the last slide an exit with one line per objective; exactly one hinge at 55 to 85% of the deck; every objective taught before it is checked; the form's count equals the content's count, otherwise it names the fix (e.g. 4 stages means `sort`, not `sequence`). Sets the structural switches up front: starter questions (2 with reveal until fault 2 is fixed), check sets use the exit recipe or reveal off, and hinge explanation only when options are "word or number". A failing table gets **one** repair call that names the rule broken. |
| C. Slide writing | **luna calls 2..k**, parallel, 2 or 3 adjacent slides per call | the brief, objectives, through-line, **the whole slide table** (so callbacks and the misconception thread survive), its own rows, each form's palette entry with a filled example, and per-field **text kinds** from code ("label: a word or two", "phrase", "one sentence") | notes first (activity, timing, reteach per distractor), then the slide fields |
| D. Fit | code | each slide | Runs `fitsPlanned` on 10 themes. On a fail, code names the field and the reason ("option 2 wraps to two lines"). One targeted re-write of **that field only**, with its text kind restated. No form change, no notes move, no generic "shorter". |
| E. Assembly | code | everything | Title with agenda from the objectives, timings summed to the duration, exit answers into the notes. |

That is 1 + 1 + about 4 calls, plus rare repairs. Step A is the expensive, important call. Give it the most effort.

**The arc menu** is the closed list that lets luna copy step 4 of the approach. It holds 5 shapes seen across the 8 lessons:
- *retrieve → teach → model → hinge → practise → apply → exit* (maths, chemistry);
- *hook → teach per part → check → teach → check → hinge → exit* (primary science);
- *starter → teach → show → contrast → real case → checks → exit* (geography);
- *starter → hook photo → chain → evidence → contrast → hinge → resolution → write → exit* (history);
- *talk hook → vocabulary → model → check → structure → contrast → hinge → write → exit* (English).

Luna picks one and adapts it. It does not invent a shape.

**Planning fit up front, so nothing needs shortening:**
1. Fix faults 1 and 2 in the renderer. They caused 12 of the 18 failures.
2. Give every text field a **text kind** from code (label, phrase, one sentence), not a character count. The 6 remaining failures were all sentences written into label or phrase fields. r6 prompt v2 and v3 found the same thing: hinge options of 9 to 15 words.
3. Let code, not the model, choose question-set sizes and the reveal switches (step B). These are measured capacities.
4. Choose the form by count match in the plan (step B). The oracle never needed a form change once the count matched.

### Against r6 (the r6 spike notes and its planner under `packages/generation/src/planner/` on the r6 spike branch, not merged)

1. **Who designs the lesson.** r6 runs one design-cycle call **per objective**, and each call sees only its own objective's slots (`prompts/design-cycle.ts`). The oracle designs the whole lesson at once, and its best moves cross objectives:
   - a starter question set up for slide 3 ("question 2 is a 1 : 6 ratio in disguise", y6);
   - a misconception thread from starter to diagram to hinge (y10);
   - a mirrored form ("same form as slide 4 on purpose", y9);
   - one running context (y8, y5).

   **Change:** add a lesson-plan call that writes the slide table, and have every writer see the whole table.
2. **How slides are shared out.** r6 gives each objective at least `R6_CYCLE_MIN = 3` slots (teach, show, check; `cycles.ts`). At 10 slides with bookends that leaves room for **2 objectives** (the Weimar smoke run had 2). The oracle fits 3 objectives, about 2.3 middle slides each, because checks are shared and there is **one hinge per lesson**, not one check per objective. **Change:** allocate by lesson role (arc), not by a per-objective triple.
3. **The frame.** r6 has no fixed starter or exit ticket: the exit is a worksheet recipe and the opening and closing are optional. The oracle used title-with-agenda, a starter or hook, a hinge and an exit ticket in 8 of 8 decks. **Change:** restore the starter, the exit ticket with one line per objective, and one hinge as a fixed frame.
4. **Fit.** r6 fixes after writing through a 5-rung ladder: variant, sibling form, notes, re-fill, step-down (`slot-fit.ts`). That includes form changes (the smoke run turned a hinge into true-false, then into an open response) and asides moved to notes. The oracle changed no forms. Its only real losses to notes were the hinge "Why?", caused by fault 1. **Change:** fix the two faults, then plan fit in the table (step B) and in text kinds (step C). Keep the ladder only as a last resort, and log every time it is used.
5. **Question sets.** r6 writes question sets in separate `plan-question-set` calls. The oracle writes starter and exit lines with the plan, so they tie to the objectives and set up later slides. **Change:** starter and exit lines come from step A's table.
6. **Visuals.** r6 prompt v2 pushed photos ("anything a camera could show"). The oracle used a diagram in 7 of 8 decks and a photo in 3, and chose photos only for a surprising real case. It left English with no visual. **Change:** the plan picks a diagram for process, structure or labels, and a photo for a real case. It is allowed no visual when none teaches.
7. **Unused forms.** The oracle used no `explain`, `list`, `objectives` or `figure` slide. That supports dropping the objectives slide (as r6 does) and not steering towards plain text forms.
