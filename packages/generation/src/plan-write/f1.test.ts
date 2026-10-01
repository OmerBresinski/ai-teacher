import { describe, expect, test } from "bun:test";
import type { PlanSlide } from "../prompts/plan-lesson";
import { writeSlidesPrompt } from "../prompts/write-slides";
import { checksToInsert } from "./check";
import { fitWithRewrite, fitWritten } from "./fit";

const row = (o: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  tests: [],
  teaches: [],
  purpose: "aim",
  parts: 3,
  form: "explain",
  layout: "default",
  imageBrief: null,
  figureBrief: null,
  ...o,
});
const FIXED = [
  row({ role: "title", form: "title" }),
  row({ role: "objectives", form: "objectives" }),
];

describe("F1 checks in code (checksToInsert)", () => {
  test("a short deck with no checks gets one after each objective the practise slide does not follow", () => {
    const plan = [
      ...FIXED,
      row({ objectives: [1], teaches: ["states"] }),
      row({ objectives: [2], teaches: ["changes"], form: "worked-example" }),
      row({ objectives: [3], teaches: ["diffusion"] }),
      row({
        role: "practise",
        form: "list",
        objectives: [1, 2, 3],
        tests: ["states", "changes", "diffusion"],
      }),
    ];
    const got = checksToInsert(plan);
    expect(got.map((g) => g.after)).toEqual([3, 4]);
    expect(got.map((g) => g.row.objectives)).toEqual([[1], [2]]);
    expect(got[0]?.row).toMatchObject({ role: "check", form: "check-set", tests: ["states"] });
  });

  test("a check, the hinge or the practise slide before the next teaching counts; teach slides are never taken", () => {
    const plan = [
      ...FIXED,
      row({ objectives: [1], teaches: ["a"] }),
      row({ role: "check", form: "check-set", objectives: [1], tests: ["a"] }),
      row({ objectives: [2], teaches: ["b"] }),
      row({ objectives: [2], teaches: ["c"] }),
      row({ role: "hinge", form: "hinge", objectives: [], tests: ["c"] }),
      row({ role: "practise", form: "list", objectives: [1, 2], tests: ["a", "b"] }),
    ];
    expect(checksToInsert(plan)).toEqual([]);
  });

  test("objectives taught by the same last slide share one check", () => {
    const plan = [
      ...FIXED,
      row({ objectives: [1, 2], teaches: ["a"] }),
      row({ objectives: [3], teaches: ["b"] }),
      row({ role: "practise", form: "list", objectives: [3], tests: ["b"] }),
    ];
    const got = checksToInsert(plan);
    expect(got).toHaveLength(1);
    expect(got[0]?.row.objectives).toEqual([1, 2]);
  });
});

describe("F1 fit (drawn diagram, heading first)", () => {
  // E1 y4 s4: the slot measure passed it; drawn beside its flow it ran onto the bar on 3 themes.
  const y4s4 = {
    heading: "Roman conquest faced resistance",
    body: [
      "Invasion: In AD 43, Roman soldiers landed in Britain and fought local rulers. Their army took control of more land as it defeated people who resisted.",
      "Resistance: In AD 60 or 61, Boudica led the Iceni and other Britons in a rebellion. Roman rule brought harsh treatment and loss of land, which helped cause the revolt.",
      "Extent: Roman soldiers defeated the rebellion, and the Romans ruled much of Britain. They never conquered all of present-day Scotland.",
    ],
    diagram: {
      kind: "flow",
      alt: "Roman invasion in AD 43 leads to expanding rule, challenged by a rebellion.",
      title: "Conquest faced a challenge",
      layout: "chain",
      steps: [
        { label: "AD 43: invasion", arrow: "conquest" },
        { label: "Expanding Roman rule", arrow: "resistance" },
        { label: "AD 60/61: rebellion" },
      ],
    },
  };

  test("a diagram slot is judged as drawn, so a body that overruns beside its drawing fails", () => {
    const fit = fitWritten("diagram-slot", "default", y4s4);
    expect(fit.ok).toBe(false);
    if (!fit.ok) {
      expect(fit.field).toBe("body");
      expect(fit.themes).toContain("chalk");
    }
  });

  test("a heading that still wraps after its re-write is written again; the body is not cut", async () => {
    const long = "Particle behaviour explains the different properties of every material";
    const asked: string[] = [];
    const fitted = await fitWithRewrite(
      "explain",
      "default",
      { heading: long, body: ["Solid: the particles touch.", "Gas: far apart."] },
      async (field) => {
        asked.push(field);
        return { heading: asked.length === 1 ? long : "Particles explain materials" };
      },
    );
    expect(asked).toEqual(["heading", "heading"]);
    expect(fitted.fit.ok).toBe(true);
    expect(fitted.out.body).toEqual(["Solid: the particles touch.", "Gas: far apart."]);
  });
});

describe("F1 writer: a check code added sees the slides it checks", () => {
  test("the taught slides are shown as written, after the target", () => {
    const table = [...FIXED, row({ teaches: ["a"] }), row({ role: "check", form: "check-set" })];
    const { user } = writeSlidesPrompt({
      topic: "t",
      audience: { yearGroup: "Year 7" } as never,
      objectives: ["o"],
      runningExample: "r",
      misconception: "m",
      table,
      slides: [{ number: 4, form: "check-set", layout: "default", contract: "questions" }],
      taught: [{ number: 3, written: { heading: "Gas spreads out", body: ["Gas: far apart."] } }],
    });
    expect(user).toContain("The slides that slide 4 checks, as written.");
    expect(user).toContain('Slide 3: {"heading":"Gas spreads out","body":["Gas: far apart."]}');
  });
});
