import { Buffer } from "node:buffer";
import type { LanguageModelMiddleware } from "ai";
import { imageMeta } from "image-meta";
import type { TokenUsage } from "./prices";

export type PreparedCall = Parameters<
  NonNullable<LanguageModelMiddleware["wrapGenerate"]>
>[0]["params"];
export const PROTOCOL_TOKEN_HEADROOM = 4096;
export const MAX_IMAGE_INPUT_TOKENS = 36_001;
const IMAGE_MODELS = /^(?:us|global|in)\.openai\.gpt-5\.6-(?:luna|terra|sol)$/;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const encoder = new TextEncoder();

/** Inspect only a bounded raster header, never decode pixels or trust URL size hints. */
function imageTokens(data: unknown): number {
  if (!(data instanceof Uint8Array)) return MAX_IMAGE_INPUT_TOKENS;
  // Buffer.slice is a view: the JPEG reader's segment walk must not copy every remaining suffix.
  const prefix = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, 4096));
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(prefix.subarray(start, end));
  const raster =
    (prefix[0] === 255 && prefix[1] === 216) ||
    (prefix[0] === 137 && ascii(1, 8) === "PNG\r\n\u001a\n") ||
    (ascii(0, 4) === "RIFF" && ascii(8, 15) === "WEBPVP8") ||
    ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  if (!raster) return MAX_IMAGE_INPUT_TOKENS;
  try {
    const { width, height } = imageMeta(prefix);
    if (
      !width ||
      !height ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1
    )
      return MAX_IMAGE_INPUT_TOKENS;
    return Math.min(
      MAX_IMAGE_INPUT_TOKENS,
      Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 1.2) + 1,
    );
  } catch {
    return MAX_IMAGE_INPUT_TOKENS;
  }
}

/** Upper-biased reservation, not an exact tokenizer or provider invoice guarantee (ADR 0025). */
export function estimatePreparedCall(modelId: string, params: PreparedCall): TokenUsage | null {
  if (!Number.isSafeInteger(params.maxOutputTokens) || (params.maxOutputTokens ?? 0) < 1)
    return null;
  let images = 0;
  const prompt: unknown[] = [];
  for (const message of params.prompt) {
    if (message.role === "system") {
      prompt.push(message);
      continue;
    }
    if (message.role !== "user") return null;
    const content: unknown[] = [];
    for (const part of message.content) {
      if (part.type === "text") content.push(part);
      else if (part.type === "file" && IMAGE_TYPES.has(part.mediaType)) {
        if (!IMAGE_MODELS.test(modelId)) return null;
        images += imageTokens(part.data.type === "data" ? part.data.data : undefined);
        content.push({
          type: "file",
          mediaType: part.mediaType,
          filename: part.filename,
          providerOptions: part.providerOptions,
        });
      } else return null;
    }
    prompt.push({ ...message, content });
  }
  const bytes = encoder.encode(
    JSON.stringify({ ...params, prompt, abortSignal: undefined }),
  ).byteLength;
  const inputTokens = bytes + PROTOCOL_TOKEN_HEADROOM + images;
  return {
    inputTokens,
    outputTokens: params.maxOutputTokens as number,
    // Cache writes can cost more than uncached input; do not assume a discount before dispatch.
    cacheWriteInputTokens: inputTokens,
  };
}
