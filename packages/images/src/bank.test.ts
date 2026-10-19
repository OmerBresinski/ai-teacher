import { describe, expect, test } from "bun:test";
import {
  createOpenAiImageGenerator,
  directedImagePrompt,
  expectedImageCostUsd,
  familyOf,
  IMAGE_MODEL,
  ImageGenerationError,
  imageCostUsd,
  imageFailReason,
  RETRY_NOTE_CHARS,
  retryLine,
  retryNote,
  sizeForAspect,
  withRetryLine,
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

  /** A fake provider that answers each request from a script, counting requests and waits. */
  const scripted = (script: (() => Response | Promise<Response>)[]) => {
    let n = 0;
    const waits: number[] = [];
    const fetch = (async () => {
      const step = script[Math.min(n, script.length - 1)];
      n++;
      return step ? step() : new Response("", { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    const gen = createOpenAiImageGenerator({
      apiKey: "k",
      fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
      random: () => 0,
    });
    return { gen, waits, calls: () => n };
  };
  const ok = () =>
    new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }] }));
  test("a 429 is retried after its backoff, then succeeds on the second request", async () => {
    const { gen, waits, calls } = scripted([() => new Response("slow down", { status: 429 }), ok]);
    const out = await gen.generate({ prompt: "p", size: "1024x1024" });
    expect(calls()).toBe(2);
    expect(out.attempts).toBe(2);
    expect(waits).toEqual([1500]);
  });
  test("a 429's Retry-After is honoured (capped at 20 s)", async () => {
    const { gen, waits } = scripted([
      () => new Response("", { status: 429, headers: { "retry-after": "3" } }),
      () => new Response("", { status: 429, headers: { "retry-after": "600" } }),
      ok,
    ]);
    await gen.generate({ prompt: "p", size: "1024x1024" });
    expect(waits).toEqual([3000, 20000]);
  });
  test("5xx every time: two retries with doubling backoff, then a server-error", async () => {
    const { gen, waits, calls } = scripted([() => new Response("down", { status: 503 })]);
    const err = await gen.generate({ prompt: "p", size: "1024x1024" }).catch((e) => e);
    expect(err).toBeInstanceOf(ImageGenerationError);
    expect(err.reason).toBe("server-error");
    expect(err.status).toBe(503);
    expect(err.attempts).toBe(3);
    expect(String(err)).toContain("image generation failed (503)");
    expect(imageFailReason(err)).toBe("server-error");
    expect(calls()).toBe(3);
    expect(waits).toEqual([1500, 3000]);
  });
  test("a network error is retried", async () => {
    const { gen, calls } = scripted([
      () => {
        throw new TypeError("fetch failed");
      },
      ok,
    ]);
    expect((await gen.generate({ prompt: "p", size: "1024x1024" })).attempts).toBe(2);
    expect(calls()).toBe(2);
  });
  test("a safety refusal is never retried and has its own reason code", async () => {
    const { gen, waits, calls } = scripted([
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "moderation_blocked",
              message: "Your request was rejected by the safety system.",
            },
          }),
          { status: 400 },
        ),
    ]);
    const err = await gen.generate({ prompt: "p", size: "1024x1024" }).catch((e) => e);
    expect(err.reason).toBe("refused-safety");
    expect(err.attempts).toBe(1);
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
    expect(String(err)).not.toContain("safety system");
  });
  test("a plain 400 is a bad-request, not retried; the caller's abort stops a backoff", async () => {
    const { gen, calls } = scripted([() => new Response("no", { status: 400 })]);
    const err = await gen.generate({ prompt: "p", size: "1024x1024" }).catch((e) => e);
    expect(err.reason).toBe("bad-request");
    expect(calls()).toBe(1);
    const ctl = new AbortController();
    const fetch = (async () => {
      ctl.abort();
      return new Response("", { status: 503 });
    }) as unknown as typeof globalThis.fetch;
    const real = createOpenAiImageGenerator({ apiKey: "k", fetch, backoffMs: 10 });
    await expect(
      real.generate({ prompt: "p", size: "1024x1024", signal: ctl.signal }),
    ).rejects.toThrow();
  });
});

describe("retryLine", () => {
  test("a retry always changes the prompt, with the judge's reason when it gave one", () => {
    expect(withRetryLine("A hen.")).toBe("A hen.");
    expect(withRetryLine("A hen.", { reason: "judge", why: "no chick visible." })).toBe(
      "A hen.\nA previous attempt at this picture was turned down. The reviewer's note, which describes that attempt and not this picture: no chick visible. Correct what the note found, and keep the subject, style and framing the request above sets. Nothing from this note is written in the picture.",
    );
    expect(retryLine({ reason: "judge" })).toContain("turned down");
    expect(retryLine({ reason: "odd", why: "a different breed" })).toContain(
      "which describes the set and not this picture: a different breed.",
    );
    // A safety retry points at the teaching need; it never asks to get round a filter.
    const safe = retryLine({ reason: "refused-safety" });
    expect(safe).toContain("what the lesson teaches");
    expect(safe).not.toMatch(/filter|policy|fictional|artistic|hypothetical/i);
    // Every judged retry says its note is not to be drawn.
    for (const reason of ["judge", "odd"])
      for (const why of [undefined, "x"])
        expect(retryLine({ reason, ...(why ? { why } : {}) })).toEndWith(
          "Nothing from this note is written in the picture.",
        );
  });
  test("a judge's note never carries quoted words or quote marks into the prompt", () => {
    expect(retryNote('the barn has a sign reading "FARM" on it.')).toBe(
      "the barn has a sign reading some writing on it",
    );
    expect(retryNote("a label \u2018Hen\u2019 and a \u201ctitle\u201d")).toBe(
      "a label some writing and a some writing",
    );
    expect(retryNote("the chick's beak is 'open' here")).toBe(
      "the chick's beak is some writing here",
    );
    expect(retryNote("a  hen\n on   grass. ")).toBe("a hen on grass");
    const long = retryNote(`${"word ".repeat(80)}end`);
    expect(long.length).toBeLessThanOrEqual(RETRY_NOTE_CHARS);
    expect(long.endsWith("word")).toBe(true);
  });
});
