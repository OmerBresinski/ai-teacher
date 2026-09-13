# @tj/ai

Server-only Amazon Bedrock model client for Teaching Journey (ADR 0018). `@tj/ai` is consumed from
source and is the only package that creates the Bedrock provider. Apps pass validated environment
values to `createAi`; this package never reads `process.env`.

```ts
import { generateText } from "ai";
import { createAi } from "@tj/ai";

const ai = createAi(process.env, { logger });
const result = await generateText({
  model: ai.model("standard"),
  prompt: "Create a Lesson outline.",
  abortSignal: ctx.signal,
});
```

## Environment

| Variable | Effect |
| --- | --- |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock bearer API key. A blank value is unset; without it the client is `unconfigured`. |
| `AWS_REGION` | Bedrock region. Defaults to `us-east-1`. |
| `AI_MODEL_FRONTIER` | `frontier` model ID. Default `us.openai.gpt-5.6-sol`. |
| `AI_MODEL_STANDARD` | `standard` model ID. Default `us.openai.gpt-5.6-terra`. |
| `AI_MODEL_SMALL` | `small` model ID. Default `us.openai.gpt-5.6-luna`. |

Model classes are defined in `@tj/domain`: `frontier` is for planning and adaptation, `standard`
for plans and outlines, and `small` for items, variants, and summaries. Callers select a class, not
a provider model ID.

## Consumers

Reference call site: `apps/worker` `ai.ping`.

`createAi({})` returns `{ kind: "unconfigured" }` and only throws when `model()` is requested.
That throw is `AiError` with code `"unconfigured"` and names `AWS_BEARER_TOKEN_BEDROCK`.

## Logging and errors

Each `generateText` or consumed `streamText` call through `ai.model(class)` emits one pino log. It
contains only model class, model ID, provider, duration, input/output/cache token counts, and finish
reason. Prompts, messages, completion text, and API keys are never logged.

`AiError` codes are `"unconfigured"`, `"provider"`, `"moderated"`, and `"invalid_model"`; use
`isAiError(error, code?)` to identify them. Provider failures are wrapped as `AiError("provider")`
and carry a content-free `ProviderFailure` summary (allow-listed `name`, fixed `message`, `statusCode`,
`isRetryable`) as `cause`. The raw AI SDK error is dropped on purpose: it exposes the request body
(the prompt) and response body, which must never reach a logger (ADR 0015).

There is no package retry layer. Pass an `abortSignal` (for example `ctx.signal` from a Job) to the
AI SDK call. The SDK's default `maxRetries` is 2; callers can override it per call when necessary.

## Budget admission (TEACH-280)

`@tj/generation` `callStructured` wraps its model with
`withGenerationBudget(model, modelId, budget)` and sets `maxRetries: 0`. Each provider dispatch
reserves synchronously from the shared Budget, including schema/deadline retries. The wrapper
settles complete usage before structured-output validation and retains an uncertain estimate on
timeouts, aborts and incomplete usage; late complete usage settles at most once.

`createBudget(caps, { spent })` copies confirmed prior aggregates exactly. `totals()` keeps them
separate from optional `reserved`/`uncertain` aggregates; both participate in admission. Saved
pending reservations become uncertain on resume. `lastRefusal()` is diagnostic: a denied large
request does not prevent a cheaper request from fitting. Eval stops after any reservation refusal.

Estimation includes UTF-8 text/schema bytes, protocol headroom, image dimensions (a bounded raster
header read via `image-meta@0.2.2`, no pixel decoding), and maximum output. Known GPT-5.6 image
bounds cover missing dimensions; unsupported model/image combinations fail closed. Prices include
long-context and cache-write rates. See ADR 0025 for sources and the uncertainty policy: this is
conservative in-process admission, not an exact invoice guarantee or an authoritative global ledger.

## Testing

Use `createFakeAi` from `@tj/ai/testing` for deterministic, network-free tests. The fake uses the
AI SDK `MockLanguageModelV4` and preserves `kind: "bedrock"` so application code does not need a
test-only branch. It accepts scripted `text`, `usage`, `modelIds`, `logger`, and `error` options;
its models use the same logging middleware as production models.

```sh
bun run --filter=@tj/ai test
AWS_BEARER_TOKEN_BEDROCK=... bun run --filter=@tj/ai test
```

The credentialed live test is skipped unless `AWS_BEARER_TOKEN_BEDROCK` is set. It makes one small,
limited Bedrock call and therefore should not run in CI.
