# The eval set (F06 item 9, ADR 0025 §23)

Eight lesson briefs across key stages and subjects, in `packages/generation/eval/briefs/*.json`,
run through the real `runLessonPipeline` in two halves: a **free** half that runs on every PR and
a **paid** half that spends money and runs only when asked. Both live in
`packages/generation/eval/`; neither touches Postgres or storage — `persist` is memory.

## The schema half — `bun run eval:schema` (free, every PR)

Every brief becomes the lesson `POST /lessons` would create (`lessonFromBrief`) and goes through
the pipeline on the scripted fake (`scriptedPipelineAi()`, the fixtures under `src/fixtures/`).
The point is not the words — the fixtures are one lesson about states of matter whatever the
brief — but the recipes, `materialiseSlide` / `materialiseBlock` and the shared `checkLesson` on
real geometry for eight audiences. The script prints one table and exits:

- `0` — every brief produced a lesson with zero `error` schema findings;
- `1` — at least one did not; the last line names the brief and the check(s).

It needs no network and no key and takes well under 30 s. CI's `test` job runs it after
`bun run test:db` (`.github/workflows/ci.yml`). `eval/schema.test.ts` covers both exits.

## The paid half — `bun run eval:paid` (Bedrock, gated)

Every brief through the pipeline on the real `createAi(process.env)`, one budget shared across
the run: `createBudget({ capUsd: AI_EVAL_RUN_COST_CAP_USD, capTokens: 8 × AI_LESSON_TOKEN_CAP })`.
The loop stops as soon as the budget is exceeded; whatever ran is reported with
`totals.stoppedBy: "usd" | "tokens"`.

- No `AWS_BEARER_TOKEN_BEDROCK` → exit `2` with the unconfigured message; nothing runs, nothing
  is written.
- A brief that fails for a reason other than the cap → exit `1` (the table says which and why, by
  error name only).
- Otherwise exit `0`, and `packages/generation/eval/results/<sha>.json` (gitignored) holds:

```jsonc
{
  "sha": "…", "at": "…", "models": { "frontier": "…", "standard": "…", "small": "…" }, "capUsd": 3,
  "briefs": [{ "id": "y8-science-particles", "ok": true, "durationMs": 41200, "firstSlideMs": 7900,
               "slides": 10, "blocks": 8, "calls": 13, "inputTokens": 13000, "outputTokens": 5200,
               "costUsd": 0.12, "findings": { "error": 0, "warning": 1 },
               "scores": { "schema": 1, "modelFindings": 0.9 } }],
  "totals": { "briefs": 8, "completed": 8, "failed": 0, "durationMs": 0, "meanDurationMs": 0,
              "p50FirstSlideMs": 0, "calls": 0, "inputTokens": 0, "outputTokens": 0, "costUsd": 0,
              "findings": { "error": 0, "warning": 0 } }
}
```

Counts, timings, tokens, cost and scores only — no prompt, no generated text, no topic (ADR 0015;
`eval/run.test.ts` greps for the topics). `firstSlideMs` is the time to the first persist that
carried a slide, the number the F06 definition of done ("first slide visible in under 10 seconds")
is about; `durationMs` is the whole brief.

### Scores

`eval/scorers.ts` builds two function-only scorers with Mastra's `createScorer` from
`@mastra/core/evals` (read `node_modules/@mastra/core/dist/docs/references/docs-evals-custom-scorers.md`
before changing them; no `@mastra/evals` dependency is needed and no judge model is configured, so
a scorer never spends):

- `schema` — `checkLesson` over the final lesson and worksheet: `1 − errors / slides`, clamped.
- `modelFindings` — the model checks left on `Lesson.generation.findings` after Repair (not the
  schema checks, not the budget stop): `1 − findings / slides`, clamped.

They run only in the eval scripts, never in the worker.

### Cost cap

`AI_EVAL_RUN_COST_CAP_USD` (env contract, default `3.00`) caps one whole run; the script reads
`process.env` directly and validates it with Zod. A run with the cap at `0.01` stops after the
first brief's first calls — the `stoppedBy` row in the results file, exit `0`.

## CI: `.github/workflows/eval.yml`

The paid half runs in CI only on:

- `workflow_dispatch` — from `master`, to refresh the baseline; from a branch, to look at a run
  without labelling a PR;
- a PR carrying the **`run-eval`** label (`labeled` and, while the label stays on, `synchronize`).

Docs-only PRs never carry the label, so they never pay. Each run uploads
`eval/results/*.json` as the artifact `eval-<sha>` (90 days); a manual run from `master` also
uploads it as `eval-master-latest`. On a PR the workflow downloads the latest successful
`master` run's `eval-master-latest`, renders `packages/generation/eval/delta.ts <now> [master]` and
posts one comment (marker `<!-- tj-eval-results -->`, updated in place on later runs) with the
totals table and, when a baseline exists, a `delta` column: `now − master` for cost, mean duration,
p50 first slide, calls, tokens and total error findings. `+` is more, `−` less, `±0` unchanged.

**Founder action, once:** add the GitHub Actions secret `AWS_BEARER_TOKEN_BEDROCK` to the repo,
then trigger `Eval` with `workflow_dispatch` on `master`. That first successful run is the
baseline; paste its totals into TEACH-132 for the F06 project's Definition of done. Until the
secret exists the workflow fails at once with exit `2` and writes nothing.

## Reading a delta

A prompt-file PR (a bumped `version` in `src/prompts/`) is the case this was built for: label it
`run-eval`, wait for the comment, and read cost and error findings first — a cheaper run with more
errors is not a win — then `p50 first slide` and `mean duration`. One run is one sample: Bedrock
latency varies, so treat a duration delta under ~15 % as noise and re-run before drawing a
conclusion.
