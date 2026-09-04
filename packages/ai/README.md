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
| `AI_MODEL_FRONTIER` | `frontier` model ID. Default `us.anthropic.claude-opus-5`. |
| `AI_MODEL_STANDARD` | `standard` model ID. Default `us.anthropic.claude-sonnet-5`. |
| `AI_MODEL_SMALL` | `small` model ID. Default `us.anthropic.claude-haiku-4-5-20251001-v1:0`. |

Model classes are defined in `@tj/domain`: `frontier` is for planning and adaptation, `standard`
for plans and outlines, and `small` for items, variants, and summaries. Callers select a class, not
a provider model ID.

`createAi({})` returns `{ kind: "unconfigured" }` and only throws when `model()` is requested.
That throw is `AiError` with code `"unconfigured"` and names `AWS_BEARER_TOKEN_BEDROCK`.

## Logging and errors

Each `generateText` or consumed `streamText` call through `ai.model(class)` emits one pino log. It
contains only model class, model ID, provider, duration, input/output/cache token counts, and finish
reason. Prompts, messages, completion text, and API keys are never logged.

`AiError` codes are `"unconfigured"`, `"provider"`, and `"invalid_model"`; use
`isAiError(error, code?)` to identify them. Provider failures are wrapped as `AiError("provider")`
and retain the original failure as `cause`.

There is no package retry layer. Pass an `abortSignal` (for example `ctx.signal` from a Job) to the
AI SDK call. The SDK's default `maxRetries` is 2; callers can override it per call when necessary.

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
