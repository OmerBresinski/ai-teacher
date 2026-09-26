# 0031 — AI provider: OpenAI direct as an opt-in route in `@tj/ai`; Bedrock stays the production default

- Status: Accepted
- Date: 2026-09-25
- Amends: 0018 (Bedrock remains the provider decision; this ADR adds a second, opt-in route and leaves 0018's library, package, class and observability decisions unchanged)
- Related PRD decisions: F13-R05 (provider adapters), F13-R06 (routing by model class), F13-R10 (observability), F13-R11 (data handling with providers), F13-D3 (two providers), Master PRD principle 6 ("the prompts are not the product")

## Context

ADR 0018 put every model call on Amazon Bedrock with one bearer key. The Bedrock key the lab
holds has returned 403 on every call since 17 September 2026; whether production's key still
works has not been checked. From 17 September every lab run went through the Vercel AI Gateway on
a prepared branch of `@tj/ai` (`provider/model` ids, a per-call `route`, list prices, per-provider
reasoning effort, a non-strict JSON schema for `openai/` ids), which is how the quality programme
kept moving.

On 24 September the lab benched the same eleven recorded prompts three ways at the same moment:
gateway 184 s, OpenAI direct 169 s, OpenAI direct on the priority service tier 125 s. Time to
first token is 60–70 % of a call and is the model reasoning, not the route; the time of day moves
the numbers more than the route does. The gateway adds no meaningful time, but it is a second
vendor, a second bill and a $10 credit on a personal team. The unit-economics target is
$0.015–0.02 per lesson.

The GPT-6 family (`gpt-6-luna`, `gpt-6-sol`, released 22 September; `gpt-6-astra`, 4 September)
is listed on OpenAI's API and, as the `us.openai.gpt-6-*` inference profiles, in Bedrock's
`us-east-1` catalogue (models.dev, 25 September; Bedrock lists them at a 10 % premium over
OpenAI list price). So the model generation the pipeline wants is reachable on either provider.

Founder decision, 25 September 2026: **Bedrock stays the production provider for now.** The
direct OpenAI route is built and kept ready as an opt-in; whether production moves off Bedrock is
decided later, and depends on GPT-6 availability and behaviour on Bedrock once the production key
is exercised again.

## Decision

1. **Bedrock remains the production default (ADR 0018 stands).** `DEFAULT_MODEL_IDS` stay the
   Bedrock `us.openai.gpt-5.6-*` ids and `AWS_BEARER_TOKEN_BEDROCK` remains the key production
   runs on. Nothing in this ADR's PR changes a production call.
2. **OpenAI direct is an opt-in route.** `@tj/ai` can call the **OpenAI chat completions API
   directly** through `@ai-sdk/openai` (`createOpenAI({ apiKey }).chat(model)`), authenticated
   with **`OPENAI_API_KEY`**, held in Railway on the `api` and `worker` services and never on
   Vercel or in git. The key is passed explicitly from the validated env; `createAi` never reads
   `process.env`. The route activates only when **both** hold: the key is set, and a model class
   is switched to an `openai/<model>` id (`AI_MODEL_*` or a future `DEFAULT_MODEL_IDS` change).
   Setting the key alone changes nothing; switching an id without the key fails fast at `model()`
   naming `OPENAI_API_KEY`.
3. **Model ids.** An OpenAI model is named `openai/<model>` (`openai/gpt-6-luna`); the prefix is
   stripped on the wire. Ids without a slash stay Bedrock ids. Any switch of a class to an
   `openai/` id is its own ticket and amends this ADR.
4. **The Vercel AI Gateway is an optional fallback, never the production path.** With
   `AI_GATEWAY_API_KEY` set, `@tj/ai` serves any non-OpenAI `provider/model` id through the
   gateway (the lab's model bench), and an `openai/` id too when no OpenAI key is set. The
   OpenRouter route the prepared branch carried is removed: it had no caller.
5. **Reasoning effort is per call.** `callStructured` sends `none | low | medium | high` as
   `openai.reasoningEffort` (and the same value under the other providers' namespaces, each inert
   outside its provider; Bedrock has no `none` and receives `low`). `minimal` is never sent: the
   Luna ids refuse it. No stage's effort changes in this ADR's PR.
6. **Structured output is JSON schema, non-strict.** Every call sends `openai.strictJsonSchema:
   false`: OpenAI's strict mode refuses a schema whose `required` does not list every key, and the
   pipeline's schemas have optional fields. It is not keyed on the `openai/` prefix, because the
   direct provider strips it and the routed id is bare (`gpt-6-luna`); no other provider reads the
   `openai` namespace. Zod validates the answer in full, as
   before (ADR 0025 §14).
7. **What the logs say.** `ConfiguredAi.kind` is `openai` when the OpenAI key is set, else
   `bedrock` when the Bedrock key is, else `gateway`; that is the boot log's `ai` field. The `ai`
   log line's `provider` is the wrapped model's own provider string, so a direct OpenAI call is
   told apart from a Bedrock one in Railway. Never the key, never content (ADR 0015).
8. **Verification.** `packages/ai/src/openai.live.test.ts` runs only when `OPENAI_API_KEY` is set
   and `describe.skip`s with a reason otherwise (CI holds no OpenAI secret); its default model is
   `openai/gpt-6-luna`. Production is proven by the existing `ai.ping` job through pg-boss and SSE,
   as ADR 0018 §7 did for Bedrock.

## Consequences

- The env contract gains `OPENAI_API_KEY` (secret, api and worker); production requires it or
  `AWS_BEARER_TOKEN_BEDROCK`, so production on Bedrock alone still validates. The OpenRouter
  variable is gone. Setting the key on Railway is a founder action, not a merge gate, and by
  itself switches nothing on.
- **Data residency, only if the route is switched on.** While production is on Bedrock, ADR 0016
  §1 item 5 stands as written (AWS `us-east-1`). If a class is switched to an `openai/` id,
  prompts and completions for that class go to OpenAI (US) in flight; nothing is stored by us
  there. OpenAI states that API inputs are not used to train its models and are retained per its
  API data-usage policy (abuse monitoring, a bounded retention window). At that point OpenAI
  becomes a sub-processor of lesson content and must be named in the F15-R01 data-flow statement
  alongside (or in place of) AWS; the deviation from F13-R11 is unchanged in kind. The amendment
  to ADR 0016 records this as conditional.
- **Open: whether to leave Bedrock.** Decided later, on evidence: whether the production Bedrock
  key works, whether the `us.openai.gpt-6-*` profiles behave on Bedrock as the direct ids do
  (structured output, effort values, latency), and the 10 % price difference against the
  unit-economics target. Either outcome is a new ADR or an amendment here; the switch ticket, if
  any, also covers `AI_PLAN_FRONTIER_FROM_YEAR`'s semantics, the eval workflow secret
  (`.github/workflows/eval.yml`), `packages/generation/eval/run.ts` and the Bedrock adapter.
- Deferred to a decision on latency targets: the priority service tier (about 2× the price, 32 %
  faster in the bench), fast-route timeouts, the Responses API and prompt caching.
- Rate limits are the account's tier; `callStructured` keeps `maxRetries: 0`, so a 429 fails the
  call (one retry exists for empty answers only). If 429s appear once the route is on, that is a
  follow-up.
- `openai/gpt-6-luna-fast` is a gateway-only id (OpenAI direct returns 404); it has no price row
  and the lab must not route it on the direct route.
