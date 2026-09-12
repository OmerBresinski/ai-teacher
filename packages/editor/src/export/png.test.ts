import { describe, expect, it, mock } from "bun:test";
import { captureFetch, PNG_SCALES, pngFilename, pngPixelSize } from "./png";

describe("png helpers", () => {
  it("names each slide file by 1-based number", () => {
    expect(pngFilename({ title: "The water cycle" }, 0)).toBe("the-water-cycle-1.png");
    expect(pngFilename({ title: "The water cycle" }, 6)).toBe("the-water-cycle-7.png");
  });

  it("says what each scale produces", () => {
    expect(PNG_SCALES).toEqual([1, 2, 3]);
    expect(pngPixelSize(1)).toBe("960 x 540");
    expect(pngPixelSize(2)).toBe("1920 x 1080");
    expect(pngPixelSize(3)).toBe("2880 x 1620");
  });
});

describe("captureFetch (TEACH-272 §1)", () => {
  it("fetches an api-origin image with the cookie and returns a data URL", async () => {
    const original = globalThis.fetch;
    const fetchSpy = mock(async () => new Response(new Blob(["x"], { type: "image/png" })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const result = await captureFetch("https://api.test")("https://api.test/files/ws/a.png");
      expect(result).toMatch(/^data:image\/png;base64,/);
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.credentials).toBe("include");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("leaves a foreign image to the library's own fetch", async () => {
    const original = globalThis.fetch;
    const fetchSpy = mock(async () => new Response("never"));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      expect(await captureFetch("https://api.test")("https://elsewhere.test/a.png")).toBe(false);
      expect(await captureFetch(undefined)("https://api.test/files/a.png")).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
