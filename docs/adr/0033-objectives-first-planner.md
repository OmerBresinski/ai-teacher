# 0033 — Objectives-first planner behind `AI_LESSON_PLANNER`; the lesson's stamp decides the path

- Status: Accepted
- Date: 2026-09-26
- Amends: 0025 §5, §21 (a second in-process workflow); 0029 items 1–2 (what the plan job's checkpoint holds under the new planner)
- Ticket: TEACH-93 (builds on TEACH-88, TEACH-90, TEACH-91)

## Context

The legacy Plan stage makes a skeleton call and a facts call, then Verify, all inside
`lesson.plan`. On Luna it failed 3 of 8 runs (quality programme, decision D4). The lab's
objectives-first planner (`src/planner/`, landed dormant by TEACH-91) makes one objectives call,
then per objective a teach call and its question sets in waves, then writes the outline in code.
It was measured at about 30 s to a readable lesson and 47 s to a checked one for about 1.5–2 c.
UX ruling 90 makes that order the product: the teacher confirms the objectives, the editor opens,
slides stream in, Check finishes after.

## Decision

1. **A worker flag picks the planner for a new lesson.** `AI_LESSON_PLANNER` is `legacy`
   (default) or `objectives-first`. `lesson.plan` passes it as `PipelineOptions.planner`. The API
   never reads it.
2. **A second workflow.** `objectivesFirstWorkflow` runs check-input → objectives → facts →
   generate → illustrate → evaluate → repair. Its steps order and resume on their own table
   (`OBJECTIVES_FIRST_ORDER`, `resumeFromObjectivesFirst`); `STAGE_ORDER`, `STAGE_CHECKPOINT` and
   `resumeFrom` are unchanged.
3. **The plan job's checkpoint holds the objectives.** The objectives step makes the
   `plan-objectives` call and persists the title and objectives slides together, once, with the
   objectives (and the starter's retrieval questions) as the only facts, an empty outline and
   `promptVersions.planned = plan-objectives.v<n>`. `stopAfter: "planned"` stops here. A set that
   fails the structural objectives check is asked for once more; a second failure is a retryable
   `StageFailure` (`reason: "objectives-check"`) with a fixed message. With `pinObjectives` no call
   is made.
4. **The facts move to the generate job.** The facts step reads the objectives on the row (the
   teacher's edits included), runs the waves, writes the outline in code, keeps the teacher's
   objective ids and the objectives slide's id, starts Verify without awaiting it, and persists the
   `planned` checkpoint stamped with the four versions that include `outline-from-facts`. Generate
   and Repair read that stamp to print question sets in code.
5. **The stamp decides the path, not the flag.** A lesson with a `promptVersions.planned` stamp
   stays on the planner that wrote it (`plannerFor`); only a lesson with none takes the flag.
   Flipping the flag never strands a lesson, and a retry resumes on the same planner.
6. **Progress stages are unchanged.** Both planner steps report stage `plan`; no value is added
   to `JOB_PROGRESS_STAGES`.
7. **Cost and latency on the summary line.** `generation summary` gains `planner`, `readableMs`
   (the last Generate or Illustrate event) and `checkedMs` (the last Evaluate or Repair event).
   `AI_LESSON_COST_WARN_USD` (default 0.03) logs one `lesson cost above target` warning for a
   finished lesson above it; the stop is still `AI_LESSON_COST_CAP_USD`.
8. **Effort per step.** The planner's default effort is per step (`PLANNER_EFFORT`, `medium` for
   both); `AI_REASONING_EFFORT` still overrides every call through `effortFor`, which receives the
   prompt name, so a later per-step setting needs no change here.

## Consequences

- Rollback is unsetting `AI_LESSON_PLANNER` (or setting `legacy`). Lessons already planned
  objectives-first finish on that path; new lessons plan on the legacy path.
- Under the flag a lesson spends the plan screen at `planned` with an empty outline. The web shows
  no slide placeholders until the facts step lands; `pendingSlides` already treats an empty outline
  that way.
- The lab and production run one implementation: `planFromObjectives` calls the two steps.
- The flag stays unset in every Railway environment until the blind judging of the parity run.
