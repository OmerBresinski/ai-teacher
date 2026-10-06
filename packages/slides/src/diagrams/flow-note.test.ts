import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { renderDiagram } from "./index";

/*
 * CANDIDATE y9 s4: an arrow's note between two boxes in a row ("Government urges") ran wider than
 * the gap and touched both boxes. A note is wrapped to its gap.
 */
// dd-diagrams: six steps no longer squeeze into 560 x 300 (they report they cannot draw there), so
// the note is checked in the full-width zone.
const flow = {
  kind: "flow",
  alt: "How the occupation led to hyperinflation",
  steps: [
    { label: "Ruhr occupied", arrow: "Workers strike" },
    { label: "Passive resistance", arrow: "Output falls" },
    { label: "Less production and tax", arrow: "Costs continue" },
    { label: "Government pays strikers", arrow: "Financed by" },
    { label: "Printing more money", arrow: "Prices spiral" },
    { label: "Hyperinflation" },
  ],
};

describe("a flow's arrow note stays inside its gap", () => {
  test("a note wider than its gap wraps onto two lines", () => {
    const svg = renderDiagram(flow, getTheme("studio"), { w: 844, h: 380 }) ?? "";
    const at = svg.indexOf("Workers");
    expect(at).toBeGreaterThan(-1);
    // Its own line: the next words are not on the same text run.
    expect(svg).not.toContain("Workers strike");
  });
});
