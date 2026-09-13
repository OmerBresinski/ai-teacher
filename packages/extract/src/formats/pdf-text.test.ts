import { expect, test } from "bun:test";
import { boundedPdfText } from "./pdf-text";

test("a PDF text stream is cancelled at the cap rather than collecting every batch", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream(
    {
      pull(controller) {
        pulls += 1;
        controller.enqueue({ items: [{ str: "x".repeat(512), hasEOL: true }] });
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  await expect(boundedPdfText(stream, 1026)).rejects.toMatchObject({ code: "too-large" });
  expect(pulls).toBe(3);
  expect(cancelled).toBe(true);
});

test("legitimate PDF text preserves item order and line breaks", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ items: [{ str: "Water", hasEOL: true }, { str: "cycle" }] });
      controller.close();
    },
  });
  expect(await boundedPdfText(stream, 11)).toBe("Water\ncycle");
});
