import { describe, expect, test } from "bun:test";
import { drawDiagram, parseDiagram } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { type DrawerCall, drawWriterDiagram, noHeadingTitle } from "./diagrams";
import { slideHidesAnswer, slideRole } from "./role";

/*
 * TEACH-247 part q: diagrams lost or wrongly flagged in a production Y6 heart lesson (10 Oct).
 * Shapes from the worker log: the drawer drew slides 3, 4 and 7 (`diagram-done via:"drawer"
 * ok:true`), then the layout refused the same drawings with "the spec does not parse"; slide 7,
 * a worked example, was read as a question and its library model fell back.
 */
const studio = getTheme("studio");
const ZONE = { x: 0, y: 0, w: 860, h: 360 };
const HEADING = "How blood travels round the body";
/** A drawer answer whose title repeats the slide's heading. */
const drawn = {
  kind: "flow",
  alt: "Blood goes from the heart to the body and back to the heart.",
  title: HEADING,
  layout: "cycle",
  steps: [{ label: "Heart" }, { label: "Body" }, { label: "Back to the heart" }],
};

describe("a drawing whose title repeats the heading still draws", () => {
  test("noHeadingTitle drops the title instead of setting it to null", () => {
    const s = noHeadingTitle(drawn, `${HEADING}\nThe heart pumps blood.`) as Record<
      string,
      unknown
    >;
    expect("title" in s).toBe(false);
    expect(parseDiagram(s)).toBeDefined();
  });

  test("the drawer's spec, as the stage stores it, is one the layout can draw", async () => {
    const callDrawer: DrawerCall = async () => ({ out: drawn, usd: 0, ms: 0 }) as never;
    const r = await drawWriterDiagram(
      {
        key: "diagram",
        kind: "flow",
        shows: "Blood going round the body",
        labels: [],
        words: `${HEADING}\nThe heart pumps blood.`,
        yearGroup: "Year 6",
        stage: "ks2",
        slot: { placement: "across the slide", w: 860, h: 360, name: "full" },
        question: false,
      } as never,
      { callDrawer, drawerSystem: "", theme: studio },
    );
    expect(r.via).toBe("drawer");
    const d = drawDiagram(r.spec, studio, ZONE);
    expect(d.ok ? "drawn" : d.reasons).toBe("drawn");
  });
});

describe("a worked example is never read as a question", () => {
  const worked = {
    template: "big-visual",
    heading: "Worked example: supplying a leg",
    lead: "Which way does the blood go next? Follow it: lungs → heart → leg tissues → heart → lungs.",
    figure: { kind: "model", shows: "The double loop" },
  };
  test("a visual slide headed as a worked example is worked and hides nothing", () => {
    expect(slideRole(worked, { index: 6 })).toBe("worked");
    expect(slideHidesAnswer(worked)).toBe(false);
  });
  test("an asking visual slide with any other heading still hides its answer", () => {
    expect(slideHidesAnswer({ ...worked, heading: "Supplying a leg" })).toBe(true);
    expect(slideHidesAnswer({ ...worked, heading: "Your turn: supplying an arm" })).toBe(true);
  });
});
