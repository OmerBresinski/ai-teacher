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
    const r = await drawWriterDiagram(drawerAsk(false), {
      callDrawer,
      drawerSystem: "",
      theme: studio,
    });
    expect(r.via).toBe("drawer");
    const d = drawDiagram(r.spec, studio, ZONE);
    expect(d.ok ? "drawn" : d.reasons).toBe("drawn");
  });
});

const drawerAsk = (question: boolean, kind = "flow") =>
  ({
    key: "diagram",
    kind,
    shows: "Blood going round the body",
    labels: [],
    words: `${HEADING}\nThe heart pumps blood.`,
    yearGroup: "Year 6",
    stage: "ks2",
    slot: { placement: "across the slide", w: 860, h: 360, name: "full" },
    question,
  }) as never;

describe("ok covers the spec as stored", () => {
  test("a question slide's answer-free drawing is the one stored, and it draws", async () => {
    const bars = {
      kind: "bar-model",
      alt: "Twelve shared into three equal parts.",
      title: HEADING,
      bars: [{ parts: [{ value: 4 }, { value: 4 }, { value: 4 }], total: "12" }],
      combined: "12",
    };
    const callDrawer: DrawerCall = async () => ({ out: bars, usd: 0, ms: 0 }) as never;
    const r = await drawWriterDiagram(drawerAsk(true, "bar-model"), {
      callDrawer,
      drawerSystem: "",
      theme: studio,
    });
    const s = r.spec as { title?: unknown; combined?: unknown; bars: { total?: unknown }[] };
    expect([s.title, s.combined, s.bars[0]?.total]).toEqual([undefined, undefined, undefined]);
    const d = drawDiagram(r.spec, studio, ZONE);
    expect(d.ok ? "drawn" : d.reasons).toBe("drawn");
  });
});

describe("a visual slide asks only when all its words ask", () => {
  const leg = {
    template: "big-visual",
    heading: "Worked example: supplying a leg",
    lead: "Which way does the blood go next?",
    points: [
      "The heart pumps oxygen-rich blood to the leg.",
      "The leg tissues take the oxygen and food.",
      "Oxygen-poor blood returns to the heart, then the lungs.",
    ],
  };
  test("a teaching slide with a rhetorical hook teaches and hides nothing", () => {
    expect(slideRole(leg, { index: 6 })).toBe("teach");
    expect(slideHidesAnswer(leg)).toBe(false);
    const hook = { ...leg, heading: "Why is the sky blue?", lead: "Ever wondered why?" };
    expect(slideHidesAnswer(hook)).toBe(false);
  });
  test('"Example: Your turn" with only an ask is a task, whatever its heading', () => {
    const turn = {
      template: "big-visual",
      heading: "Example: Your turn",
      lead: "Find one half of 10.",
    };
    expect(slideRole(turn, { index: 6 })).toBe("task");
    expect(slideHidesAnswer(turn)).toBe(true);
  });
  test("a real hinge hides its answer", () => {
    const hinge = {
      template: "hinge",
      heading: "Which vessel carries blood away?",
      stem: "Pick one",
    };
    expect(slideRole(hinge, { index: 6 })).toBe("hinge");
    expect(slideHidesAnswer(hinge)).toBe(true);
  });
});
