# 0036 — The writer's slide count is the teacher's, title and objectives included

- Status: accepted
- Date: 2026-10-09
- Ticket: TEACH-110 part k
- Related: ADR 0025 (generation pipeline), ruling 164 (slide tiers), TEACH-110 part b (K1 flow bounds)

## Context

The brief offers exact counts (6, 8, 10 or 12: `step-fields.tsx`, `lesson-brief.page.tsx`).
`slideRange()` (`packages/generation/src/stages/write.ts`) turned that count into ruling 164's tier:
up to 8 became 6–8, 9–12 became 9–12, above 12 became 13–20. The writer was told "the context
gives a range of slides; choose the number in that range", so the teacher's number never reached
it. Production lesson 01a12146 asked for 10 and got 12 (the top of 9–12); `fitReport` reported 12
against 10. Nobody had ruled whether "10 slides" means 10 in total or 10 teaching slides.

Evidence for what the count counts:

1. **What the teacher sees and the report measures.** The editor's slide strip, Present and
   `fitReport` (`packages/slides/src/fit-report.ts`, `delivered` = every slide but continuation
   pages) count the title and objectives slides. A teacher who asks for 10 and opens a deck of 10
   in the strip has what they asked for.
2. **The writer already counts that way (K1).** `flow` numbers every slide from 1, title and
   objectives included; the schema bounds `flow` to the whole lesson and `slides` (slide 3 on) to
   the count minus 2. Lesson 01a1214c asked for 12 and got 12 in total, and was read as correct.
3. **Continuations stay out.** A fit repair that moves overflow to a continuation page does not
   change `delivered`, so the exact count survives the repair path.

## Decision

1. `slideRange(n)` returns `{ min: n, max: n }`, held to 6–20. No count (a brief without one, the
   lab's briefs) keeps the Standard range 9–12. This replaces ruling 164's tiers for the writer
   planner only; objectives-first is unchanged.
2. The count includes the title and objectives slides. The writer's schema bounds `flow` to
   exactly n and `slides` to exactly n − 2; the user turn reads `Slides: 10`, and the system
   sentence says the count includes the title and the objectives (`writer/contract.ts`
   `COUNT_LINE`; the pinned bundle files are unchanged, the line is replaced in code).
3. **What is guaranteed.** The strict schema asks for exactly n, and code holds it after the
   writer answers (`writer/count.ts` `fitCount`, called in `writer/stage.ts`):
   - **Over by any number:** each extra slide is trimmed in code, with no model call. The trimmed
     slide is the one whose loss leaves the objectives most covered: a teaching slide before a
     check slide, then the one with fewest words. The flow is renumbered, and slides opened while
     streaming past the new end are cancelled. A `count-fit` warning names the trimmed slides. A
     deck is never longer than n.
   - **One short:** the deck ships as written (n − 1 slides) with a `count-fit` warning,
     `short: 1`. The job does not fail. No slide is invented to fill the gap.
   - **Two or more short:** K3 (`writerIncomplete`) still fails the job, as before. A gap that
     size is a cut or broken stream, not a count slip, and the job's retry is the right answer.
   - A `length` finish or JSON that does not parse still fails the job (K3).
   So a writer lesson has exactly n slides, or n − 1 with a logged warning, or the job fails and
   retries. Continuation pages added by the fit repair are not counted (`fitReport` `delivered`).

## Consequences

- `fitReport`'s requested and delivered agree for writer lessons.
- The brief's label should say that the count includes the title and objectives. That is a UX
  ruling for the UX Improvements project, not decided here.
- `objectiveCount` (one or two / two or three / three or four objectives) now reads the exact
  count, which is the same tier for 6, 8, 10 and 12.
