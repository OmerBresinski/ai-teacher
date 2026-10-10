import { describe, expect, test } from "bun:test";
import { layoutTemplate } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { replayRun } from "../writer/replay-fixture";
import { fixture, type J } from "./harness";

/* Group C (slot room): study figures squeezed into small slots (FIX-PLAN, UX ruling 194). */

const els = (s: { elements: unknown[] }) => s.elements as J[];
const diagram = (s: { elements: unknown[] }) => els(s).find((e) => e.name === "Diagram");

describe("REGISTER diagrams-05: study figures squeezed into small slots", () => {
  test("FIXED diagrams-05: a teaching slide's flow is laid across the slide, its points as key cards (y12 multi-store r2 s5, recorded)", async () => {
    const out = await replayRun("y12-psychology-multi-store-model-r2");
    const s = out.slides[4] as unknown as { elements: unknown[] };
    // Shipped: the flow sat in the 348x284 side slot beside three points.
    // FIXED: the drawing takes the slide's width; the three points are key cards under it.
    expect(Number(diagram(s)?.w)).toBe(788);
    expect(els(s).filter((e) => e.name === "Key card")).toHaveLength(3);
    // Shipped band under the words (pr440-paid-2 s8) was 97 points high; across the slide is taller.
    const shipped = fixture<{ elements: J[] }>("diagrams-05").elements.find(
      (e) => e.name === "Diagram",
    );
    expect(Number(shipped?.h)).toBeLessThan(100);
    expect(Number(diagram(s)?.h)).toBeGreaterThan(1.2 * Number(shipped?.h));
  });

  test("a full-width layout that would set the labels smaller keeps the slide diagram + text (type-floor check)", () => {
    // A 4-row table draws larger beside the words (zoomed to the side slot) than in the band left
    // over by the key cards, so it stays beside them.
    const table = {
      kind: "table",
      alt: "Readings",
      header: ["Test", "Time (s)", "Reading"],
      rows: [
        ["Gas", "10", "20 cm³"],
        ["Gas", "30", "60 cm³"],
        ["Mass", "0", "85.0 g"],
        ["Mass", "30", "84.4 g"],
      ],
    };
    const r = layoutTemplate(
      {
        template: "big-diagram",
        heading: "Mean rate: change divided by time",
        lead: "Mean rate = quantity changed ÷ time taken",
        points: [
          "Gas: (60 − 20) ÷ (30 − 10) = 2 cm³/s",
          "Mass lost: (85.0 − 84.4) ÷ 30 = 0.020 g/s",
          "Use the change, not just the final reading.",
        ],
        figure: { diagram: table },
      } as never,
      getTheme("studio"),
      "ks4",
    );
    expect(els(r.slide).some((e) => e.name === "Key card")).toBe(false);
    expect(Number(diagram(r.slide)?.w)).toBe(348);
  });
});
