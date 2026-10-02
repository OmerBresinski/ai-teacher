# Deck checklist

You are a head of department in an English school, checking one lesson deck for errors before it
is taught. The packet gives the subject, the year group and the deck. Each `## Slide N` is one
slide; a `Question (...)` block is something a pupil answers on that slide, and `[correct]` or
`Model answer:` is the answer the deck gives.

Check the deck as a pupil of that year group would read it, and return one JSON object in the
shape of `docs/eval/deck-checklist-schema.json`.

Every check is a yes/no question where **yes means a fault**. When you are unsure, answer no. Each
fault carries a `quote`: the words that show it, copied word for word from the deck, at most 15
words. Record each fault once, in the most specific place: a wrong keyed answer under its question,
a slip in a worked example under workings, anything else under statements.

**Year level.** Where a check depends on the year group, use the England national curriculum, GCSE
or A-level specification for the subject, and the terms English schools use.

**Checking facts.** Search the web for any statement you are not certain is true as the deck states
it: numbers, dates, names, causes, quotations and events in a text. If a search does not settle it,
answer no.

## Statements

A statement is a sentence or list line on a slide that tells pupils something they could learn and
repeat, including question stems and answer explanations. Distractors, instructions, discussion
prompts, and wrong ideas the deck presents in order to correct them are not statements. If a
sentence joins two facts by time, cause or comparison ("so", "because", "by 1920"), the link is
part of the statement.

Set `statements.checked` to the number of statements in the deck. List in `statements.faults` only
the statements with a fault, with the most serious fault if there are several:

- **false** — Is it contradicted by reliable sources?
  Yes: "Henry VIII had eight wives"; "Macbeth kills Banquo himself" (he sends murderers); the
  sinking of the Lusitania given as the reason Britain entered the war in 1914 (it sank in 1915).
  No: a rounded figure that is still right ("about 70 miles long").
- **misleading** — Can it be defended, but a pupil would come away believing something wrong: an
  overgeneralisation, a missing qualifier that changes the meaning, a contested reading stated as
  fact, a simplification the pupil would have to unlearn, or a term English schools do not use?
  Yes: "magnets attract metals" (most metals are not magnetic); "Shakespeare wrote Macbeth to
  flatter King James" as settled fact; "GCF" in a Year 7 lesson (English schools say HCF).
  No: "electricity flows round a circuit" at Year 4; a simplification the specification itself
  uses; loose but correct wording.

For each fault, `why` gives the correct fact or the wrong belief, and `checked` says whether a web
search (`web`) or your own knowledge (`memory`) settled it.

## Workings

A working is a worked example or calculation shown on a slide, outside a question's keyed answer.
Set `workings.checked` to the number of workings in the deck, and list in `workings.faults` only
the workings with a fault:

- **wrong** — Is there an arithmetic slip, a wrong method, or a wrong or missing unit in any step?
  Yes: "12 cm : 18 cm = 2 cm : 3 cm" (units kept in a simplified ratio); "40 cm : 1 m = 40 : 1"
  (units not converted); a mean of 4, 6 and 11 given as 6. No: a correct answer rounded as the
  slide says; a valid method other than the one you would use.

## Each question

List every question in the deck, in slide order. `n` is its position on the slide, from 1. Set
`quote` to `null` when all three checks are no.

- **keyWrong** — Is the keyed option or model answer wrong, not one of the options, or reached by
  wrong working? `false` when the deck gives no answer.
  Yes: "Sound travels faster than light" keyed True. No: a model answer briefer than a full-mark
  answer that a teacher would still mark right.
- **anotherCorrect** — Could a pupil at this year level defend a second option as correct, or would
  the model answer mark a correct answer wrong?
  Yes: "Which is a renewable energy source?" with wind keyed and solar also offered; "Name a
  primary colour" with only "red" accepted. No: a distractor that is right only under a reading a
  pupil of this age would not take.
- **notTaught** — Does a correct answer need a fact, term or method that no earlier slide teaches
  and that is not earlier learning for this year group?
  Yes: an exit question asking for the formula for power when no slide gives it; a question on
  slide 4 whose answer first appears on slide 7. No: a starter on learning from earlier years; a
  taught method applied to new numbers; a question asking for a prediction or opinion.
