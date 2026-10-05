import { describe, expect, it } from "bun:test";
import fixtures from "./fixtures/layout-fix-big-diagrams.json";
import { t3DiagramSpec } from "./simple";

/* lab/cand: the y1 smoke deck drew "From chick to hen" under the heading "A chick grows". */
const slide = (f: (typeof fixtures)[number]) => ({
  heading: f.heading,
  body: f.content,
  items: [],
});

describe("t3DiagramSpec", () => {
  it("drops the y1 title that echoes the heading and the flow's own labels", () => {
    const y1 = fixtures.find((f) => f.heading === "A chick grows");
    if (!y1) throw new Error("no y1 fixture");
    const spec = t3DiagramSpec(y1.picture, slide(y1)) as { title?: string; steps: unknown[] };
    expect(spec.title).toBeUndefined();
    expect(spec.steps).toEqual(y1.picture.steps as unknown[]);
  });

  it("keeps a title that names what the slide does not (y7's 'spacing')", () => {
    const y7 = fixtures.find((f) => f.heading.includes("Particles"));
    if (!y7) throw new Error("no y7 fixture");
    const spec = t3DiagramSpec(y7.picture, slide(y7)) as { title?: string };
    expect(spec.title).toBe("Arrangement, spacing and movement");
  });
});
