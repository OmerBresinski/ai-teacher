/**
 * What a PostHog event may carry (ADR 0041, `docs/observability.md`). Every event, `gen_*` and
 * core alike, goes through `enforce`. The rules:
 *
 * - **Key names are fixed.** A `gen_*` event keeps only the property names its `ev` object
 *   literally has in the source (`catalogue.gen.ts`), plus the names listed here. A name is never
 *   built from a value, so model text can never become a property name.
 * - **Numbers and booleans pass.** They cannot carry text.
 * - **Strings pass only under a key with a rule**: a fixed enum we define (stage, template,
 *   outcome, via, planner, model id, …), our id shape (UUID), an ISO time or a prompt version.
 *   A value that fails its rule is dropped. So are strings under any other key, objects and
 *   arrays that are not all-number or all-enum. The event says how many were dropped
 *   (`droppedProps`).
 * - **Content keys are a backstop.** `text`, `title`, `prompt`, `fix`, … never pass, whatever
 *   their value.
 */
import { EVENT_KEYS } from "./catalogue.gen";

/** Keys whose values can be lesson text, prompts or model output: never sent with a string. */
export const CONTENT_KEYS = new Set([
  "alt",
  "answer",
  "answers",
  "body",
  "brief",
  "caption",
  "completion",
  "content",
  "doc",
  "err",
  "error",
  "fix",
  "heading",
  "input",
  "instructions",
  "label",
  "message",
  "messages",
  "missing",
  "msg",
  "name",
  "notes",
  "output",
  "prompt",
  "query",
  "queries",
  "question",
  "stem",
  "subject",
  "system",
  "text",
  "title",
  "topic",
  "user",
  "value",
  "where",
  "words",
]);

const set = (...values: string[]): ReadonlySet<string> => new Set(values);

const STAGES = set(
  "check-input",
  "objectives",
  "facts",
  "plan",
  "write",
  "generate",
  "illustrate",
  "evaluate",
  "repair",
);
/** `VERIFY_REASONS` and `VERIFY_FIELDS` in `@tj/generation` (the worker's test keeps them equal). */
export const FACT_REASONS = [
  "wrong-term",
  "invented",
  "wrong-answer",
  "arithmetic",
  "false-statement",
  "off-topic",
  "ambiguous",
] as const;
export const FACT_FIELDS = [
  "term",
  "definition",
  "problem",
  "steps",
  "answer",
  "stem",
  "reasoning",
  "distractors",
  "statement",
  "explanation",
  "example",
  "analogy",
  "belief",
  "correction",
  "figure",
] as const;
/** `reason_wrong_term`, `field_answer`, …: fixed names, from the enums above. */
export const factCountKey = (prefix: "reason" | "field", label: string) =>
  `${prefix}_${label.replace(/-/g, "_")}`;
const FACT_COUNT_KEYS = [
  ...FACT_REASONS.map((r) => factCountKey("reason", r)),
  ...FACT_FIELDS.map((f) => factCountKey("field", f)),
];

/**
 * The lesson picture codes. `PICTURE_FAIL_REASONS`, `JUDGE_CHECKS`, `SOURCE_KINDS`, `PICTURE_KINDS`,
 * `LESSON_SUBJECTS` and `KEY_STAGES` in `@tj/generation` (the worker's test keeps them equal).
 */
export const PICTURE_FAIL_REASONS = [
  "judge",
  "judge-error",
  "style",
  "declined",
  "error",
  "refused-safety",
  "rate-limited",
  "quota",
  "server-error",
  "network",
  "network-unsure",
  "timeout",
  "bad-request",
  "no-image",
  "odd",
  "capped",
  "director-code",
  "director-none",
  "director-failed",
  "real-miss-no-fallback",
  "generation-refused-or-failed",
] as const;
export const JUDGE_CHECKS = [
  "no-pick",
  "off-subject",
  "wrong-kind",
  "unclear",
  "misfit",
  "items-missing",
] as const;
export const SOURCE_KINDS = ["generated", "drawn", "stock", "commons", "library", "none"] as const;
export const PICTURE_KINDS = ["portrait", "scene", "object", "drawing"] as const;
export const LESSON_SUBJECTS = [
  "english",
  "maths",
  "science",
  "history",
  "geography",
  "art-and-design",
  "computing",
  "design-and-technology",
  "languages",
  "music",
  "pe",
  "pshe",
  "re",
  "other",
] as const;
export const KEY_STAGES = ["eyfs", "ks1", "ks2", "ks3", "ks4", "ks5"] as const;
/** The director's routes (`PICTURE_ROUTES`), its failure, and the map search that runs first. */
const DIRECTOR_ROUTES = [
  "commons",
  "pexels",
  "library-or-generate",
  "code",
  "none",
  "failed",
  "map-first",
] as const;

/** The enum each string-valued key is checked against. */
/** `@tj/ai` `PROVIDER_ERROR_CODES`: a failed model call's normalised provider error. */
export const PROVIDER_ERROR_CODES = [
  "invalid_api_key",
  "unauthorized",
  "permission_denied",
  "insufficient_quota",
  "rate_limited",
  "context_length_exceeded",
  "content_filter",
  "invalid_request",
  "not_found",
  "timeout",
  "unavailable",
  "server_error",
  "network",
  "unknown",
] as const;

/** `@tj/images` `PICTURE_FAIL_STAGES`. */
export const PICTURE_FAIL_STAGES = ["generate", "save", "judge", "stock"] as const;

export const ENUMS: Record<string, ReadonlySet<string>> = {
  stage: STAGES,
  $ai_span_name: STAGES,
  stages: STAGES,
  outcome: set(
    "success",
    "failed",
    "done",
    "checked",
    "capped",
    "dropped",
    "placed",
    "empty",
    "busy",
    "drawer",
    "none",
  ),
  status: set(
    "picked",
    "started",
    "completed",
    "cancelled",
    "retry",
    "failed",
    "skipped",
    "lock_kept",
    "diagram",
    "pending",
    "photo",
  ),
  via: set(
    "none",
    "drawer",
    "fetched",
    "code",
    "library",
    "pexels",
    "commons",
    "generated",
    "generated-faithful",
  ),
  // Lesson pictures (`gen_picture_outcome`, `docs/observability.md` "Lesson pictures").
  reason: set(...PICTURE_FAIL_REASONS),
  retryReasons: set(...PICTURE_FAIL_REASONS),
  failedChecks: set(...JUDGE_CHECKS),
  sourceKind: set(...SOURCE_KINDS),
  pictureKind: set(...PICTURE_KINDS),
  lessonSubject: set(...LESSON_SUBJECTS),
  keyStage: set(...KEY_STAGES),
  director: set(...DIRECTOR_ROUTES),
  route: set("real", "generic"),
  backdrop: set("plain", "full-bleed"),
  library: set("reused", "refused", "down"),
  stock: set("placed", "miss"),
  mode: set(
    "fit",
    "groups",
    "chain",
    "plot",
    "reflect",
    "route",
    "stand-alone",
    "translate",
    "web",
    "key",
  ),
  action: set(
    "drop",
    "edit",
    "escalate",
    "groups",
    "kept",
    "no-change",
    "none",
    "redrawn",
    "refuse",
    "words",
  ),
  planner: set("writer", "objectives-first", "legacy"),
  template: set(
    "banner-text",
    "bar-model",
    "big-diagram",
    "big-visual",
    "cards-grid",
    "choose",
    "compare",
    "diagram-text",
    "discussion",
    "energy-profile",
    "equation-hero",
    "exit-ticket",
    "explain",
    "figure",
    "hinge",
    "hook",
    "items-row",
    "label",
    "myth",
    "objectives",
    "pair",
    "panel-list",
    "photo",
    "picture-sequence",
    "picture-text",
    "practice",
    "question-set",
    "reasons",
    "right-triangle",
    "sequence",
    "source",
    "split-compare",
    "stages",
    "steps",
    "title",
    "triangle",
    "visual-text",
    "worked",
  ),
  by: set("usd", "tokens"),
  level: set("info", "warn", "error"),
  how: set(
    "bare",
    "explain-to-visual-text",
    "figure-as-points",
    "figure-dropped",
    "library",
    "log-only",
    "none",
    "sentences",
    "sequence-as-steps",
    "split",
    "strip",
    "strip-continued",
    "title-one-thing",
  ),
  try: set("picture", "split"),
  call: set(
    "demand",
    "facts",
    "label",
    "objectives",
    "outline",
    "question-set",
    "skeleton",
    "slide",
    "teach",
    "verify",
  ),
  kind: set("single", "set", "handler", "infrastructure"),
  job: set(
    "ping",
    "ai.ping",
    "lesson.plan",
    "lesson.cascade",
    "lesson.regenerate",
    "lesson.generate",
    "lesson.worksheet",
  ),
  source: set(
    "writer",
    "job",
    "job:handler",
    "job:infrastructure",
    "uncaughtException",
    "unhandledRejection",
  ),
  modelClass: set("frontier", "standard", "small"),
  cls: set("frontier", "standard", "small"),
  effort: set("none", "minimal", "low", "medium", "high", "xhigh"),
  $ai_stop_reason: set(
    "stop",
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
    "unknown",
  ),
  $ai_provider: set(
    "openai.chat",
    "openai.responses",
    "amazon-bedrock",
    "bedrock",
    "gateway",
    "fake",
  ),
  errorType: set(
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "AbortError",
    "TimeoutError",
    "DrizzleQueryError",
    "PostgresError",
    "ZodError",
    "HTTPException",
    "AiError",
    "AI_APICallError",
    "AI_NoObjectGeneratedError",
    "ExtractError",
    "StageFailure",
    "InputRejected",
    "SourceUnavailable",
    "BudgetExceeded",
    "BudgetReservationError",
    "UnestimableCallError",
    "NonRetryableError",
    "ResendSendError",
    "UnknownError",
  ),
  errorCode: set(
    "22021",
    "22P05",
    "23502",
    "23503",
    "23505",
    "23514",
    "40001",
    "40P01",
    "53300",
    "57014",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOENT",
    "EACCES",
    "unconfigured",
    "provider",
    "invalid_model",
    "moderated",
  ),
  /** `@tj/ai` `PROVIDER_ERROR_CODES` (kept in step by the worker's `observability.test.ts`). */
  providerErrorCode: set(...PROVIDER_ERROR_CODES),
  /** `@tj/images` `PICTURE_FAIL_STAGES`: where a picture's try failed. */
  failStage: set(...PICTURE_FAIL_STAGES),
  /** A picture failure's code: one of ours (generator reason, provider error code) only. */
  failCode: set(...PICTURE_FAIL_REASONS, ...PROVIDER_ERROR_CODES),
  service: set("worker"),
};

/** Our ids: UUIDs (`newId`, v7 or v4). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** A prompt version from code (`verify-facts.v8`, `writer-v4.8`): a name, then `v` and digits. */
const PROMPT_VERSION = /^[a-z][a-z0-9-]{0,40}[.-]v\d{1,3}(\.\d{1,3}){0,2}[a-z]?$/;
const ID_KEYS = set("jobId", "lessonId", "$ai_trace_id");

/** Property names any event may carry besides its own (context the worker adds). */
const COMMON_KEYS = [
  "$ai_trace_id",
  "jobId",
  "lessonId",
  "job",
  "attempt",
  "resumed",
  "usagePriorUsd",
  "source",
  "status",
  "service",
  "$process_person_profile",
];

/** Message-mapped events and the property names their log lines (or the worker) give them. */
export const MESSAGE_EVENTS: Record<string, { event: string; status?: string }> = {
  "job started": { event: "gen_job", status: "started" },
  "job completed": { event: "gen_job", status: "completed" },
  "job cancelled": { event: "gen_job", status: "cancelled" },
  "job failed; pg-boss will retry": { event: "gen_job", status: "retry" },
  "job failed (non-retryable)": { event: "gen_job", status: "failed" },
  "job failed; no attempts left": { event: "gen_job", status: "failed" },
  "job already terminal, skipping": { event: "gen_job", status: "skipped" },
  "generating lock kept for the retry": { event: "gen_job", status: "lock_kept" },
  "illustrate budget stop": { event: "gen_budget_stop" },
  "lesson cost above target": { event: "gen_cost_over_target" },
  "lesson brief rejected by the input check": { event: "gen_input_rejected" },
  "source unavailable": { event: "gen_source_unavailable" },
  "input checked": { event: "gen_input_checked" },
  "plan call": { event: "gen_plan_call" },
};

/** Property names of the events that are not `ev` lines, and extras the catalogue cannot see. */
const OWN_KEYS: Record<string, readonly string[]> = {
  gen_job: ["queueWaitMs", "shutdown", "hasResult"],
  gen_budget_stop: ["stage", "slideIndex", "spentUsd", "capUsd"],
  gen_cost_over_target: ["costUsd", "planner"],
  gen_input_rejected: [],
  gen_source_unavailable: [],
  gen_input_checked: ["stage", "findings"],
  gen_plan_call: ["stage", "call", "cls", "awaited"],
  gen_fact_check: FACT_COUNT_KEYS,
  // `traceProps` in `@tj/generation` is spread into the line, so the catalogue cannot see these.
  gen_picture_outcome: [
    "retryReasons",
    "failedChecks",
    "judgeRefusals",
    "pictureCostUsd",
    "frameMeasured",
    "backdrop",
    "frameCut",
    "portraitCut",
    "cutEdges",
    "frameBleed",
    "frameMs",
    "cutsSeen",
    "failStage",
    "failStatus",
    "failCode",
  ],
  // `failureProps` in `@tj/generation` is spread into these lines.
  gen_set_error: ["failStage", "failStatus", "failCode"],
  gen_set_solo_error: ["failStage", "failStatus", "failCode"],
  /** The per-lesson roll-up of `gen_picture_outcome` (`captureLessonSummary`). */
  gen_lesson_pictures: [
    "lessonSubject",
    "keyStage",
    "planner",
    "outcome",
    "pictures",
    "notWanted",
    "toDrawer",
    "picturesPlaced",
    "picturesEmpty",
    "picturesFailed",
    "fromGenerated",
    "fromDrawn",
    "fromStock",
    "fromCommons",
    "fromLibrary",
    "generations",
    "judgeRefusals",
    "retries",
    "framesMeasured",
    "framesCut",
    "portraitsCut",
    "pictureCostUsd",
  ],
  gen_lesson: [
    "outcome",
    "planner",
    "stages",
    "costUsd",
    "calls",
    "inputTokens",
    "outputTokens",
    "durationMs",
    "readableMs",
    "checkedMs",
    "findingsError",
    "findingsWarning",
    "imagesPhotographable",
    "imagesRequested",
    "imagesPlaced",
    "imagesEmpty",
    "imagesFailed",
    "factChecks",
    "factsChecked",
    "factsCorrected",
    "factsChanged",
    "factWordsChanged",
    "factChangeRate",
    "factChecksCapped",
    "factChecksDropped",
    "repairs",
    "repairsReverted",
    "repairsFailed",
  ],
  $ai_generation: [
    "$ai_span_name",
    "$ai_model",
    "$ai_provider",
    "$ai_input_tokens",
    "$ai_output_tokens",
    "$ai_cache_read_input_tokens",
    "$ai_cache_creation_input_tokens",
    "$ai_total_cost_usd",
    "$ai_latency",
    "$ai_stop_reason",
    "$ai_is_error",
    "$ai_http_status",
    "providerErrorCode",
    "stage",
    "promptVersion",
    "effort",
    "modelClass",
  ],
  $exception: [
    "stage",
    "planner",
    "willRetry",
    "errorType",
    "errorCode",
    "causeType",
    "modelId",
    "providerStatus",
    "providerErrorCode",
  ],
};

/** The property names `event` may carry. Unknown events carry only the common ones. */
export function allowedKeys(event: string): ReadonlySet<string> {
  return new Set([...COMMON_KEYS, ...(EVENT_KEYS[event] ?? []), ...(OWN_KEYS[event] ?? [])]);
}

/** `picture-outcome` → `gen_picture_outcome`. */
export function eventNameOf(ev: string): string | undefined {
  const name = ev
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return name && name.length <= 48 ? `gen_${name}` : undefined;
}

/** A string is kept only when its key has a rule and the value passes it. */
function stringPasses(key: string, value: string, models: ReadonlySet<string>): boolean {
  if (ID_KEYS.has(key)) return UUID.test(value);
  if (key === "startedAt") return ISO_TIME.test(value);
  if (key === "promptVersion") return PROMPT_VERSION.test(value);
  if (key === "$ai_model" || key === "modelId") return models.has(value);
  return ENUMS[key]?.has(value) ?? false;
}

/**
 * `record` reduced to what `event` may carry: allowed names only, numbers and booleans freely,
 * strings and string arrays only when their rule passes. Returns the props and how many were dropped.
 */
export function enforce(
  event: string,
  record: Record<string, unknown>,
  models: ReadonlySet<string>,
): { props: Record<string, unknown>; dropped: number } {
  const allowed = allowedKeys(event);
  const props: Record<string, unknown> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const ok = (() => {
      if (!allowed.has(key)) return false;
      if (value === null || typeof value === "boolean") return true;
      if (typeof value === "number") return Number.isFinite(value);
      if (CONTENT_KEYS.has(key.toLowerCase())) return false;
      if (typeof value === "string") return stringPasses(key, value, models);
      if (Array.isArray(value)) {
        return (
          value.length <= 20 &&
          (value.every((v) => typeof v === "number" && Number.isFinite(v)) ||
            value.every((v) => typeof v === "string" && stringPasses(key, v, models)))
        );
      }
      return false;
    })();
    if (ok) props[key] = value;
    else dropped += 1;
  }
  return { props, dropped };
}

/** Log lines that are already their own event elsewhere (`$ai_generation`, `gen_lesson`). */
export const SKIPPED_MESSAGES = new Set(["generation summary"]);

/** Child-logger bindings worth keeping on every event (never content). */
export const BINDING_KEYS = ["job", "attempt", "resumed", "usagePriorUsd"] as const;
