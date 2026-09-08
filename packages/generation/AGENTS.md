# AGENTS.md — `packages/generation` (`@tj/generation`)

The lesson generation pipeline (ADR 0025 §5, §8, §11–§17, §21): Plan → Generate → Evaluate →
Repair as pure functions over `PipelineState`, versioned prompt modules in `src/prompts/`,
`callStructured` (structured output with one retry and the per-lesson budget) and
`runLessonPipeline`, the in-process Mastra workflow. Server-only: `apps/worker` is the consumer
and owns persistence through `PipelineDeps.persist`. Read the root [`AGENTS.md`](../../AGENTS.md)
first.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `mastra` | touching `workflow.ts` or `mastra.dev.ts`. **Never trust memory**: read `node_modules/@mastra/core/dist/docs/references/` first. |
| `ai-sdk` | touching `call.ts` or a prompt: `generateText`, `Output.object`, `NoObjectGeneratedError`. |

## Constraints that override the skills

- **Models only through `deps.ai.model(cls, context)`** (`@tj/ai`, Bedrock — ADR 0018). Never
  Mastra's model router, never `@ai-sdk/*` directly, never the AI Gateway. `abortSignal` on every
  call; `callStructured` is the one place a model is called.
- **Mastra in-process only (ADR 0025 §21).** `createStep`/`createWorkflow` and `RequestContext`
  from `@mastra/core`; `new Mastra()` exists only in `mastra.dev.ts` (Studio). No Mastra storage:
  the checkpoint is `Lesson.generation.stage`. No step `retries`: `callStructured` owns the one
  retry (§14) and pg-boss owns the job retry. `MASTRA_TELEMETRY_DISABLED=1` is in the env contract.
- **The model produces content, never geometry (§8).** Stages ask for `SlideSpec` / `BlockSpec`
  and call `materialiseSlide` / `materialiseBlock` from `@tj/slides`.
- **Never log prompts, model output or document content (ADR 0015).** Log ids, stage, prompt
  version, counts and cost. The retry prompt carries validation issue messages only, never
  `error.text`.
- **Prompts are versioned modules.** Change wording → bump `version` → update the hash in
  `src/prompts/prompts.test.ts`. The version is written to `generatedFrom.promptVersion`.
- No database, pg-boss or HTTP here; no dependency on `apps/*` or `@tj/editor` (`bundle.test.ts`).

## Layout

```
src/
  types.ts        PipelineDeps, PipelineState, StageFailure, BudgetExceeded, stage names
  call.ts         callStructured: Output.object, one retry, budget charge, abort check
  specs.ts        PlanOutputSchema (+ assignFactIds), WorksheetSpecSchema, Evaluate/Repair outputs
  prompts/        plan, generate-slide, generate-worksheet, evaluate, repair (+ shared, index)
  stages/         plan, generate, evaluate, repair (+ shared text projections)
  workflow.ts     lessonWorkflow, resumeFrom, runLessonPipeline
  testing.ts      fixtures as values, scripted fake, recording deps (`@tj/generation/testing`)
  fixtures/       plan.json, slides.json, worksheet.json, evaluate.json, repair.json
  mastra.dev.ts   Studio entry (`bun run studio:generation`: Bedrock from apps/worker/.env;
                  `AI_FAKE_SCRIPT=1` for the fixture fake); src/mastra/index.ts re-exports it
```

```
eval/            the F06 eval set (ADR 0025 §23, docs/eval.md): briefs/*.json, briefs.ts, run-brief
                 (one brief through the pipeline with an in-memory persist), scorers (Mastra
                 `createScorer` from `@mastra/core/evals`, function steps only), schema.ts
                 (`bun run eval:schema`, CI's free half), run.ts (`bun run eval:paid`, Bedrock,
                 label-gated — never run it with a real key from a dev shell unless you mean to
                 spend), delta.ts (the PR comment). `eval/results/` is gitignored.
```

Tests: `bun test` in this directory; network-free, no `AWS_BEARER_TOKEN_BEDROCK` needed.
