import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { diagramFaults, fittedDiagramElement, parseDiagram, withLongLabels } from "./index";

/**
 * lab/t3: the six drawings T3 lost on label length (ABLATE T3 + T3S, 5 Oct 2026), as written.
 * Each failed the renderer's parse by a few characters; none is redrawn as a photo when it fits.
 */
const alt = "a drawing";
const LOST = {
  particlesNotes: {
    kind: "particles",
    alt,
    title: "From solid to liquid to gas",
    show: "states",
    states: ["solid", "liquid", "gas"],
    notes: [
      "Close, regular; vibrate in place",
      "Close, irregular; move past",
      "Far apart; move freely",
    ],
    arrows: ["Melting", "Boiling"],
  },
  particlesNotes2: {
    kind: "particles",
    alt,
    title: "Particle arrangement and movement",
    show: "states",
    states: ["solid", "liquid", "gas"],
    notes: [
      "Close, regular; vibrate in place",
      "Close, irregular; move past each other",
      "Far apart; move randomly",
    ],
  },
  flowLast: {
    kind: "flow",
    alt,
    title: "The crisis deepens",
    layout: "chain",
    steps: [
      { label: "Passive resistance in Ruhr", arrow: "reduces" },
      { label: "Production and tax income", arrow: "but" },
      { label: "Government still pays workers", arrow: "funded by" },
      { label: "More money printing", arrow: "helps drive" },
      { label: "Rapid price rises; mark loses value" },
    ],
  },
  flowTwo: {
    kind: "flow",
    alt,
    title: "The crisis worsens",
    layout: "chain",
    steps: [
      { label: "Passive resistance reduces production", arrow: "while" },
      { label: "Government pays resisting workers", arrow: "funded by" },
      { label: "More money printing", arrow: "helps cause" },
      { label: "Mark loses value; prices soar" },
    ],
  },
  timelineText: {
    kind: "timeline",
    alt,
    title: "Immediate stabilisation, 1923",
    events: [
      { date: "September 1923", text: "Passive resistance ends" },
      { date: "November 1923", text: "Rentenmark introduced with limited issuance" },
      { date: "Late November 1923", text: "Currency stabilises; confidence improves" },
    ],
  },
  timelineDate: {
    kind: "timeline",
    alt,
    title: "Pressure on Germany",
    events: [
      { date: "1921", text: "Reparations total set" },
      { date: "January 1923", text: "French and Belgian troops occupy Ruhr" },
      { date: "January 1923 onwards", text: "Government supports passive resistance" },
    ],
  },
} as const;

/** T3's picture zone on the photo form (split layout, the right half of a 1280×720 slide). */
const ZONE = { x: 664, y: 120, w: 560, h: 520 };
const theme = THEMES[0] as (typeof THEMES)[number];

describe("long diagram labels (lab/t3)", () => {
  test("the strict parse is unchanged outside a long-labels scope", () => {
    for (const spec of Object.values(LOST)) expect(parseDiagram(spec)).toBeUndefined();
  });

  test("a spec that already parses draws as before, unstretched", () => {
    const spec = {
      kind: "flow",
      alt,
      title: "Short",
      steps: [{ label: "One", arrow: "then" }, { label: "Two", arrow: "then" }, { label: "Three" }],
    };
    const r = fittedDiagramElement(spec, theme, ZONE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stretched).toBe(false);
  });

  test.each(Object.entries(LOST))("%s: drawn whole, wrapped or shrunk, never cut", (_, spec) => {
    const r = fittedDiagramElement(spec, theme, ZONE);
    expect(r.ok ? "" : r.reasons.join("; ")).toBe("");
    if (!r.ok) return;
    expect(r.stretched).toBe(true);
    expect(r.element.type).toBe("image");
    // Every word the writer wrote is drawn: no label is cut, runs off or overlaps, on any theme.
    for (const t of THEMES)
      expect(
        withLongLabels(() => diagramFaults(spec, t, { w: ZONE.w, h: ZONE.h, fs: r.fs })),
      ).toEqual([]);
  });

  test("a label past the stretch is still rejected, with the field named", () => {
    const spec = {
      ...LOST.timelineText,
      events: [
        { date: "1923", text: "x".repeat(70) },
        { date: "1924", text: "Dawes" },
        { date: "1929", text: "Young" },
      ],
    };
    const r = fittedDiagramElement(spec, theme, ZONE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toContain("events.0.text");
  });

  test("a spec wrong in shape (not length) is rejected as before", () => {
    const r = fittedDiagramElement(
      { kind: "flow", alt, steps: [{ label: "only one" }] },
      theme,
      ZONE,
    );
    expect(r.ok).toBe(false);
  });
});
