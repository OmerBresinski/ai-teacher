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
  | "server-error"
  | "network"
  | "timeout"
  | "bad-request"
  | "no-image";

/** A generation that failed, with its reason code and how many requests were made. */
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

/** A 400 is a safety refusal when the provider's code or message says so. */
function isSafetyRefusal(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /moderation_blocked|content_policy_violation|safety system|safety_violation|rejected by the safety/i.test(
    body,
  );
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
 * A 429, a 5xx or a network error is retried `retries` times with backoff (Retry-After honoured);
 * a safety refusal, any other 4xx, a timeout or an abort is not. Every failure is an
 * `ImageGenerationError` with its reason code.
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
}): ImageGenerator {
  const model = opts.model ?? IMAGE_MODEL;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const retries = Math.max(0, opts.retries ?? IMAGE_RETRIES);
  const backoffMs = opts.backoffMs ?? IMAGE_BACKOFF_MS;
  const sleep = opts.sleep ?? sleepFor;
  const random = opts.random ?? Math.random;
  /** One request: the response, or a classified failure. */
  const once = async (
    prompt: string,
    size: ImageSize,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<{ res: Response } | { fail: ImageGenerationError; retryAfterMs?: number }> => {
    let res: Response;
    try {
      res = await fetchFn("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality: IMAGE_QUALITY, n: 1 }),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
    } catch (e) {
      // The caller's abort stops everything; our own timeout is not retried (120 s is enough).
      if (signal?.aborted) throw e;
      const name = (e as { name?: string } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError")
        return {
          fail: new ImageGenerationError("image generation timed out", "timeout", attempt),
        };
      return {
        fail: new ImageGenerationError(
          `image generation failed (network): ${String(e).slice(0, 120)}`,
          "network",
          attempt,
        ),
      };
    }
    if (res.ok) return { res };
    const text = await res.text().catch(() => "");
    const reason: ImageFailReason =
      res.status === 429
        ? "rate-limited"
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
      ...(Number.isFinite(after) && after > 0
        ? { retryAfterMs: Math.min(after * 1000, MAX_RETRY_AFTER_MS) }
        : {}),
    };
  };
  return {
    model,
    async generate({ prompt, size, signal }) {
      const t0 = Date.now();
      let res: Response | undefined;
      let attempts = 0;
      for (;;) {
        attempts++;
        const r = await once(prompt, size, attempts, signal);
        if ("res" in r) {
          res = r.res;
          break;
        }
        if (!TRANSIENT.has(r.fail.reason) || attempts > retries) throw r.fail;
        const wait = r.retryAfterMs ?? backoffMs * 2 ** (attempts - 1) * (1 + 0.25 * random());
        await sleep(Math.round(wait), signal);
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

/** The line a retry adds to its image prompt. */
export function retryLine(hint: RetryHint): string {
  const why = hint.why?.replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, 240);
  if (hint.reason === "refused-safety")
    return "Keep it calm and suitable for a primary school classroom: nothing graphic, frightening, injured or unsafe.";
  if (hint.reason === "odd")
    return `Match the rest of the set exactly: the same kind, colours and markings${why ? ` (last time: ${why})` : ""}.`;
  return why
    ? `The last picture was turned down because: ${why}. Fix that.`
    : "The last picture was turned down: show the request plainly and whole.";
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
