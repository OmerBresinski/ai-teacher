// unshared (BAKEOFF base4f, base4-4 y2 "Find half of 14"): counters a question asks pupils to share
// are drawn as one pile (or the row the words describe), never pre-shared, at a countable size.
import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { pileSpec } from "./groups";
import { parseDiagram, renderDiagram } from "./index";

describe("unshared pile", () => {
  const writer = {
    kind: "equal-groups",
    shows:
      "Fourteen unshared counters in a single ring, ready for pupils to draw and share into two equal groups",
    alt: "Fourteen counters are together in one ring.",
    total: 14,
    groups: 10,
  };
  test("an unshared request becomes one pile of every counter, no count", () => {
    const p = pileSpec(writer, `${writer.shows} ${writer.alt}`) as unknown as Record<
      string,
      unknown
    >;
    expect(p).toMatchObject({ total: 14, groups: 1, show_count: "none", pile: true });
  });
  test("a worked sharing request is left alone", () => {
    expect(
      pileSpec({ ...writer, groups: 2 }, "Twelve counters shared equally between two rings"),
    ).toBeUndefined();
  });
  test("the pile parses and fills the panel at a countable size", () => {
    const p = pileSpec(writer, writer.shows);
    expect(parseDiagram(p)).toBeDefined();
    const svg = renderDiagram(p, getTheme("studio", "ks1"), { w: 788, h: 223 }) ?? "";
    // no ring (a ring reads as a group); 14 counters each at least 19 units (28px at 1440); no count
    const radii = [...svg.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii.filter((r) => r >= 9.5).length).toBe(14);
    expect(radii.some((r) => r > 40)).toBe(false);
    expect(svg).not.toMatch(/>7</);
  });
  test("a row the words describe draws as one line", () => {
    const p = pileSpec(
      { ...writer, total: 12 },
      "Twelve counters are shown in one row, not yet shared.",
    ) as unknown as Record<string, unknown>;
    expect(p.layout).toBe("rows");
    const svg = renderDiagram(p, getTheme("studio", "ks1"), { w: 788, h: 177 }) ?? "";
    const ys = new Set(
      [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r="([\d.]+)"/g)]
        .filter((m) => Number(m[2]) >= 9.5)
        .map((m) => m[1]),
    );
    expect(ys.size).toBe(1);
  });
});

// G3 (lab-p1-y2-maths-s06, s08): "Find the number in one ring" in the alt matched UNSHARED and
// turned two rings into one pile. The spec's fields decide the drawing.
describe("structured fields beat free text", () => {
  const g3 = {
    kind: "equal-groups",
    total: 10,
    groups: 2,
    layout: "rings",
    show_count: "each",
    unknown: true,
    alt: "Ten counters shared equally between two rings. Find the number in one ring.",
  };
  test("the G3 spec stays two groups even when its alt is read", () => {
    expect(pileSpec(g3, g3.alt)).toBeUndefined();
    expect(pileSpec({ ...g3, total: 16 }, g3.alt)).toBeUndefined();
  });
  test("the G3 spec draws 2 rings of 5 with a hidden count in each", () => {
    const p = parseDiagram(g3);
    expect(p).toMatchObject({ kind: "equal-groups", total: 10, groups: 2 });
    const svg = renderDiagram(g3, getTheme("splash", "ks1"), { w: 788, h: 300 }) ?? "";
    const radii = [...svg.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]));
    const big = Math.max(...radii);
    // two ring outlines, ten counters
    expect(radii.filter((r) => r === big).length).toBe(2);
    expect(svg.match(/>\?</g)?.length).toBe(2);
    expect(svg).not.toMatch(/>5</);
  });
});

// Register proof diagrams-03 (lab/register-proofs, d-drawers.test.ts), inverted: the recorded
// figure from base4f-p123-1 y2 s6 stays two rings when shows, shows and alt are all read.
describe("REGISTER diagrams-03: 'Count one group' drawn as ten loose dots (base4f-p123-1 y2 s6)", () => {
  test("FIXED diagrams-03: the alt's 'in one ring' no longer turns a 2-ring unknown spec into a pile", () => {
    const f = {
      kind: "equal-groups",
      shows: "Ten counters shared into two rings, with group counts unknown",
      alt: "Ten counters shared equally between two rings. Find the number in one ring.",
      total: 10,
      groups: 2,
      layout: "rings",
      show_count: "each",
      unknown: true,
    };
    const words = `${f.shows} ${f.shows} ${f.alt}`;
    expect(f.groups).toBe(2);
    expect(pileSpec(f, words)).toBeUndefined();
    const { shows: _shows, ...spec } = f;
    expect(parseDiagram(spec)).toMatchObject({ kind: "equal-groups", total: 10, groups: 2 });
  });
});
