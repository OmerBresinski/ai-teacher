import { describe, expect, test } from "bun:test";
import { clipFields, clipReport, clipSignals } from "./clipped";

describe("clipped wording", () => {
  test("a joined fragment is flagged; a plain sentence is not", () => {
    expect(clipSignals("Four equal groups; take one.")).toEqual({
      joins: true,
      fragment: true,
      choppy: false,
    });
    expect(clipSignals("Count one of four equal groups")).toEqual({
      joins: false,
      fragment: false,
      choppy: false,
    });
    expect(clipSignals("Halves must be equal, not just two groups.").fragment).toBe(false);
  });

  test("two short sentences in a row are choppy; maths lines are not fragments", () => {
    expect(clipSignals("Half is six. Take one.").choppy).toBe(true);
    expect(clipSignals("Five and seven are unequal. Six and six are equal.").choppy).toBe(true);
    expect(clipSignals("Share 12 counters into two equal groups. One group is half.").choppy).toBe(
      false,
    );
    expect(clipSignals("16 ÷ 2 = 8; 8 ÷ 2 = 4")).toMatchObject({ joins: true, fragment: false });
  });

  test("fields get their kind, and at-cap joins the shown cap by slide and path", () => {
    const writer = {
      slides: [
        {
          template: "visual-text",
          lead: "Five and seven are unequal.",
          points: [{ kind: "watch-out", text: "Halves must be equal." }],
        },
        { template: "hinge", options: [{ text: "Four equal groups; take one." }] },
      ],
      close: {
        template: "exit-ticket",
        items: [{ question: "Share 20 crayons. How many each?", answer: "10", working: null }],
      },
    };
    const fills = [
      { lesson: "", slide: 4, template: "hinge", path: "options[0]", words: 5, cap: 5, body: true },
      {
        lesson: "",
        slide: 5,
        template: "exit-ticket",
        path: "items[0].question",
        words: 6,
        cap: 10,
        body: true,
      },
    ];
    const f = clipFields(writer, fills);
    expect(f.map((x) => x.kind)).toEqual([
      "myth lead",
      "other",
      "hinge option",
      "exit question",
      "answer",
    ]);
    expect(f.find((x) => x.kind === "hinge option")?.atCap).toBe(true);
    expect(f.find((x) => x.kind === "exit question")?.atCap).toBe(false);
    expect(f.find((x) => x.kind === "answer")?.atCap).toBeNull();
    const r = clipReport(f);
    expect(r.byKind["hinge option"]).toMatchObject({
      joinsPct: 100,
      fragmentPct: 100,
      atCapPct: 100,
    });
    expect(r.examples.map((e) => e.kind)).toContain("hinge option");
  });
});
