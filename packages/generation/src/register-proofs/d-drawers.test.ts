import { describe, expect, test } from "bun:test";
import {
  DIAGRAM_SAMPLES,
  diagramFaults,
  fittedDiagramElement,
  lastDiagramProbe,
  parseDiagram,
  renderDiagram,
  withLongLabels,
} from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { acceptWriterSpec } from "../writer/diagrams";
import { fixture, type J } from "./harness";

/*
 * Group D: drawer output ships wrong, or faults where code could mend it. Several separate code
 * bugs, one small fix each, all in packages/slides/src/diagrams (TEACH-247 part l).
 */

const studio = getTheme("studio", "KS3-5" as never);

describe("REGISTER diagrams-11: the particles drawer faults on its own rules instead of being mended (base4f-p123-1 y11 s9)", () => {
  // The drawer's raw output was not recorded; its fault lines were (notes.2 over 28 characters,
  // count over 20, key size). The shipped particles sample stands in, broken the same ways.
  const sample = (DIAGRAM_SAMPLES as unknown as Record<string, J>).particles as J;

  test("FIXED diagrams-11: an over-long note never drops the figure", () => {
    expect(parseDiagram(sample)).toBeDefined();
    const notes = [...(sample.notes as string[])];
    notes[2] = "far apart and moving quickly!"; // 29 characters
    // The drawer's parse (long-label scope) draws a 29-character note whole; the strict parse
    // outside that scope stays strict (long-labels.test.ts).
    const n29 = withLongLabels(() => parseDiagram({ ...sample, notes })) as unknown as J;
    expect((n29?.notes as string[] | undefined)?.[2]).toBe("far apart and moving quickly!");
    // A note past the stretch is cut at a whole word within its limit, and the spec parses.
    notes[2] = "far apart from each other and moving very quickly";
    const cut = parseDiagram({ ...sample, notes }) as unknown as J | undefined;
    expect((cut?.notes as string[] | undefined)?.[2]).toBe("far apart from each other");
    expect(notes[2]).toBe("far apart from each other and moving very quickly");
  });

  test("FIXED diagrams-11: counts past 20 are scaled together, a key past two names is cut to two, and the figure draws", () => {
    const spec = {
      kind: "particles",
      alt: "A dilute and a concentrated acid beside magnesium.",
      show: "compare",
      panels: [
        { state: "liquid", count: 10, extra: 3 },
        { state: "liquid", count: 25, extra: 6 },
      ],
      key: ["Acid particles", "Water molecules", "Magnesium surface"],
    };
    const p = parseDiagram(spec) as unknown as { panels: { count: number }[]; key?: string[] };
    expect(p?.panels.map((x) => x.count)).toEqual([8, 20]);
    expect(p?.key).toEqual(["Acid particles", "Water molecules"]);
    // the spec as sent is untouched
    expect(spec.panels[1]?.count).toBe(25);
    expect(renderDiagram(spec, studio, { w: 560, h: 356 })).toContain("<svg");
    const fit = fittedDiagramElement(spec, studio, { x: 0, y: 0, w: 560, h: 356 });
    expect(fit.ok).toBe(true);
  });

  test("FIXED diagrams-11: a key of one name is left out rather than failing the figure", () => {
    const spec = { ...sample, key: ["Acid particles"] };
    expect((parseDiagram(spec) as unknown as J | undefined)?.key).toBeUndefined();
    expect(parseDiagram(spec)).toBeDefined();
  });

  test("FIXED diagrams-11: junk never loops (NaN, Infinity and NaN counts come back at once)", () => {
    const t = Date.now();
    expect(parseDiagram(Number.NaN)).toBeUndefined();
    expect(
      parseDiagram({
        kind: "particles",
        alt: "x",
        show: "compare",
        panels: [{ count: Number.NaN }, { count: Number.POSITIVE_INFINITY }],
      }),
    ).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("REGISTER diagrams-12: a valid writer timeline is rejected for 41-character labels (pr438-writer-2 y10 s3)", () => {
  // The writer's spec was not recorded; its fault line was ('events.0.text ... <=40 characters').
  // The first proof wrote the events with `when`; the timeline's field is `date`.
  const text = "Germany and Austria-Hungary sign alliance";
  const timeline = (first: string) => ({
    kind: "timeline",
    alt: "Alliances form before 1914.",
    title: null,
    events: [
      { date: "1879", text: first },
      { date: "1882", text: "Italy joins: the Triple Alliance forms" },
      { date: "1907", text: "Triple Entente completed" },
    ],
  });
  const accept = (spec: J) =>
    acceptWriterSpec(
      spec,
      {
        key: "diagram",
        kind: "timeline",
        shows: "Alliances",
        labels: [],
        spec,
        words: "",
        yearGroup: "Year 10",
      },
      studio,
    );

  test("FIXED diagrams-12: a 41-character event is accepted whole, and the drawing wraps it", () => {
    expect(text.length).toBe(41);
    const r = accept(timeline(text));
    expect(r.fault).toBe("");
    const events = (r.spec as { events: { text: string }[] }).events;
    expect(events[0]?.text).toBe(text);
    expect(fittedDiagramElement(r.spec, studio, { x: 0, y: 0, w: 788, h: 300 }).ok).toBe(true);
  });

  test("FIXED diagrams-12: an event past what the drawer wraps (over 60 characters) still faults", () => {
    const long = "Germany and Austria-Hungary sign a secret defensive alliance treaty";
    expect(long.length).toBeGreaterThan(60);
    expect(accept(timeline(long)).fault).toContain("events.0.text");
  });
});

describe("REGISTER diagrams-13: cycle link labels run off both edges (d52 T5 y6 s4)", () => {
  const { title: _t, shows: _s, ...fig } = (fixture("diagrams-13").slide as J).figure as J;
  const splash = getTheme("splash", "KS2" as never);

  test("FIXED diagrams-13: at the recorded draw size 493x143 every word is inside the drawing, box words inside their boxes, and the shared arrow words appear once", () => {
    expect(diagramFaults(fig, splash, { w: 493, h: 143 })).toEqual([]);
    const rec = lastDiagramProbe()?.rec ?? [];
    expect(rec.filter((r) => r.x0 < 0 || r.x1 > 493 || r.y0 < 0 || r.y1 > 143)).toEqual([]);
    expect(rec.filter((r) => r.text === "blood vessels")).toHaveLength(1);
    const svg = renderDiagram(fig, splash, { w: 493, h: 143 }) ?? "";
    expect(svg.match(/blood vessels/g)).toHaveLength(1);
    expect(svg).not.toContain("Arrows:");
    // each box is as tall as its words: every label's lines sit inside its rect
    const rects = [
      ...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g),
    ]
      .map((m) => m.slice(1).map(Number) as [number, number, number, number])
      .filter(([, , rw, rh]) => rw < 493 && rh < 143);
    expect(rects).toHaveLength(4);
    for (const name of fig.nodes as string[]) {
      const r = rec.find((t) => t.text === name);
      expect(r).toBeDefined();
      const inBox = rects.some(
        ([bx, by, bw, bh]) =>
          r && r.x0 >= bx && r.x1 <= bx + bw && r.y0 >= by - 1 && r.y1 <= by + bh + 1,
      );
      expect(inBox).toBe(true);
    }
  });

  // The loop's arrows are straight (L); the ring's are bowed (Q).
  const bowed = (svg: string) => (svg.match(/ Q[\d.]/g) ?? []).length;
  const straight = (svg: string) => (svg.match(/<path d="M[\d.,]+ L[\d.,]+"/g) ?? []).length;
  const links = (nodes: string[], label?: string) =>
    nodes.map((_, i) => ({ from: i, to: (i + 1) % nodes.length, ...(label ? { label } : {}) }));
  const nodes = fig.nodes as string[];

  test("FIXED diagrams-13: an odd count draws the loop with the odd box between two columns and the shared word once, under it", () => {
    const three = {
      ...fig,
      nodes: nodes.slice(0, 3),
      links: links(nodes.slice(0, 3), "blood vessels"),
    };
    expect(diagramFaults(three, splash, { w: 493, h: 190 })).toEqual([]);
    const svg = renderDiagram(three, splash, { w: 493, h: 190 }) ?? "";
    expect(straight(svg)).toBe(3);
    expect(bowed(svg)).toBe(0);
    expect(svg.match(/blood vessels/g)).toHaveLength(1);
  });

  test("FIXED diagrams-13: with no arrow words the tight cycle is a loop with nothing between the rows", () => {
    const bare = { ...fig, links: links(nodes) };
    const svg = renderDiagram(bare, splash, { w: 493, h: 143 }) ?? "";
    expect(straight(svg)).toBe(4);
    expect(bowed(svg)).toBe(0);
    expect(svg).not.toContain("blood vessels");
  });

  test("FIXED diagrams-13: arrow words that differ are not placed by the loop; the ring is drawn", () => {
    const words = ["arteries", "veins", "arteries", "veins"];
    const mixed = { ...fig, links: links(nodes).map((l, i) => ({ ...l, label: words[i] })) };
    const svg = renderDiagram(mixed, splash, { w: 493, h: 143 }) ?? "";
    expect(bowed(svg)).toBe(4);
    expect(straight(svg)).toBe(0);
  });

  test("FIXED diagrams-13: a ring that holds its words is still drawn as the ring, each arrow with its words", () => {
    const studio = getTheme("studio", "KS3-5" as never);
    expect(diagramFaults(fig, studio, { w: 1100, h: 560 })).toEqual([]);
    const svg = renderDiagram(fig, studio, { w: 1100, h: 560 }) ?? "";
    expect(bowed(svg)).toBe(4);
    expect(straight(svg)).toBe(0);
    expect(svg.match(/blood vessels/g)).toHaveLength(4);
  });
});
