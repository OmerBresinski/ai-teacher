import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { materialiseSlide } from "@tj/slides";
import { dataUrlAspect, titleVariantFor, visibleAspect } from "./title-photo";

/** FIX1 item 5: FULL-RUN y9 s1, the 1923 Weimar photo (a 211 x 250 portrait) under a long title. */
const spec = {
  kind: "title",
  factRefs: [],
  title: "Weimar Germany: why did hyperinflation happen in 1923?",
  subtitle: "Year 9 · History",
} as never;
const meta = { promptVersion: "t", model: "code", at: "1970-01-01T00:00:00.000Z" };
const ORDER = ["split", "photo-band", "photo-band-long"] as const;

describe("title photo keeps its subject", () => {
  test("a JPEG thumbnail's shape is read from its frame header", () => {
    const jpg = readFileSync(`${import.meta.dir}/fixtures/weimar-1923-thumb.jpg`);
    expect(dataUrlAspect(`data:image/jpeg;base64,${jpg.toString("base64")}`)).toBeCloseTo(
      211 / 250,
      2,
    );
  });

  test("a portrait photo takes the composition that shows most of it", () => {
    const shown = (v: string) =>
      visibleAspect(materialiseSlide(spec, "studio", meta, undefined, v)) as number;
    const v = titleVariantFor(spec, "studio", ORDER, 211 / 250) as string;
    for (const o of ORDER)
      expect(Math.abs(Math.log(0.844 / shown(v)))).toBeLessThanOrEqual(
        Math.abs(Math.log(0.844 / shown(o))),
      );
    // A full-bleed photo under a band shows a strip several times wider than tall: not this one.
    expect(shown(v)).toBeLessThan(2);
  });

  test("a wide photo keeps the band composition", () => {
    expect(titleVariantFor(spec, "studio", ["photo-band", "split"], 3.5)).toBe("photo-band");
  });
});
