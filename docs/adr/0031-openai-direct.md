# 0031 — AI provider: OpenAI direct in `@tj/ai`; Bedrock retired

- Status: Accepted
- Date: 2026-09-25
- Supersedes: 0018 (the provider decision; its library, package, class and observability decisions carry over unchanged)
- Related PRD decisions: F13-R05 (provider adapters), F13-R06 (routing by model class), F13-R10 (observability), F13-R11 (data handling with providers), F13-D3 (two providers), Master PRD principle 6 ("the prompts are not the product")

## Context

ADR 0018 put every model call on Amazon Bedrock with one bearer key. The Bedrock key the lab
holds has returned 403 on every call since 17 September 2026; whether production's key still
works has not been checked, and nothing in production has generated a lesson since. From 17
September every lab run went through the Vercel AI Gateway on a prepared branch of `@tj/ai`
(`provider/model` ids, a per-call `route`, list prices, per-provider reasoning effort, a
non-strict JSON schema for `openai/` ids), which is how the quality programme kept moving.

On 24 September the lab benched the same eleven recorded prompts three ways at the same moment:
gateway 184 s, OpenAI direct 169 s, OpenAI direct on the priority service tier 125 s. Time to
first token is 60–70 % of a call and is the model reasoning, not the route; the time of day moves
the numbers more than the route does. The gateway adds no meaningful time, but it is a second
vendor, a second bill and a $10 credit on a personal team. The unit-economics target is
$0.015–0.02 per lesson; the direct route bills at OpenAI list price, the same numbers the gateway
showed with no markup.

Founder decision, 25 September 2026: production calls OpenAI directly with an OpenAI key held in
Railway.

## Decision

1. **Provider and auth.** `@tj/ai` calls the **OpenAI chat completions API directly** through
   `@ai-sdk/openai` (`createOpenAI({ apiKey }).chat(model)`), authenticated with
   **`OPENAI_API_KEY`**, held in Railway on the `api` and `worker` services and never on Vercel or
   in git. The key is passed explicitly from the validated env; `createAi` never reads
   `process.env`. The library, package boundary, model classes and log line of ADR 0018 (§1, §2,
   §4, §6) are unchanged.
2. **Model ids.** An OpenAI model is named `openai/<model>` in `AI_MODEL_*`
   (`openai/gpt-5.6-luna`); the prefix is stripped on the wire. This ADR's PR changes **no**
   `DEFAULT_MODEL_IDS`: they stay the Bedrock `us.openai.gpt-5.6-*` ids, so merging it changes
   nothing in production. The switch of the classes to `openai/` ids is the next ticket and amends
   this ADR.
3. **The Vercel AI Gateway is an optional fallback, never the production path.** With
   `AI_GATEWAY_API_KEY` set, `@tj/ai` serves any non-OpenAI `provider/model` id through the
   gateway (the lab's model bench), and an `openai/` id too when no OpenAI key is set. The
   OpenRouter route the prepared branch carried is removed: it had no caller.
4. **Bedrock remains accepted until retired.** The Bedrock adapter and `AWS_BEARER_TOKEN_BEDROCK`
   still serve ids without a slash; production validates with either key. The switch ticket
   retires them.
5. **Reasoning effort is per call.** `callStructured` sends `none | low | medium | high` as
   `openai.reasoningEffort` (and the same value under the other providers' namespaces, each inert
   outside its provider; Bedrock has no `none` and receives `low`). `minimal` is never sent: the
   Luna ids refuse it. No stage's effort changes in this ADR's PR.
6. **Structured output is JSON schema, non-strict.** `openai/` ids are sent
   `strictJsonSchema: false`: OpenAI's strict mode refuses a schema whose `required` does not list
   every key, and the pipeline's schemas have optional fields. Zod validates the answer in full, as
   before (ADR 0025 §14).
7. **What the logs say.** `ConfiguredAi.kind` is `openai` when the OpenAI key is set, else
   `bedrock` when the Bedrock key is, else `gateway`; that is the boot log's `ai` field. The `ai`
   log line's `provider` is the wrapped model's own provider string, so a direct OpenAI call is
   told apart from a Bedrock one in Railway. Never the key, never content (ADR 0015).
8. **Verification.** `packages/ai/src/openai.live.test.ts` runs only when `OPENAI_API_KEY` is set
   and `describe.skip`s with a reason otherwise (CI holds no OpenAI secret). Production is proven
   by the existing `ai.ping` job through pg-boss and SSE, as ADR 0018 §7 did for Bedrock.

## Consequences

- The env contract gains `OPENAI_API_KEY` (secret, api and worker); production requires it or
  `AWS_BEARER_TOKEN_BEDROCK`. The OpenRouter variable is gone. Setting the key on Railway is a
  founder action, not a merge gate: until the switch ticket lands, production still calls Bedrock.
- **Data residency.** Prompts and completions go to OpenAI (US) in flight; nothing is stored by
  us there. OpenAI states that API inputs are not used to train its models and are retained per
  its API data-usage policy (abuse monitoring, a bounded retention window). That replaces AWS in
  ADR 0016 §1 item 5, with the same revisit date, and in the F15-R01 data-flow statement, where
  OpenAI becomes the sub-processor of lesson content. No worse than today, still a deviation from
  F13-R11.
- Deferred to the switch ticket: `DEFAULT_MODEL_IDS`, `AI_PLAN_FRONTIER_FROM_YEAR`'s semantics,
  the eval workflow secret (`.github/workflows/eval.yml` `AWS_BEARER_TOKEN_BEDROCK`),
  `packages/generation/eval/run.ts` (`EnvSchema`, `UNCONFIGURED_MESSAGE`), removal of the Bedrock
  adapter, and this ADR's amendment.
- Deferred to a decision on latency targets: the priority service tier (about 2× the price, 32 %
  faster in the bench), fast-route timeouts, the Responses API and prompt caching.
- Rate limits are the account's tier; `callStructured` keeps `maxRetries: 0`, so a 429 fails the
  call (one retry exists for empty answers only). If 429s appear in production, that is a
  follow-up.
- `openai/gpt-6-luna-fast` is a gateway-only id (OpenAI direct returns 404); it has no price row
  and the lab must not route it once direct is the default.
