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
