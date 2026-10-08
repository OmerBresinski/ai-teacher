/**
 * Generated pictures (TEACH-237, UX ruling 158): the pure parts, shared by the worker and the tests.
 * The generation size per slide zone, the frame and no-text lines code owns on every generation
 * prompt, the image price, and the OpenAI image generator behind a small interface. The library's
 * reuse and embeddings come with TEACH-84 part b.
 */
/** Ruling 158 (amended 5 Oct): sunburst won realism and UK context at flare's price. */
export const IMAGE_MODEL = "gpt-image-2.5-sunburst";
export const IMAGE_QUALITY = "low";
/** The model's terms version recorded on every generated row, so a terms change retires them. */
export const IMAGE_TERMS = "openai-2026-10";

/** Standard-tier rates (verified against the provider's price page): per token, USD. */
const IMAGE_OUT_USD = 30 / 1e6;
const TEXT_IN_USD = 5 / 1e6;
/** Image input tokens (a reference picture): priced high (unverified) so guards stay safe. */
const IMAGE_IN_USD = 10 / 1e6;

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
