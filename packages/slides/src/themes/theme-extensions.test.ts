import { describe, expect, test } from "bun:test";
import type { SlideElement, TextElement } from "@tj/domain/documents";
import { TextStyleSchema } from "@tj/domain/documents";
import { layoutTemplate } from "../templates/index";
import { MYTH_NAMES } from "../templates/myth";
import { MYTH_CASES } from "../templates/myth-fixtures";
import { WORKED_CASES } from "../templates/worked-fixtures";
import { mathFaceOf, quoteFaceOf } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import { getTheme, THEMES } from "../themes";
import { surfacesOf } from "./surfaces";

/*
 * Theme extensions for the round 5 golds (TEACH-215 part c): tracking on a text style, a maths
 * run face, an emphasis colour and outlined proof icons. Geometric sets each; every other theme
 * keeps the defaults, so nothing else changes.
 */
const geo = getTheme("geometric");
const others = THEMES.filter((t) => t.id !== "geometric");
const runs = (els: readonly SlideElement[]) =>
  els.flatMap((e) =>
    e.type === "text"
      ? ((e as TextElement).doc.content?.flatMap((p) =>
          "content" in p ? (p.content ?? []) : [],
        ) ?? [])
      : [],
  ) as { text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[];
const fontOf = (r: ReturnType<typeof runs>[number]) =>
  r.marks?.find((m) => m.type === "textStyle")?.attrs?.font;

describe("(a) letterSpacing on a text style", () => {
  test("an own letterSpacing wins over the preset's; the schema takes em only", () => {
    expect(resolveTextStyle({ preset: "caption", letterSpacing: "0.1em" }, geo).letterSpacing).toBe(
      "0.1em",
    );
    expect(resolveTextStyle({ preset: "caption" }, geo).letterSpacing).toBe("0.08em");
    expect(TextStyleSchema.safeParse({ preset: "body", letterSpacing: "0.08em" }).success).toBe(
      true,
    );
    expect(TextStyleSchema.safeParse({ preset: "body", letterSpacing: "4px" }).success).toBe(false);
  });
  test("Geometric tracks its myth tags 0.08em; other themes keep the preset's", () => {
    expect(surfacesOf(geo).marks.tagTracking).toBe("0.08em");
    expect(surfacesOf(geo).marks.kickerTracking).toBe("0.1em");
    for (const t of others) expect(surfacesOf(t).marks.tagTracking).toBeNull();
    const k = MYTH_CASES[0]!;
    const tags = (t = geo) =>
      layoutTemplate(k.input, t, k.stage).slide.elements.filter(
        (e): e is TextElement => e.name === MYTH_NAMES.stamp || e.name === MYTH_NAMES.factLabel,
      );
    expect(tags().every((e) => e.style.letterSpacing === "0.08em")).toBe(true);
    expect(tags(getTheme("paper")).some((e) => e.style.letterSpacing)).toBe(false);
  });
});

describe("(b) the maths run face", () => {
  test("Geometric's variables are Source Serif italic; another theme's stay its quote face", () => {
    expect(mathFaceOf(geo).italic).toBe(true);
    expect(mathFaceOf(geo).family).toContain("source-serif");
    for (const t of others) expect(mathFaceOf(t)).toEqual(quoteFaceOf(t));
  });
  test("worked variables are math runs; the myth claim stays a quote run", () => {
    const w = WORKED_CASES["y8-panel"]!;
    const wr = runs(layoutTemplate(w.input, geo, w.stage).slide.elements);
    expect(wr.some((r) => r.text === "x" && fontOf(r) === "math")).toBe(true);
    expect(wr.some((r) => fontOf(r) === "quote")).toBe(false);
    const k = MYTH_CASES[0]!;
    const mr = runs(layoutTemplate(k.input, geo, k.stage).slide.elements);
    expect(mr.some((r) => fontOf(r) === "math")).toBe(false);
  });
});

describe("(c) the emphasis colour", () => {
  test("Geometric's fact emphasis is #1842B8; every other theme has none (the accent)", () => {
    expect(surfacesOf(geo).marks.emphasis).toBe("#1842B8");
    for (const t of others) expect(surfacesOf(t).marks.emphasis).toBeNull();
    const k = MYTH_CASES[0]!;
    const colours = runs(layoutTemplate(k.input, geo, k.stage).slide.elements).map(
      (r) => r.marks?.find((m) => m.type === "textStyle")?.attrs?.color,
    );
    expect(colours).toContain("#1842B8");
  });
});

describe("(d) outlined proof icons", () => {
  test("only Geometric outlines its proof medals' icons in ink", () => {
    expect(surfacesOf(geo).marks.iconOutline).toBe(true);
    for (const t of others) expect(surfacesOf(t).marks.iconOutline).toBe(false);
  });
});
