/**
 * The picture library (TEACH-84, UX ruling 158): the pure parts, shared by the worker, the lab
 * smoke and the tests. Aspect mapping per slide zone, the generation prompt (one subject, locale
 * only where the subject involves it, no text in the picture), the licence filter for what the library may keep, the reuse
 * rule (cosine over request embeddings, same aspect family), and the OpenAI image generator and
 * embedder behind small interfaces. No database here: the store lives in `@tj/db` (`bank.ts`).
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

/** Standard-tier rates (IMG-BAKEOFF RESULT.md, verified): per token, USD. */
const IMAGE_OUT_USD = 30 / 1e6;
const TEXT_IN_USD = 5 / 1e6;
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

export function imageCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  return usage.outputTokens * IMAGE_OUT_USD + usage.inputTokens * TEXT_IN_USD;
}

/** What a generation costs before it runs, for a budget guard (prompt ~100 tokens). */
export function expectedImageCostUsd(size: ImageSize): number {
  return imageCostUsd({ inputTokens: 100, outputTokens: LOW_OUTPUT_TOKENS[size] });
}

export function embedCostUsd(tokens: number): number {
  return tokens * EMBED_USD;
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
  }>;
}

export interface Embedder {
  readonly model: string;
  embed(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ vector: number[]; tokens: number; costUsd: number }>;
}

type FetchFn = typeof globalThis.fetch;

/** OpenAI direct (`/v1/images/generations`), base64 PNG out. Never logs the prompt (ADR 0015). */
export function createOpenAiImageGenerator(opts: {
  apiKey: string;
  model?: string;
  fetch?: FetchFn;
}): ImageGenerator {
  const model = opts.model ?? IMAGE_MODEL;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  return {
    model,
    async generate({ prompt, size, signal }) {
      const t0 = Date.now();
      const res = await fetchFn("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality: IMAGE_QUALITY, n: 1 }),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`image generation failed (${res.status})`);
      const body = (await res.json()) as {
        data?: { b64_json?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new Error("image generation returned no image");
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
      };
    },
  };
}

/** OpenAI embeddings, cached in-process by text (the same request text never pays twice). */
export function createOpenAiEmbedder(opts: { apiKey: string; fetch?: FetchFn }): Embedder {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const cache = new Map<string, Promise<{ vector: number[]; tokens: number; costUsd: number }>>();
  return {
    model: EMBED_MODEL,
    embed(text, signal) {
      const hit = cache.get(text);
      if (hit) return hit.then((r) => ({ ...r, tokens: 0, costUsd: 0 }));
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
      p.catch(() => cache.delete(text));
      return p;
    },
  };
}
