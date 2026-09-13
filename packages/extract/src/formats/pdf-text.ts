import { ExtractError } from "../types";

interface TextChunk {
  items: { str?: string; hasEOL?: boolean }[];
}

/** Consume pdfjs text batches with backpressure; stop before accumulating an oversized page. */
export async function boundedPdfText(
  stream: ReadableStream<TextChunk>,
  remaining: number,
): Promise<string> {
  const reader = stream.getReader();
  const parts: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return parts.join("");
      for (const item of value.items) {
        if (item.str === undefined) continue;
        size += item.str.length + (item.hasEOL ? 1 : 0);
        if (size > remaining) throw new ExtractError("too-large", "pdf");
        parts.push(item.str);
        if (item.hasEOL) parts.push("\n");
      }
    }
  } finally {
    await reader.cancel(new Error("PDF text read finished")).catch(() => undefined);
    reader.releaseLock();
  }
}
