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
3. **What is guaranteed, and what is not.** The prompt (`Slides: N`, the count sentence) and the
   strict schema (`flow` exactly N, `slides` exactly N − 2) are the enforcement. Code does not
   trim or pad a deck. A trim protects nothing structural: it can drop the recall opener, half of
   a worked example and its "your turn" pair, the plenary, or a slide another slide refers to.
   A mid-deck trim also moves every later slide's index, so pictures are fetched again, and a
   trimmed tail slide's pictures are orphaned but still billed. So:
   - **Any number over, or up to 2 under:** the deck ships as written, and the stage logs
     `count-miss` (`level: "warn"`, `requested`, `delivered`; `writer/count.ts`, called in
     `writer/stage.ts`). The job does not fail. A brief with no count (a range) logs nothing.
   - **More than 2 under** (for 10: 7 slides or fewer, title and objectives included), a
     `length` finish, or JSON that does not parse fails the job (K3, `writerIncomplete`): the job
     rolls back to the plan and retries. A closed JSON with 3 of 10 slides never ships.
   - The miss rate is measured from `count-miss` and the teacher's-path check (`fitReport`
     requested against delivered). A model-side repair (add one slide, or merge two) is added only
     if misses turn out to be common.
   Continuation pages added by the fit repair are not counted (`fitReport` `delivered`).

## Consequences

- `fitReport`'s requested and delivered agree for writer lessons.
- The brief's label should say that the count includes the title and objectives. That is a UX
  ruling for the UX Improvements project, not decided here.
- `objectiveCount` (one or two / two or three / three or four objectives) now reads the exact
  count, which is the same tier for 6, 8, 10 and 12.
