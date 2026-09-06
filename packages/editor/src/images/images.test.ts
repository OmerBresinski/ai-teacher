import { afterEach, describe, expect, test } from "bun:test";
import { fileToDataUrl, fitWithin, isImageFile, readAsDataUrl } from "./images";

/* TEACH-107 row 11: the fit maths, the type gate and the passthrough branches of the downscaler
   under happy-dom (no canvas — the raster branch is covered by the e2e spec in a real browser). */

describe("fitWithin", () => {
  test("shrinks a landscape image to the box width and keeps the aspect", () => {
    expect(fitWithin({ w: 3000, h: 2000 }, { w: 576, h: 324 })).toEqual({ w: 486, h: 324 });
  });

  test("shrinks a portrait image to the box height", () => {
    expect(fitWithin({ w: 1000, h: 2000 }, { w: 576, h: 324 })).toEqual({ w: 162, h: 324 });
  });

  test("upscales a small image up to the box, never past it", () => {
    expect(fitWithin({ w: 100, h: 50 }, { w: 576, h: 324 })).toEqual({ w: 576, h: 288 });
  });

  test("survives a zero-sized natural without dividing by zero", () => {
    const fit = fitWithin({ w: 0, h: 0 }, { w: 576, h: 324 });
    expect(Number.isFinite(fit.w)).toBe(true);
    expect(Number.isFinite(fit.h)).toBe(true);
  });
});

describe("isImageFile", () => {
  test("accepts any image/* type and refuses the rest", () => {
    expect(isImageFile(new File(["x"], "a.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File(["x"], "a.svg", { type: "image/svg+xml" }))).toBe(true);
    expect(isImageFile(new File(["x"], "a.pdf", { type: "application/pdf" }))).toBe(false);
    expect(isImageFile(new File(["x"], "a"))).toBe(false);
  });
});

describe("readAsDataUrl", () => {
  test("reads the bytes as a base64 data URL of the file's type", async () => {
    const url = await readAsDataUrl(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect(url).toBe(`data:image/svg+xml;base64,${btoa("<svg/>")}`);
  });
});

describe("fileToDataUrl passthrough", () => {
  const RealImage = globalThis.Image;
  afterEach(() => {
    globalThis.Image = RealImage;
  });

  /** An `Image` that decodes to a fixed natural size (or fails) as soon as `src` is set. */
  const stubImage = (size: { w: number; h: number } | null) => {
    class FakeImage {
      decoding = "auto";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = size?.w ?? 0;
      naturalHeight = size?.h ?? 0;
      set src(_: string) {
        queueMicrotask(() => (size ? this.onload?.() : this.onerror?.()));
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
  };

  test("keeps an SVG's bytes untouched and reports its natural size", async () => {
    stubImage({ w: 300, h: 150 });
    const file = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    const out = await fileToDataUrl(file);
    expect(out.src.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(out).toMatchObject({ w: 300, h: 150 });
  });

  test("keeps a GIF untouched so the animation survives, with a 512 fallback size", async () => {
    stubImage(null);
    const file = new File(["GIF89a"], "a.gif", { type: "image/gif" });
    const out = await fileToDataUrl(file);
    expect(out.src.startsWith("data:image/gif;base64,")).toBe(true);
    expect(out).toMatchObject({ w: 512, h: 512 });
  });

  test("rejects a raster file that cannot be decoded", async () => {
    stubImage(null);
    const file = new File(["nope"], "a.png", { type: "image/png" });
    await expect(fileToDataUrl(file)).rejects.toThrow("Could not decode the image");
  });
});
