# Handoff: lesson-level historical period (B1, UX ruling 163)

Branch `fix/historical-period`. The prompt and schema are done; storage and the guards are still to wire.

## The field
- Call: **check-input** (`packages/generation/src/stages/check-input.ts`), prompt `check-input.v5`
  (`packages/generation/src/prompts/check-input.ts`), schema `CheckInputOutputSchema`
  (`packages/generation/src/specs.ts`).
- Output: `call.output.historical_period: string | null` sets the real past the content is in
  ("Ancient Egypt", "Second World War"). It is null for present-day or timeless content.
  `call.output.fiction_in_period: boolean` is true for a story, play or poem set in that period,
  and then `historical_period` names the period too.
- Both have zod defaults (`null`, `false`), so the old `{ findings: [] }` fakes still parse.
  Because of those defaults, the JSON schema sent to the model marks them optional. The prompt
  asks for them every time, and the bench found them in the raw output 60/60.

## Why check-input
It runs on every writer lesson. `checkedWriterObjectives` (stages/objectives.ts) starts it beside
the objectives call, so it adds no latency. It is gpt-6-luna at low effort. It also runs on a
pinned re-plan, where the objectives call is skipped. The objectives call runs on Sol, which sits
on the critical path.

## Storage (to do)
- `checkInput()` returns `state` and drops the output. Return the two fields as well, or put
  them on state.
- In `checkedWriterObjectives` the result is passed as `gate: checked` and awaited just before
  `deps.persist(planned)` in `runObjectivesStep`. Write the fields onto the planned lesson there
  (for example `lesson.historicalPeriod`, `lesson.fictionInPeriod`), so they are stored once at
  `planned`.
- The legacy and objectives-first workflows call `checkInput` as their own step. Either thread it
  there too, or leave it writer-only.

## Guards to rekey (to do)
Each one tests `/^hist/i` on `lesson.subject`, which brief-only intake never sets. Key them on
"period set" (plus the subject test, kept as a fallback):
- `packages/generation/src/stages/picture-set.ts:259`
- `packages/generation/src/stages/picture-director.ts:574`, `:1142`, `:1269`, `:1501`
  (`setIsGenerated(..., opts.lesson.subject)`)
- `packages/generation/src/writer/activities.ts:318`

## Fiction policy (not decided)
Greg has not ruled on fiction set in a past period (A Christmas Carol). The strict reading is
`historical_period !== null`. The fiction-exempt reading is
`historical_period !== null && !fiction_in_period`. Keep it as one predicate so the ruling is a
one-line change.

## Bench
`scratchpad/quality-prd/lab/rounds/PERIOD/` holds the inputs and results: `labels.json`
(pre-registered, 30 briefs, subject not given) and `bench.ts`, which drives the production
`callStructured`. `run1.jsonl` and `run2.jsonl` are the two runs.
- Period (set or null): 30/30 on both runs.
- Fiction flag: 29/30 on both runs. "English: writing a diary entry as a WW2 evacuee" was called
  fiction. That is arguable: pupils write in role, and the period was still set.
- Cost: $0.0074.
