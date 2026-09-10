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
               "slides": 10, "blocks": 8, "calls": 14, "inputTokens": 21000, "outputTokens": 5800,
               "costUsd": 0.12,
               "judge": { "calls": 1, "inputTokens": 8000, "outputTokens": 600, "costUsd": 0.16 },
               "findings": { "error": 0, "warning": 1 },
               "scores": { "schema": 1, "modelFindings": 0.9,
                           "rubric": { "mean": 3.6, "dimensions": { "correctness": 4, "depth": 2,
                             "pitch": 4, "coherence": 3, "questionQuality": 3, "notes": 2,
                             "worksheetValueAdd": 2, "imageFit": null } } },
               "rubricRationales": { "correctness": "…", "depth": "…", "…": "…" } }],
  "totals": { "briefs": 8, "completed": 8, "failed": 0, "durationMs": 0, "meanDurationMs": 0,
              "p50FirstSlideMs": 0, "calls": 0, "inputTokens": 0, "outputTokens": 0, "costUsd": 0,
              "judgeCostUsd": 0, "findings": { "error": 0, "warning": 0 },
              "rubric": { "mean": 3.6, "dimensions": { "correctness": 4, "…": 0 } } }
}
```

Counts, timings, tokens, cost and scores only — no prompt, no generated text, no topic (ADR 0015;
`eval/run.test.ts` greps for the topics). The one exception is `rubricRationales`: the judge's
one-line rationale per dimension, kept **only** in this gitignored file (root `.gitignore`,
`packages/generation/eval/results/`) so a reader can see why a score moved. Neither
`formatResultsTable` nor `renderComment` reads it; `eval/delta.test.ts` asserts a sentinel
rationale never reaches the comment. `firstSlideMs` is the time to the first persist that carried a
slide, the number the F06 definition of done ("first slide visible in under 10 seconds") is about;
`planMs` is the time to the `planned` checkpoint (Plan's wall time, the Plan tickets' budget, with
`p50PlanMs` in the totals and a `p50 plan` row in the comment); `durationMs` is the whole brief
**without** the judge call that follows it. `calls`, the tokens and
`costUsd` on a brief are the lesson's own, so the cost is comparable with the per-lesson target;
the judge's usage is the `judge` object beside them, taken from the budget's deltas so a judge
attempt that was paid for but failed validation still counts. The totals' `costUsd` is the whole
budget (lessons plus judge), which is what `AI_EVAL_RUN_COST_CAP_USD` caps; `judgeCostUsd` is the
judge's share.

### Scores

`eval/scorers.ts` builds three scorers with Mastra's `createScorer` from `@mastra/core/evals`
(read `node_modules/@mastra/core/dist/docs/references/docs-evals-custom-scorers.md` before
changing them; no `@mastra/evals` dependency is needed and no Mastra judge model is configured):

- `schema` — `checkLesson` over the final lesson and worksheet: `1 − errors / slides`, clamped.
  Function-only, never spends.
- `modelFindings` — the model checks left on `Lesson.generation.findings` after Repair (not the
  schema checks, not the budget stop): `1 − findings / slides`, clamped. Function-only, never
  spends.
- `rubric` — the **rubric judge** (`rubricJudgeScorer`, prompt `eval/rubric-prompt.ts`,
  `rubric-judge.v1`): one structured call on the `frontier` class through the pipeline's own
  `callStructured` (`stage: "evaluate"`), charged to the run's budget so it counts against
  `AI_EVAL_RUN_COST_CAP_USD`. It reads the audience block, the brief topic, `factsBlock`, every
  slide's plain text and notes and every worksheet block, and scores eight dimensions 1–5:
  `correctness`, `depth`, `pitch`, `coherence`, `questionQuality`, `notes`, `worksheetValueAdd`,
  `imageFit`. The first seven must carry an integer score (a `null` there is a schema miss and goes
to `callStructured`'s one retry); `imageFit` is `null` when no `image-text` slide carries a placed photograph — which
  is every eval run today, because `run-brief.ts` wires no `PhotoPlacer` into the pipeline; the
  picture-first ticket changes that. `rubric.mean` is the mean of the non-null dimensions, one
  decimal. The judge runs **only in the paid half** (`runBrief(…, { judge: true })` from
  `run.ts`); `eval:schema` never passes `judge`, so it never spends. A cap stop, a schema miss on
  both attempts or any other failure leaves `rubric: null` — the run still finishes and writes its
  file. The prompt is eval-only: not in `src/prompts`, not in `PROMPTS`, not pinned by
  `prompts.test.ts`, never run in production.

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
totals table and, when a baseline exists, a `delta` column: `now − master` for cost, judge cost,
mean duration, p50 first slide, calls, tokens, the rubric mean and each of the eight rubric
dimensions (one decimal), and total error findings. `+` is more, `−` less, `±0` unchanged. A
`master` baseline written before the rubric existed shows `-` in the rubric rows. Rationales never
appear in the comment (ADR 0015).

**Founder action, once:** add the GitHub Actions secret `AWS_BEARER_TOKEN_BEDROCK` to the repo,
then trigger `Eval` with `workflow_dispatch` on `master`. That first successful run is the
baseline; paste its totals into TEACH-132 for the F06 project's Definition of done. Until the
secret exists the workflow fails at once with exit `2` and writes nothing.

## Reading a delta

A prompt-file PR (a bumped `version` in `src/prompts/`) is the case this was built for: label it
`run-eval`, wait for the comment, and read the rubric rows first — a cheaper run that scores lower
on `depth` or `correctness` is not a win — then cost and error findings, then `p50 first slide`
and `mean duration`. One run is one sample: Bedrock latency varies, so treat a duration delta under
~15 % as noise, and a rubric delta of ±0.2 on one dimension as within the judge's own variance;
re-run before drawing a conclusion. When a score moves and the reason is not obvious, download the
`eval-<sha>` artifact and read `rubricRationales` for the brief — that is what the field is for.
