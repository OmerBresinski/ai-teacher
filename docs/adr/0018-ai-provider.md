# 0018 — AI provider: Amazon Bedrock through the Vercel AI SDK, in `@tj/ai`

- Status: Accepted
- Date: 2026-09-04
- Related PRD decisions: F13-R05 (provider adapters), F13-R06 (routing by model class), F13-R10 (observability), F13-R11 (data handling with providers), F13-D3 (two providers), Master PRD principle 6 ("the prompts are not the product")

## Context

Every generating feature (F01 brief, F04 planner, F06 lesson set, F07 editor assists, F09/F10 loop,
F11 memory) and any teacher-facing chat needs one model client. Nothing exists yet: no SDK
dependency, no key, no package. What does exist is a set of seams built for it — `JobContext.signal`
is documented as "pass it to fetch/AI calls" (`packages/jobs/src/types.ts`), pino loggers carry the
rule "never log prompt or content bodies" (ADR 0015), and `@tj/storage` shows how a provider-backed
capability is packaged: interface in `@tj/domain`, implementations plus `create*(env)` factory in
its own package, a shared contract test, a boot log of the selected kind.

The founder holds an **Amazon Bedrock API key** (long-term bearer token) in an account whose model
access is in `us-east-1`. Bedrock hosts Anthropic Claude (the intended models), Amazon Nova, Meta,
Mistral and others behind one endpoint and one bill.

F13 (Notion) asks for two providers with failover, routing by model class as configuration, prompt
caching, per-call observability and UK/EU endpoints. Most of F13 is the skills runtime proper and is
not this decision; this ADR settles only the client layer everything else will call.

## Decision

1. **Library.** The **Vercel AI SDK** (`ai` + `@ai-sdk/amazon-bedrock`) is the model client for
   the whole codebase. Features call `generateText` / `streamText` / `Output.object(...)` with Zod
   schemas against a `LanguageModel`; nothing imports a vendor SDK directly. It gives the
   provider-agnostic interface F13-R05 needs, structured output, `AbortSignal`, retries, usage
   accounting and `MockLanguageModelV3` for tests. Mastra or another agent framework is not
   adopted (F13 §3: "not a general agent framework").
2. **Package.** A new server-only package **`packages/ai` (`@tj/ai`)** owns the provider. It
   exports `createAi(env)` returning `{ model(class), kind, region }` plus a fake for tests, mirrors
   `@tj/storage` in shape (factory, kind, errors, contract test), depends on `@tj/domain` only
   internally, and is consumed by `apps/worker` and `apps/api`. `apps/web` never holds a key or
   calls a model.
3. **Provider and auth.** **Amazon Bedrock**, authenticated with the **bearer API key**
   (`AWS_BEARER_TOKEN_BEDROCK`, the SDK's own default variable) in region **`AWS_REGION`**
   (production `us-east-1`). IAM SigV4 credentials are not used. A second provider is deliberately
   deferred: `createAi` is written so adding one is a second adapter plus a routing entry, and
   F13-D3 failover is owned by the F13 project.
4. **Model classes as configuration.** Three classes from F13 §7 — `frontier`, `standard`,
   `small` — each an env var holding a Bedrock model ID, defaulted in the env contract and
   overridable per environment:
   `AI_MODEL_FRONTIER=us.anthropic.claude-opus-5`,
   `AI_MODEL_STANDARD=us.anthropic.claude-sonnet-5`,
   `AI_MODEL_SMALL=us.anthropic.claude-haiku-4-5-20251001-v1:0`
   (cross-region `us.` inference profiles). Callers ask for a class, never a model ID. Embedding
   and STT classes are added when F03/F05 need them.
5. **Missing key.** The key is **required in production** (`NODE_ENV=production` without it fails
   boot with the standard "Invalid environment" message, ADR 0015) and **optional in development
   and test**: the app boots with `ai` unconfigured, any AI job or route fails fast with a clear
   error, and tests use the fake model. Unlike storage there is no local fallback — there is no
   local model.
6. **Observability.** `@tj/ai` wraps every call so pino receives model class, model ID, provider,
   latency, input/output/cached token counts and finish reason — **never prompt or completion
   text** (ADR 0015, F13-R10). Cost is derived later from tokens; no per-Journey budget yet
   (F13-R06 owns it).
7. **Verification.** CI does not spend money: the credentialed smoke test runs only when
   `AWS_BEARER_TOKEN_BEDROCK` is present and `describe.skip`s with a reason otherwise (the Blob
   contract-test precedent). Production is proven by a tiny `ai.ping` job through the existing
   pg-boss → SSE path, not by a hidden health probe.

## Consequences

- One dependency surface (`ai`, `@ai-sdk/amazon-bedrock`) for every feature; switching or adding
  a provider is a change inside `packages/ai`. Model upgrades are env changes, not deploys.
- **Data residency deviation.** Bedrock in `us-east-1` means prompts and completions leave the EU
  in flight; nothing is stored there (Bedrock does not retain or train on API inputs by default,
  and no logging is enabled in the account). This contradicts F13-R11's "UK/EU region endpoints
  where available" and widens ADR 0016 §1; it is recorded there as item 5 with the same revisit
  date (before M3). The F15-R01 data-flow statement must name AWS as a sub-processor.
- Env contract grows by five variables for api and worker (`AWS_BEARER_TOKEN_BEDROCK` secret;
  `AWS_REGION`, `AI_MODEL_*` config). `.railway/railway.ts` renders them as `preserve()`;
  `scripts/env-contract.test.ts` and both `env.contract.test.ts` files are updated with them.
- The Docker image bundles the AI SDK (`bun build --target=bun`); `.railway/railway.ts`
  `IMAGE_WATCH` must list `packages/ai/**` or Railway will not rebuild on changes to it.
- The `ai-sdk` skill is vendored into `packages/ai` (ADR 0017) with an `AGENTS.md` override: the
  skill's default "use the Vercel AI Gateway" does not apply; the provider is Bedrock via
  `createAi`.
- Deferred to F13: second provider and failover, routing policy beyond env vars, prompt caching
  (`cachePoint` provider option is available when wanted), per-Journey budgets, eval harness,
  prompt retention for debugging (F13-D5).
