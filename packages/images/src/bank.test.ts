import { describe, expect, test } from "bun:test";
import {
  createOpenAiImageGenerator,
  directedImagePrompt,
  expectedImageCostUsd,
  familyOf,
  IMAGE_MODEL,
  imageCostUsd,
  sizeForAspect,
} from "./bank";

describe("sizeForAspect (ruling 158 item 3)", () => {
  test("the ticket's slot aspects 1.8, 1.4, 1.0 and 0.7", () => {
    expect([1.8, 1.4, 1.0, 0.7].map((a) => sizeForAspect(a).size)).toEqual([
      "2048x1152",
      "1536x1024",
      "1024x1024",
      "1024x1536",
    ]);
  });
  test.each([
    [960 / 540, "2048x1152", "landscape"],
    [16 / 9, "2048x1152", "landscape"],
    [1.5, "1536x1024", "landscape"],
    [1.25, "1536x1024", "landscape"],
    [363 / 378, "1024x1024", "square"],
    [480 / 540, "1024x1024", "square"],
    [1, "1024x1024", "square"],
    [2 / 3, "1024x1536", "portrait"],
    [0.75, "1024x1536", "portrait"],
  ])("aspect %p -> %s (%s)", (aspect, size, family) => {
    expect(sizeForAspect(aspect)).toEqual({ size, family } as never);
  });
  test("unknown or bad aspect is square", () => {
    expect(sizeForAspect(undefined).size).toBe("1024x1024");
    expect(sizeForAspect(Number.NaN).size).toBe("1024x1024");
    expect(sizeForAspect(0).size).toBe("1024x1024");
  });
  test("familyOf uses the same cut points", () => {
    expect(familyOf(1536, 1024)).toBe("landscape");
    expect(familyOf(1024, 1536)).toBe("portrait");
    expect(familyOf(650, 650)).toBe("square");
  });
});

describe("cost", () => {
  test("1536x1024 low measured at 28 in + 158 out = $0.00488", () => {
    expect(imageCostUsd({ inputTokens: 28, outputTokens: 158 })).toBeCloseTo(0.00488, 5);
  });
  test("expected cost stays near half a cent", () => {
    expect(expectedImageCostUsd("1024x1024")).toBeLessThan(0.0065);
    expect(expectedImageCostUsd("2048x1152")).toBeLessThan(0.0055);
  });
});

describe("directedImagePrompt", () => {
  test("the director's prompt, then the frame and text lines code owns", () => {
    const generic = directedImagePrompt("  A sheep and its lamb grazing.\n", false).split("\n");
    expect(generic).toEqual([
      "A sheep and its lamb grazing.",
      "A single image, not a collage, grid or set of panels.",
      "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
    ]);
    expect(directedImagePrompt("A 1923 street.", true)).toContain(
      "No added captions, labels or watermarks.",
    );
  });
});

describe("createOpenAiImageGenerator (fake fetch)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  test("posts the model, size and low quality; returns bytes, usage and cost", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get("authorization"),
      });
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from(png).toString("base64") }],
          usage: { input_tokens: 28, output_tokens: 158 },
        }),
      );
    }) as unknown as typeof globalThis.fetch;
    const gen = createOpenAiImageGenerator({ apiKey: "k", fetch });
    const out = await gen.generate({ prompt: "A hen.", size: "1536x1024" });
    expect(gen.model).toBe(IMAGE_MODEL);
    expect(IMAGE_MODEL).toBe("gpt-image-2.5-sunburst");
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0]?.auth).toBe("Bearer k");
    expect(calls[0]?.body).toEqual({
      model: "gpt-image-2.5-sunburst",
      prompt: "A hen.",
      size: "1536x1024",
      quality: "low",
      n: 1,
    });
    expect([...out.bytes]).toEqual([...png]);
    expect(out.mime).toBe("image/png");
    expect(out.costUsd).toBeCloseTo(0.00488, 5);
  });
  test("a refused call or an empty answer throws, naming no prompt", async () => {
    const refused = (async () =>
      new Response("no", { status: 400 })) as unknown as typeof globalThis.fetch;
    await expect(
      createOpenAiImageGenerator({ apiKey: "k", fetch: refused }).generate({
        prompt: "secret prompt",
        size: "1024x1024",
      }),
    ).rejects.toThrow("image generation failed (400)");
    const empty = (async () =>
      new Response(JSON.stringify({ data: [] }))) as unknown as typeof globalThis.fetch;
    await expect(
      createOpenAiImageGenerator({ apiKey: "k", fetch: empty }).generate({
        prompt: "p",
        size: "1024x1024",
      }),
    ).rejects.toThrow("returned no image");
  });
});
