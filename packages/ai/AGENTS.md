# AGENTS.md — `packages/ai` (`@tj/ai`)

Read the root [`AGENTS.md`](../../AGENTS.md), ADR 0018, ADR 0015, and this guide before editing.

## Skills

| Skill | Load when… |
| --- | --- |
| `ai-sdk` | Any AI SDK code. Load it from `./.agents/skills/ai-sdk` when present; it is vendored by TEACH-73. |

## Constraints

- Provider is Amazon Bedrock through `createAi` and `createAmazonBedrock({ apiKey, region })`.
  Never use the Vercel AI Gateway.
- Never fetch model IDs from `ai-gateway.vercel.sh`; use environment variables or
  `DEFAULT_MODEL_IDS`.
- Never log prompts, messages, system instructions, completions, or API keys. Log only model-call
  metadata and token usage.
- This is server-only. `apps/web` must never import `@tj/ai` or receive a Bedrock key.
- Callers pass `abortSignal` to AI SDK functions. This package adds no retry layer.
- Before changing AI SDK code, inspect the installed docs under
  `packages/ai/node_modules/ai/docs` (Bun's isolated linker exposes the package there).
