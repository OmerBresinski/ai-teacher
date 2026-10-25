import { redactSecrets } from "@tj/domain";
/**
 * Generated pictures (TEACH-237, UX ruling 158): the pure parts, shared by the worker and the tests.
 * The generation size per slide zone, the frame and no-text lines code owns on every generation
 * prompt, the image price, and the OpenAI image generator behind a small interface; and the
 * library's reuse rule (TEACH-84 part b): the licence filter for what it may keep, cosine over
 * request embeddings in the same aspect family at the lab's calibrated threshold, and the OpenAI
 * embedder. No database here: the store lives in `@tj/db` (`bank.ts`).
 */
import { licenceClass } from "./commons";

/** Ruling 158 (amended 5 Oct): sunburst won realism and UK context at flare's price. */
export const IMAGE_MODEL = "gpt-image-2.5-sunburst";
export const IMAGE_QUALITY = "low";
/** The model's terms version recorded on every generated row, so a terms change retires them. */
export const IMAGE_TERMS = "openai-2026-10";
/** The cheapest good OpenAI embedding (TEACH-84: ~$0.000004 a lookup). */
export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMENSIONS = 1536;

/** Standard-tier rates (verified against the provider's price page): per token, USD. */
const IMAGE_OUT_USD = 30 / 1e6;
const TEXT_IN_USD = 5 / 1e6;
/** Image input tokens (a reference picture): priced high (unverified) so guards stay safe. */
const IMAGE_IN_USD = 10 / 1e6;
const EMBED_USD = 0.02 / 1e6;

export type AspectFamily = "landscape" | "square" | "portrait";
export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "2048x1152";

/**
 * The generation size for a slide zone of `aspect` (width over height), and its family. Wide
 * bands (16:9 and wider) take 2048×1152; landscape 3:2; near-square zones 1:1; tall zones 2:3.
 * Unknown aspect: square, the safest crop either way.
 */
export function sizeForAspect(aspect?: number): { size: ImageSize; family: AspectFamily } {
  if (aspect === undefined || !Number.isFinite(aspect) || aspect <= 0)
    return { size: "1024x1024", family: "square" };
  if (aspect >= 1.65) return { size: "2048x1152", family: "landscape" };
  if (aspect >= 1.2) return { size: "1536x1024", family: "landscape" };
  if (aspect > 0.83) return { size: "1024x1024", family: "square" };
  return { size: "1024x1536", family: "portrait" };
}

/** The family of a stored picture of `width`×`height` (the same cut points as the sizes). */
export function familyOf(width: number, height: number): AspectFamily {
  return sizeForAspect(width / height).family;
}

/** Image-output tokens at low for each size (the guide's calculator; 1536×1024 measured). */
const LOW_OUTPUT_TOKENS: Record<ImageSize, number> = {
  "1024x1024": 196,
  "1536x1024": 158,
  "1024x1536": 158,
  "2048x1152": 157,
};

export function imageCostUsd(usage: {
  inputTokens: number;
  outputTokens: number;
  imageInputTokens?: number;
}): number {
  const img = usage.imageInputTokens ?? 0;
  return (
    usage.outputTokens * IMAGE_OUT_USD +
    (usage.inputTokens - img) * TEXT_IN_USD +
    img * IMAGE_IN_USD
  );
}

/** What a generation costs before it runs, for a budget guard (prompt ~100 tokens). */
export function expectedImageCostUsd(size: ImageSize): number {
  return imageCostUsd({ inputTokens: 100, outputTokens: LOW_OUTPUT_TOKENS[size] });
}

/**
 * The picture director's image prompt with the lines whose meaning never changes, which code owns:
 * one frame, and no text (a real thing keeps its own text; only added text is ruled out).
 */
export function directedImagePrompt(prompt: string, faithful: boolean): string {
  return [
    prompt.replace(/\s+/g, " ").trim(),
    "A single image, not a collage, grid or set of panels.",
    faithful
      ? "No added captions, labels or watermarks."
      : "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
  ].join("\n");
}

export function embedCostUsd(tokens: number): number {
  return tokens * EMBED_USD;
}

/** What the library may keep (ruling 139): Pexels, generated, or Commons PD, CC0, CC BY, BY-SA. */
export function bankLicenceOk(source: { provider: string; licence?: string }): boolean {
  if (source.provider === "pexels" || source.provider === "generated") return true;
  if (source.provider === "commons") return licenceClass(source.licence ?? "") !== undefined;
  return false;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * The reuse threshold on cosine between request embeddings (`text-embedding-3-small`). Picked on
 * the labelled set `calibration/reuse-pairs.json` (`calibration/calibrate.ts`, `result.txt`): with
 * `numbersAgree` applied, 0.77 reuses 8 of the 10 "same" pairs and none of the 12 "near" or 10
 * "different" ones (precision 1.00, recall 0.80). Without the number rule, "24 counters in four
 * groups of six" and "12 counters in three groups of four" score 0.87: no threshold separates them.
 */
export const REUSE_THRESHOLD = 0.77;

export type BankCandidate<T> = { similarity: number; family: AspectFamily; row: T };

const UNITS =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

/** The numbers a request states, digits or words ("Twenty-four" is 24), as a sorted list. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const s = text.toLowerCase();
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  const words = s.match(/[a-z]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const tens = TENS.indexOf(words[i] ?? "");
    if (tens >= 2) {
      const unit = UNITS.indexOf(words[i + 1] ?? "");
      const ones = unit > 0 && unit < 10 ? unit : 0;
      out.push(tens * 10 + ones);
      if (ones) i += 1;
      continue;
    }
    const unit = UNITS.indexOf(words[i] ?? "");
    if (unit >= 2) out.push(unit);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Two requests may share a picture only when they state the same numbers: "24 counters in four
 * groups of six" is not "12 counters in three groups of four", however alike the words read.
 */
export function numbersAgree(a: string, b: string): boolean {
  const x = numbersIn(a);
  const y = numbersIn(b);
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

/** The best stored picture to reuse: same family, at or above the threshold; else undefined. */
export function pickReuse<T>(
  candidates: readonly BankCandidate<T>[],
  family: AspectFamily,
  threshold = REUSE_THRESHOLD,
): BankCandidate<T> | undefined {
  let best: BankCandidate<T> | undefined;
  for (const c of candidates) {
    if (c.family !== family || c.similarity < threshold) continue;
    if (!best || c.similarity > best.similarity) best = c;
  }
  return best;
}

/** The text a request is embedded and stored by: the writer's words, with the name if any. */
export function requestText(request: { text: string; named?: string | null }): string {
  const t = request.text.trim().replace(/\s+/g, " ");
  return request.named && !t.toLowerCase().includes(request.named.toLowerCase())
    ? `${request.named}: ${t}`
    : t;
}

export interface ImageGenerator {
  readonly model: string;
  generate(input: { prompt: string; size: ImageSize; signal?: AbortSignal }): Promise<{
    bytes: Uint8Array;
    mime: string;
    usage: { inputTokens: number; outputTokens: number };
    costUsd: number;
    ms: number;
    /** How many requests it took (1 when the first answered); absent from fakes. */
    attempts?: number;
  }>;
}

/**
 * Why a generation failed, as a log code. `refused-safety` is the provider's moderation or safety
 * refusal: never retried with the same prompt, and counted on its own. `rate-limited`,
 * `server-error` and `network` are retried by the generator; the rest are not.
 */
export type ImageFailReason =
  | "refused-safety"
  | "rate-limited"
  | "quota"
  | "server-error"
  | "network"
  | "network-unsure"
  | "timeout"
  | "bad-request"
  | "no-image";

/** A generation that failed, with its reason code and how many requests reached the provider. */
export class ImageGenerationError extends Error {
  readonly reason: ImageFailReason;
  readonly status?: number;
  readonly attempts: number;
  constructor(message: string, reason: ImageFailReason, attempts: number, status?: number) {
    super(message);
    this.name = "ImageGenerationError";
    this.reason = reason;
    this.attempts = attempts;
    if (status !== undefined) this.status = status;
  }
}

/** The reason code of any generation error (an error from elsewhere is `error`). */
export function imageFailReason(error: unknown): ImageFailReason | "error" {
  return error instanceof ImageGenerationError ? error.reason : "error";
}

/** Where a picture's try failed: making it, storing it, judging it, or the stock search. */
export const PICTURE_FAIL_STAGES = ["generate", "save", "judge", "stock"] as const;
export type PictureFailStage = (typeof PICTURE_FAIL_STAGES)[number];

/** An error raised at a known picture stage (a storage write, so it is not taken for the model). */
export class PictureStageError extends Error {
  override readonly name = "PictureStageError";
  readonly stage: PictureFailStage;
  constructor(stage: PictureFailStage, cause: unknown) {
    super(`The picture ${stage} step failed.`, { cause });
    this.stage = stage;
  }
}

/**
 * A failed picture try, for its trace and the debug record: the stage, the error's class, a code
 * (generator reason, provider code, S3 error code) and HTTP status where known, and a short message
 * with keys, credentials and URL query strings removed. Only `stage`, `code` (when an enum) and
 * `status` may reach PostHog (ADR 0041).
 */
export interface PictureFailure {
  stage: PictureFailStage;
  error: string;
  code?: string;
  status?: number;
  message?: string;
}

export const PICTURE_FAILURE_MESSAGE_MAX = 300;
const IDENT = /^[A-Za-z0-9_.:-]{1,64}$/;
const identOf = (v: unknown) => (typeof v === "string" && IDENT.test(v) ? v : undefined);
const statusOf = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 100 && v < 600 ? v : undefined;

/** `error` as a `PictureFailure`; `stage` unless the error names its own (`PictureStageError`). */
export function pictureFailureOf(error: unknown, stage: PictureFailStage): PictureFailure {
  let at = stage;
  let inner: unknown = error;
  if (error instanceof PictureStageError) {
    at = error.stage;
    inner = error.cause;
  }
  if (!(inner instanceof Error)) return { stage: at, error: "UnknownError" };
  let status: number | undefined;
  let code: string | undefined;
  let providerMessage: string | undefined;
  // The first status and code down the cause chain: an AiError's `ProviderFailure`, an S3 error's
  // `$metadata`, a generator's `ImageGenerationError`.
  let cur: unknown = inner;
  for (let depth = 0; depth < 6 && cur && typeof cur === "object"; depth++) {
    const e = cur as Record<string, unknown> & { $metadata?: { httpStatusCode?: unknown } };
    status ??=
      statusOf(e.status) ?? statusOf(e.statusCode) ?? statusOf(e.$metadata?.httpStatusCode);
    code ??=
      cur instanceof ImageGenerationError
        ? cur.reason
        : (identOf(e.providerErrorCode) ?? identOf(e.Code) ?? identOf(e.code));
    if (typeof e.providerMessage === "string") providerMessage ??= e.providerMessage;
    cur = e.cause;
  }
  // An S3 service error's class name is its code (`AccessDenied`, `NoSuchBucket`).
  if (!code && "$metadata" in inner && inner.name !== "Error") code = identOf(inner.name);
  const raw = providerMessage ?? inner.message;
  const message = redactSecrets(
    String(raw ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return {
    stage: at,
    error: identOf(inner.name) ?? "Error",
    ...(code ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(message
      ? {
          message:
            message.length > PICTURE_FAILURE_MESSAGE_MAX
              ? `${message.slice(0, PICTURE_FAILURE_MESSAGE_MAX - 1)}…`
              : message,
        }
      : {}),
  };
}

/**
 * How many requests of a failed generation reached the provider: an `ImageGenerationError` says;
 * any other error (a fake, a storage failure after the picture was made) counts as one.
 */
export function requestsSent(error: unknown): number {
  return error instanceof ImageGenerationError ? error.attempts : 1;
}

/** A 400 is a safety refusal when the provider's code or message says so. */
function isSafetyRefusal(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /moderation_blocked|content_policy_violation|safety system|safety_violation|rejected by the safety/i.test(
    body,
  );
}

/** A 429 that is an account limit (quota, billing), not a busy provider: waiting will not help. */
function isQuota(body: string): boolean {
  return /insufficient_quota|billing_hard_limit|billing limit|exceeded your current quota|quota/i.test(
    body,
  );
}

/**
 * Connection errors raised before any byte of the request was sent (Node/undici and Bun codes):
 * the only network errors that are safe to repeat. The images API documents no idempotency key,
 * so an error after the request may have been sent (a reset, a closed socket) is never repeated:
 * the provider may have made, and billed, that picture.
 */
const BEFORE_SEND =
  /^(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|ConnectionRefused|FailedToOpenSocket)$/;
function sentBeforeFailing(e: unknown): boolean {
  const code = (x: unknown) => (x as { code?: unknown } | null)?.code;
  const c = code(e) ?? code((e as { cause?: unknown } | null)?.cause);
  return !(typeof c === "string" && BEFORE_SEND.test(c));
}

/** Is this failure worth the same request again (a busy or broken provider, not the request)? */
const TRANSIENT: ReadonlySet<ImageFailReason> = new Set([
  "rate-limited",
  "server-error",
  "network",
]);

/** The default retries after the first request: 429, 5xx and network errors only. */
export const IMAGE_RETRIES = 2;
/** The first backoff; each later one doubles, with up to a quarter more at random. */
export const IMAGE_BACKOFF_MS = 1_500;
/** A server's Retry-After is honoured up to this long. */
const MAX_RETRY_AFTER_MS = 20_000;
/**
 * One request's own time limit, even when the caller passes a signal (a low-quality picture takes
 * about 14-25 s, PICTURE-FAILURES.md).
 */
export const IMAGE_ATTEMPT_TIMEOUT_MS = 60_000;
/**
 * One picture's whole time across its requests and the waits between them (Retry-After included):
 * no retry starts that could not finish inside it, and the last request's limit is what is left.
 */
export const IMAGE_RETRY_BUDGET_MS = 90_000;
/** A retry needs at least this long left in the budget to be worth starting. */
const MIN_ATTEMPT_MS = 20_000;

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export interface Embedder {
  readonly model: string;
  embed(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ vector: number[]; tokens: number; costUsd: number }>;
}

type FetchFn = typeof globalThis.fetch;

/**
 * OpenAI direct (`/v1/images/generations`), base64 PNG out. Never logs the prompt (ADR 0015).
 * A 429, a 5xx or a connection refused before sending is retried `retries` times with backoff
 * (Retry-After honoured), inside one time budget per picture (`IMAGE_RETRY_BUDGET_MS`), each
 * request under its own limit (`IMAGE_ATTEMPT_TIMEOUT_MS`). A quota 429, a safety refusal, any
 * other 4xx, a timeout, a network error after sending, or an abort is not retried. Every failure is
 * an `ImageGenerationError` with its reason code and the requests that reached the provider.
 */
export function createOpenAiImageGenerator(opts: {
  apiKey: string;
  model?: string;
  fetch?: FetchFn;
  /** Retries after the first request (default `IMAGE_RETRIES`). */
  retries?: number;
  /** The first backoff in ms (default `IMAGE_BACKOFF_MS`). */
  backoffMs?: number;
  /** Waits between tries (tests pass a fake); default a real, abortable timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The random part of the backoff, 0..1 (tests pass a constant). */
  random?: () => number;
  /** One request's limit (default `IMAGE_ATTEMPT_TIMEOUT_MS`). */
  attemptTimeoutMs?: number;
  /** One picture's total time across tries and waits (default `IMAGE_RETRY_BUDGET_MS`). */
  budgetMs?: number;
  /** The clock (tests pass a fake). */
  now?: () => number;
}): ImageGenerator {
  const model = opts.model ?? IMAGE_MODEL;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const retries = Math.max(0, opts.retries ?? IMAGE_RETRIES);
  const backoffMs = opts.backoffMs ?? IMAGE_BACKOFF_MS;
  const sleep = opts.sleep ?? sleepFor;
  const random = opts.random ?? Math.random;
  const attemptMs = opts.attemptTimeoutMs ?? IMAGE_ATTEMPT_TIMEOUT_MS;
  const budgetMs = opts.budgetMs ?? IMAGE_RETRY_BUDGET_MS;
  const now = opts.now ?? Date.now;
  /** One request: the response, or a classified failure; `sent` when it reached the provider. */
  const once = async (
    prompt: string,
    size: ImageSize,
    sentSoFar: number,
    limitMs: number,
    signal?: AbortSignal,
  ): Promise<
    { res: Response } | { fail: ImageGenerationError; sent: boolean; retryAfterMs?: number }
  > => {
    let res: Response;
    // Its own limit always applies, beside the caller's signal (which may never fire).
    const own = AbortSignal.timeout(Math.max(1, Math.round(limitMs)));
    try {
      res = await fetchFn("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality: IMAGE_QUALITY, n: 1 }),
        signal: signal ? AbortSignal.any([signal, own]) : own,
      });
    } catch (e) {
      // The caller's abort stops everything; our own timeout is not retried.
      if (signal?.aborted) throw e;
      const name = (e as { name?: string } | null)?.name;
      if (own.aborted || name === "TimeoutError" || name === "AbortError")
        return {
          fail: new ImageGenerationError("image generation timed out", "timeout", sentSoFar + 1),
          sent: true,
        };
      const sent = sentBeforeFailing(e);
      return {
        fail: new ImageGenerationError(
          `image generation failed (network): ${String(e).slice(0, 120)}`,
          sent ? "network-unsure" : "network",
          sentSoFar + (sent ? 1 : 0),
        ),
        sent,
      };
    }
    const attempt = sentSoFar + 1;
    if (res.ok) return { res };
    const text = await res.text().catch(() => "");
    const reason: ImageFailReason =
      res.status === 429
        ? isQuota(text)
          ? "quota"
          : "rate-limited"
        : res.status >= 500
          ? "server-error"
          : isSafetyRefusal(res.status, text)
            ? "refused-safety"
            : "bad-request";
    const after = Number(res.headers.get("retry-after"));
    return {
      fail: new ImageGenerationError(
        `image generation failed (${res.status}): ${reason}`,
        reason,
        attempt,
        res.status,
      ),
      sent: true,
      ...(Number.isFinite(after) && after > 0
        ? { retryAfterMs: Math.min(after * 1000, MAX_RETRY_AFTER_MS) }
        : {}),
    };
  };
  return {
    model,
    async generate({ prompt, size, signal }) {
      const t0 = now();
      let res: Response | undefined;
      /** Requests that reached the provider (a connection refused before sending is not one). */
      let attempts = 0;
      for (let tries = 1; ; tries++) {
        const left = budgetMs - (now() - t0);
        const r = await once(prompt, size, attempts, Math.min(attemptMs, left), signal);
        if ("res" in r) {
          attempts++;
          res = r.res;
          break;
        }
        if (r.sent) attempts++;
        if (!TRANSIENT.has(r.fail.reason) || tries > retries) throw r.fail;
        const wait = Math.round(
          r.retryAfterMs ?? backoffMs * 2 ** (tries - 1) * (1 + 0.25 * random()),
        );
        // No retry that could not finish inside the picture's budget.
        if (now() - t0 + wait + MIN_ATTEMPT_MS > budgetMs) throw r.fail;
        await sleep(wait, signal);
      }
      const body = (await res.json()) as {
        data?: { b64_json?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const b64 = body.data?.[0]?.b64_json;
      if (!b64)
        throw new ImageGenerationError("image generation returned no image", "no-image", attempts);
      const usage = {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
      return {
        bytes: new Uint8Array(Buffer.from(b64, "base64")),
        mime: "image/png",
        usage,
        costUsd: imageCostUsd(usage),
        ms: Date.now() - t0,
        attempts,
      };
    },
  };
}

/**
 * What a picture's retry asks differently, so it never repeats the request that failed: the
 * judge's reason (a missing thing, a wrong count), the set judge's (it did not match the others)
 * or a safety refusal's. Code owns this line; a wording change goes through the prompt-engineer.
 */
export interface RetryHint {
  /** The failure's code: a generator reason (`refused-safety`), `judge` or `odd`. */
  reason: string;
  /** The judge's own words, when it gave any (never the prompt). */
  why?: string;
}

/** A judge's note as a retry may quote it: one line, no quoted words, cut at a word. */
export function retryNote(why: string | undefined): string {
  const note = (why ?? "")
    .replace(/\s+/g, " ")
    // Quoted words (a sign's text, a label) would be drawn as text: name them, never copy them.
    .replace(
      /["\u201c\u201d`][^"\u201c\u201d`]*["\u201c\u201d`]|\u2018[^\u2019]*\u2019/g,
      "some writing",
    )
    .replace(/(^|\s)'[^']+'(?=[\s.,;:!?]|$)/g, "$1some writing")
    .replace(/["\u201c\u201d`\u2018\u2019]/g, "")
    .trim()
    .replace(/[.\s]+$/, "");
  if (note.length <= RETRY_NOTE_CHARS) return note;
  const cut = note.slice(0, RETRY_NOTE_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)).trim();
}
/** The longest judge's note a retry carries (a one-sentence `why` fits whole). */
export const RETRY_NOTE_CHARS = 240;

/** Every retry line ends here: a note is for the image model to read, never to draw. */
const NOT_DRAWN = "Nothing from this note is written in the picture.";

/**
 * The line a retry adds to its image prompt (prompt-engineer, 19 Oct 2026). It changes only what
 * failed: the judge's note is framed as describing the rejected picture, so its words are not read
 * as new things to draw, and the request above keeps the subject, style and framing. A safety
 * refusal is rephrased toward what the lesson needs pupils to see, never toward getting past a filter.
 */
export function retryLine(hint: RetryHint): string {
  if (hint.reason === "refused-safety")
    return "Show it the way a school textbook would, for what the lesson teaches: calm, factual and suitable for pupils, with nothing graphic or distressing.";
  const note = retryNote(hint.why);
  if (hint.reason === "odd")
    return note
      ? `This picture replaces one that did not match the rest of its set. The reviewer's note, which describes the set and not this picture: ${note}. Make this picture match the set in what the note says differed, and keep the subject, style and framing the request above sets. ${NOT_DRAWN}`
      : `This picture replaces one that did not match the rest of its set. Show the request above exactly as written, in the same style and framing. ${NOT_DRAWN}`;
  return note
    ? `A previous attempt at this picture was turned down. The reviewer's note, which describes that attempt and not this picture: ${note}. Correct what the note found, and keep the subject, style and framing the request above sets. ${NOT_DRAWN}`
    : `A previous attempt at this picture was turned down. Show the request above plainly, whole and exactly as written, in the same style and framing. ${NOT_DRAWN}`;
}

/** The prompt for a retry: the same request with the retry's line after it. */
export function withRetryLine(prompt: string, hint?: RetryHint): string {
  return hint ? `${prompt}\n${retryLine(hint)}` : prompt;
}

/**
 * OpenAI embeddings, cached in-process by text (the same request text never pays twice), the
 * newest `max` texts only (about 12 KB a vector; 2,000 is about 25 MB).
 */
export function createOpenAiEmbedder(opts: {
  apiKey: string;
  fetch?: FetchFn;
  max?: number;
}): Embedder {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const max = opts.max ?? 2_000;
  const cache = new Map<string, Promise<{ vector: number[]; tokens: number; costUsd: number }>>();
  return {
    model: EMBED_MODEL,
    embed(text, signal) {
      const hit = cache.get(text);
      if (hit) {
        // Least recently used goes first: a hit moves to the back.
        cache.delete(text);
        cache.set(text, hit);
        return hit.then((r) => ({ ...r, tokens: 0, costUsd: 0 }));
      }
      const p = (async () => {
        const res = await fetchFn("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: EMBED_MODEL, input: text }),
          signal: signal ?? AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`embedding failed (${res.status})`);
        const body = (await res.json()) as {
          data: { embedding: number[] }[];
          usage?: { total_tokens?: number };
        };
        const tokens = body.usage?.total_tokens ?? 0;
        return { vector: body.data[0]?.embedding ?? [], tokens, costUsd: embedCostUsd(tokens) };
      })();
      cache.set(text, p);
      if (cache.size > max) cache.delete(cache.keys().next().value as string);
      p.catch(() => cache.delete(text));
      return p;
    },
  };
}
