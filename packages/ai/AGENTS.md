# AGENTS.md — `packages/ai` (`@tj/ai`)

Read the root [`AGENTS.md`](../../AGENTS.md), ADR 0031, ADR 0015, and this guide before editing.

## Skills

| Skill | Load when… |
| --- | --- |
| `ai-sdk` | Any AI SDK code. Installed at `./.agents/skills/ai-sdk`. |

## Constraints

- Provider is OpenAI direct through `createAi` (ADR 0031): an `openai/<model>` id is served by
  `createOpenAI({ apiKey }).chat(...)` with the prefix stripped, from `OPENAI_API_KEY`. Ids without
  a slash are the legacy Bedrock route (`createAmazonBedrock({ apiKey, region })`, ADR 0018) until
  the switch ticket retires it. The Vercel AI Gateway is a fallback only, for non-OpenAI
  `provider/model` ids (the lab's model bench) and for `openai/` ids when no OpenAI key is set;
  it is never the production path.
- Never fetch model IDs from `ai-gateway.vercel.sh`; use environment variables or
  `DEFAULT_MODEL_IDS`.
- Never log prompts, messages, system instructions, completions, or API keys. Log only model-call
  metadata and token usage.
- This is server-only. `apps/web` must never import `@tj/ai` or receive a provider key.
- Callers pass `abortSignal` to AI SDK functions. This package adds no retry layer.
- Before changing AI SDK code, inspect the installed docs under
  `packages/ai/node_modules/ai/docs` (Bun's isolated linker exposes the package there).
