import { describe, expect, test } from "bun:test";
import { describeRef } from "../prompts/source-ref";
import type { SourceText } from "../types";
import { selectSourceTexts, sourceUnitOf } from "./source-texts";

const chunk = (sourceId: string, ref: SourceText["ref"], chars: number): SourceText => ({
  sourceId,
  ref,
  text: "x".repeat(chars),
});

/** `n` chunks of `chars` each for one source, paged. */
const pdf = (id: string, n: number, chars: number) =>
  Array.from({ length: n }, (_, i) => chunk(id, { page: i + 1 }, chars));

const total = (texts: SourceText[]) => texts.reduce((n, t) => n + t.text.length, 0);
const markers = (texts: SourceText[]) => texts.filter((t) => t.text.startsWith("[truncated:"));

describe("selectSourceTexts", () => {
  test("under the cap everything passes through untouched", () => {
    const texts = pdf("a", 5, 2_000);
    const out = selectSourceTexts(texts, { maxChars: 40_000 });
    expect(out.selected).toEqual(texts);
    expect(out.truncated).toEqual([]);
  });

  test("60k + 30k + 2k shares the budget, keeps the small source whole, marks the two cut ones", () => {
    const a = pdf("a", 60, 1_000);
    const b = Array.from({ length: 30 }, (_, i) => chunk("b", { slide: i + 1 }, 1_000));
    const c = [chunk("c", { section: "Intro" }, 1_000), chunk("c", { section: "Body" }, 1_000)];
    const out = selectSourceTexts([...a, ...b, ...c], { maxChars: 40_000 });

    const kept = out.selected.filter((t) => !t.text.startsWith("[truncated:"));
    expect(total(kept)).toBeLessThanOrEqual(40_000);
    expect(kept.filter((t) => t.sourceId === "c")).toEqual(c);
    expect(markers(out.selected)).toHaveLength(2);
    expect(out.truncated.map((t) => t.sourceId)).toEqual(["a", "b"]);
    expect(out.truncated[0]).toMatchObject({ sourceId: "a", total: 60, unit: "pages" });
    expect(out.truncated[1]).toMatchObject({ sourceId: "b", total: 30, unit: "slides" });
    // Proportional: a gets roughly twice b.
    const aChars = total(kept.filter((t) => t.sourceId === "a"));
    const bChars = total(kept.filter((t) => t.sourceId === "b"));
    expect(aChars).toBeGreaterThan(bChars);
    expect(aChars + bChars).toBeGreaterThan(30_000);
  });

  test("chunks stay in document order from the start and the marker follows the last kept one", () => {
    const a = pdf("a", 10, 5_000);
    const out = selectSourceTexts(a, { maxChars: 20_000 });
    const kept = out.selected.filter((t) => t.sourceId === "a" && !t.text.startsWith("["));
    expect(kept.map((t) => t.ref.page)).toEqual([1, 2, 3, 4]);
    const marker = markers(out.selected)[0];
    expect(marker?.ref).toEqual({ page: 4 });
    expect(marker?.text).toBe("[truncated: 6 of 10 pages omitted]");
  });

  test("a small source is never starved below the floor by a huge one", () => {
    const big = pdf("big", 100, 1_000);
    const small = Array.from({ length: 5 }, (_, i) => chunk("small", { section: `S${i}` }, 1_000));
    const out = selectSourceTexts([...big, ...small], { maxChars: 40_000 });
    const smallKept = out.selected.filter((t) => t.sourceId === "small" && !t.text.startsWith("["));
    expect(total(smallKept)).toBeGreaterThanOrEqual(4_000);
  });

  test("units: pages, slides, sections; marker wording per unit", () => {
    expect(sourceUnitOf([{ page: 1 }, { section: "x" }])).toBe("pages");
    expect(sourceUnitOf([{ slide: 2 }])).toBe("slides");
    expect(sourceUnitOf([{ section: "x" }, {}])).toBe("sections");
    const docx = Array.from({ length: 8 }, (_, i) => chunk("d", { section: `H${i}` }, 1_000));
    const out = selectSourceTexts(docx, { maxChars: 3_000 });
    expect(markers(out.selected)[0]?.text).toBe("[truncated: 5 of 8 sections omitted]");
  });

  test("empty input is empty output", () => {
    expect(selectSourceTexts([], { maxChars: 40_000 })).toEqual({ selected: [], truncated: [] });
  });
});

describe("describeRef", () => {
  test("renders page, slide, section, or nothing", () => {
    expect(describeRef({ page: 3 })).toBe("p.3");
    expect(describeRef({ slide: 4 })).toBe("slide 4");
    expect(describeRef({ section: "Cells" })).toBe("§Cells");
    expect(describeRef({})).toBe("");
  });
});
