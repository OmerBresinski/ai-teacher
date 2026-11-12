import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { diagramElement, diagramFaults, fractionOfAmountBar, fromMeaning } from "./index";
import { fractionLabel, mixedText, partsText } from "./quantity";

/** v5.3-gold B1/B3: a fraction of an amount drawn as a bar, its parts as a fractions lesson writes them. */
const HALF = { x: 58, y: 126, w: 363, h: 371 };
const svgOf = (spec: unknown) =>
  decodeURIComponent(diagramElement(spec, getTheme("splash"), HALF)?.src ?? "");
const texts = (svg: string) => [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);

describe("mixedText and partsText", () => {
  test.each([
    [10, 4, "2 1/2"],
    [7, 5, "1 2/5"],
    [8, 3, "2 2/3"],
    [3, 4, "3/4"],
    [12, 4, "3"],
    [30, 4, "7 1/2"],
  ])("%p in %p", (p, q, want) => {
    expect(mixedText(p, q)).toBe(want);
  });
  test("a denominator over 12 is not a mixed number", () => {
    expect(mixedText(10, 13)).toBeUndefined();
    expect(partsText(10, 13)).toBe("0.77");
  });
  test("money keeps its pence; a decimal whole keeps its decimal", () => {
    expect(partsText(10, 4, 1, "£")).toBe("2.50");
    expect(partsText(7.5, 3)).toBe("2.5");
    expect(partsText(10, 4, 3, "m")).toBe("7 1/2");
  });
  test("labels split for stacking", () => {
    expect(fractionLabel("5 1/3 m")).toEqual({ pre: "5", num: "1", den: "3", post: "m" });
    expect(fractionLabel("1/3")).toEqual({ pre: "", num: "1", den: "3", post: "" });
    expect(fractionLabel("2.5")).toBeUndefined();
    expect(fractionLabel("?")).toBeUndefined();
  });
});

describe("fractionOfAmountBar", () => {
  test("3/4 of 10: 4 parts of 2 1/2, 3 shaded, 10 braced, the answer 7 1/2", () => {
    const s = fractionOfAmountBar({ whole: 10, parts: 4, shaded: 3 }) as never as {
      bars: { parts: { label: string; shaded?: boolean }[]; total: string }[];
      combined: string;
    };
    expect(s.bars[0]?.parts.map((p) => p.label)).toEqual(["2 1/2", "2 1/2", "2 1/2", "2 1/2"]);
    expect(s.bars[0]?.parts.filter((p) => p.shaded).length).toBe(3);
    expect(s.bars[0]?.total).toBe("10");
    expect(s.combined).toBe("7 1/2");
  });
  test("the remainder: 2/3 of 8 m used leaves 2 2/3 m, braced under the unshaded part", () => {
    const s = fractionOfAmountBar({ whole: 8, parts: 3, shaded: 2, unit: "m", left: true });
    expect(s).toMatchObject({ combined: "2 2/3 m left", rest: true });
    expect(diagramFaults(s, getTheme("splash"), HALF)).toEqual([]);
  });
  test("out of range gives nothing", () => {
    expect(fractionOfAmountBar({ whole: 10, parts: 13, shaded: 1 })).toBeUndefined();
    expect(fractionOfAmountBar({ whole: 10, parts: 4, shaded: 5 })).toBeUndefined();
    expect(fractionOfAmountBar({ whole: 10, parts: 4, shaded: 4, left: true })).toBeUndefined();
  });
  test("the drawing stacks each part's fraction: whole part, numerator, bar, denominator", () => {
    const svg = svgOf(fractionOfAmountBar({ whole: 10, parts: 4, shaded: 3 }));
    expect(svg).not.toContain("2.5");
    expect(texts(svg).some((t) => t?.includes("/"))).toBe(false);
    expect(texts(svg).filter((t) => t === "2").length).toBeGreaterThanOrEqual(4);
    expect((svg.match(/<line [^>]*stroke-linecap="round"/g) ?? []).length).toBeGreaterThanOrEqual(
      5,
    );
    expect(
      diagramFaults(
        fractionOfAmountBar({ whole: 7, parts: 5, shaded: 3 }),
        getTheme("splash"),
        HALF,
      ),
    ).toEqual([]);
  });
});

describe("the writer's bar-model form (B3)", () => {
  test("10 in 4 parts is labelled 2 1/2, never 2.5", () => {
    const d = fromMeaning({
      kind: "bar-model",
      alt: "a",
      bars: [{ whole: 10, parts: 4, shaded: 3 }],
    }) as {
      bars: { parts: { label: string }[] }[];
    };
    expect(d.bars[0]?.parts[0]?.label).toBe("2 1/2");
  });
  test("money keeps pence: £10 in 4 parts is £2.50", () => {
    const d = fromMeaning({
      kind: "bar-model",
      alt: "a",
      bars: [{ whole: 10, parts: 4, unit: "£" }],
    }) as { bars: { parts: { label: string }[] }[] };
    expect(d.bars[0]?.parts[0]?.label).toBe("£2.50");
  });
});
