// BAKEOFF round 6: fixes by mechanism for the round 5 sheet faults (no paid calls).
import { describe, expect, test } from "bun:test";
import { getTheme } from "../../packages/slides/src/themes";
import { armT } from "./arm-t";
import { countFault, duplicateFaults, noEmDash, referentFault } from "./checks";
import { isApparatus } from "./harness";

describe("round 6: visual or rewrite", () => {
  test("the referent check catches r5 y2 s3, y2 s5, y4 s4 and y12 s7", () => {
    for (const words of [
      "Is this fair? Are these two parts halves? Tell your partner why.",
      "Look closely. Which shape shows one half shaded? Why is the shaded part of C not one quarter?",
      "Three important dates. Read the timeline from earliest to latest.",
      "Participants recalled word lists immediately or after 30 seconds of counting. Describe the difference.",
    ])
      expect(referentFault(words, false)).toMatch(/^dangling:/);
    expect(referentFault("Read the timeline from earliest to latest.", true)).toBeUndefined();
  });
  test("ordinary wording is not a referent", () => {
    for (const words of [
      "Apply the model. Two sealed syringes contain equal volumes.",
      "Describe the difference between a solid and a liquid.",
      "The particle model represents matter as tiny particles.",
    ])
      expect(referentFault(words, false)).toBeUndefined();
  });
  test("words only drops the pointing sentences and questions", () => {
    const out = armT.asWords?.({
      template: "practice",
      heading: "Look again",
      questions: ["Which shape shows one half shaded?", "What is half of 12?"],
    });
    expect(out?.questions).toEqual(["What is half of 12?"]);
  });
});

describe("round 6: apparatus is a photo", () => {
  test("a labelled drawing of apparatus is a photo's job; particles and maps are not", () => {
    expect(isApparatus("labelled-diagram", "A conical flask connected to a gas syringe")).toBe(
      true,
    );
    expect(isApparatus("labelled-diagram", "The layers of the rainforest")).toBe(false);
    expect(isApparatus("particles", "Particles in a flask")).toBe(false);
  });
});

describe("round 6: duplicates", () => {
  test("r5 y12 s10 and s11 (same heading) are caught; a parallel example is not", () => {
    const d = duplicateFaults([
      {
        index: 9,
        heading: "Build an evidence-based answer",
        words: "Describe STM coding 30 seconds",
      },
      {
        index: 10,
        heading: "Build an evidence-based answer",
        words: "Describe STM coding and capacity 30",
      },
      {
        index: 6,
        heading: "One quarter of 8",
        words: "Share 8 counters into four equal groups. One quarter of 8 is 2.",
      },
      {
        index: 7,
        heading: "One quarter of 20",
        words: "Share 20 counters into four equal groups. One quarter of 20 is 5.",
      },
    ]);
    expect([...d.keys()]).toEqual([10]);
  });
});

describe("round 6: counts match the drawing", () => {
  const dots = (n: number, fill = "accent") =>
    Array.from({ length: n }, (_, i) => ({ type: "circle", cx: 10 + i * 6, cy: 30, r: 2, fill }));
  test("20 counters labelled over 18 drawn is a fault; 20 over 20 is not", () => {
    expect(
      countFault({ kind: "labelled-diagram", shapes: dots(18), labels: [{ text: "20 counters" }] }),
    ).toMatch(/^count:/);
    expect(
      countFault({ kind: "labelled-diagram", shapes: dots(20), labels: [{ text: "20 counters" }] }),
    ).toBeUndefined();
  });
  test("one group's count (one colour) is fine", () => {
    const shapes = [...dots(5, "accent2"), ...dots(15, "muted")];
    expect(
      countFault({ kind: "labelled-diagram", shapes, labels: [{ text: "5 counters" }] }),
    ).toBeUndefined();
  });
});

describe("round 6: text sanity", () => {
  test("em dashes become brackets or colons (r5 y8)", () => {
    expect(noEmDash("Il est gentil. — He is kind.")).toBe("Il est gentil. (He is kind.)");
    expect(noEmDash("Mon frère — my brother")).toBe("Mon frère (my brother)");
    expect(noEmDash("No dash here")).toBe("No dash here");
  });
});

describe("round 6: tables keep a real layout", () => {
  test("a table too big for the side panel takes the full width under the words", async () => {
    const { layoutTemplate } = await import("../../packages/slides/src/templates/index");
    const table = {
      kind: "table",
      alt: "The three stores.",
      header: ["Store", "Coding", "Capacity", "Duration"],
      rows: [
        ["Sensory register", "Modality-specific", "Very large", "About 0.5 to 2 seconds"],
        [
          "Short-term memory",
          "Mainly acoustic",
          "7 plus or minus 2 items",
          "About 18 to 30 seconds",
        ],
        ["Long-term memory", "Mainly semantic", "Potentially unlimited", "Potentially lifelong"],
      ],
    };
    const r = layoutTemplate(
      {
        template: "diagram-text",
        heading: "Three stores, different characteristics",
        lead: "Coding means format; capacity means amount; duration means time.",
        figure: { diagram: table },
      } as never,
      getTheme("studio", "ks5" as never),
      "ks5" as never,
    );
    expect(r.diagram ?? []).toEqual([]);
    const img = r.slide.elements.find((e) => e.type === "image");
    expect(img?.w).toBeGreaterThan(600);
  });
});

describe("round 6: timelines with BC and AD dates", () => {
  test("a period given as years becomes positions; a broken one is dropped", async () => {
    const { mendSpec } = await import("../../packages/slides/src/diagrams/index");
    const events = [
      { date: "55 BC", text: "Caesar's first expedition" },
      { date: "54 BC", text: "Caesar's second expedition" },
      { date: "AD 43", text: "Claudius's invasion" },
    ];
    const t = { kind: "timeline", alt: "x", events };
    expect(mendSpec({ ...t, period: { from: -55, to: 43, label: "55 BC to AD 43" } })).toEqual({
      ...t,
      period: { from: 1, to: 3, label: "55 BC to AD 43" },
    });
    expect(mendSpec({ ...t, period: { from: 1, to: 3 } })).toEqual(t);
    expect(mendSpec({ ...t, period: { from: -100, to: 43, label: "x" } })).toEqual(t);
  });
});

describe("round 6: grid cells hold their own entries", () => {
  test("an area model's labels sit in their cells, with no leaders", async () => {
    const { drawDiagram } = await import("../../packages/slides/src/diagrams/draw");
    const rect = (x: number, y: number) => ({
      type: "rect",
      x,
      y,
      w: 32,
      h: 22,
      fill: "surface",
      rounded: false,
    });
    const spec = {
      kind: "labelled-diagram",
      alt: "An area model grid.",
      canvas: "wide",
      shapes: [rect(30, 15), rect(62, 15), rect(30, 37), rect(62, 37)],
      labels: [
        { text: "x²", at: [46, 26], side: "top" },
        { text: "3x", at: [78, 26], side: "top" },
        { text: "2x", at: [46, 48], side: "top" },
        { text: "6", at: [78, 48], side: "top" },
      ],
    };
    const r = drawDiagram(spec, getTheme("studio", "ks4" as never), { x: 0, y: 0, w: 788, h: 300 });
    expect(r.ok).toBe(true);
    const svg = decodeURIComponent(
      String((r as { element?: { src?: string } }).element?.src ?? ""),
    );
    // A leader ends in a dot (a circle); the grid has none.
    expect(svg.match(/<circle/g) ?? []).toHaveLength(0);
  });
});
