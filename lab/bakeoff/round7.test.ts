import { describe, expect, test } from "bun:test";
import {
  artefactQueries,
  planPicture,
} from "../../packages/generation/src/stages/picture-director";
import {
  areaModelTable,
  drawDiagram,
  oneStateCompare,
  particleTitle,
  shadedFractionLabels,
} from "../../packages/slides/src/diagrams/index";
import { getTheme, withKeyStage } from "../../packages/slides/src/themes";
import { armT, resolveAsks } from "./arm-t";
import { keepAsksHonest, pictureFallbackOk, pictureVeto } from "./harness";

const R6 =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF/round6/runs/T";

describe("round 7: ask / ask_without by construction", () => {
  const slide = {
    template: "visual-text",
    heading: "The Crystal Palace, 1851",
    lead: null,
    figure: {
      shows: "the Crystal Palace",
      must_see: [],
      subject: "named",
      ask: "What does this building tell us?",
      ask_without: "What did a giant hall of glass and iron show about Britain in 1851?",
    },
  };
  test("the ask line shows with the visual; the stand-alone line without it", () => {
    expect(resolveAsks(slide, () => true).lead).toBe("What does this building tell us?");
    const alone = resolveAsks(slide, () => false);
    expect(alone.lead).toContain("giant hall of glass");
    expect(JSON.stringify(alone)).not.toContain("ask_without");
  });
  test("words only (a visual that never came) use the stand-alone line", () => {
    const w = armT.asWords?.(slide) as Record<string, unknown>;
    expect(String(w.lead)).toContain("giant hall of glass");
    expect(JSON.stringify(w)).not.toContain("this building");
  });
  test("compare cards and sequences resolve per visual", () => {
    const c = resolveAsks(
      {
        template: "compare",
        heading: "Dry?",
        columns: [
          {
            label: "a",
            text: "runs off",
            picture: { shows: "x", ask: "Look here.", ask_without: "Water runs off plastic." },
          },
        ],
      },
      () => false,
    );
    expect((c.columns as { text: string }[])[0]?.text).toBe("runs off Water runs off plastic.");
    const s = resolveAsks(
      {
        template: "picture-sequence",
        heading: "Bean",
        sequence: [{ shows: "a" }, { shows: "b" }],
        ask: "What changes?",
        ask_without: "What changes as a bean grows?",
      },
      (k) => k !== "seq.1",
    );
    expect(s.lead).toBe("What changes as a bean grows?");
  });
  test("a null ask adds nothing", () => {
    const s = resolveAsks(
      {
        template: "visual-text",
        heading: "h",
        lead: "L",
        figure: { shows: "x", ask: null, ask_without: null },
      },
      () => false,
    );
    expect(s.lead).toBe("L");
  });
});

describe("round 7: diagrams re-lay out before they drop", () => {
  const th = getTheme("studio", "ks5");
  test("r6 y12 s4: the 8-step multi-store flow draws full width as a chain", async () => {
    const spec = (await Bun.file(`${R6}/y12-psychology-multi-store-model/diagrams.jsonl`).text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((d) => d.key === "3:diagram").spec;
    const d = withKeyStage("ks5", () => drawDiagram(spec, th, { x: 0, y: 0, w: 832, h: 220 }));
    expect(d.ok).toBe(true);
    expect((d as { spec?: { layout?: string } }).spec?.layout).toBe("chain");
  });
  test("r6 y10m: the area model is a table grid (factors as headers, products as cells)", async () => {
    const spec = JSON.parse(
      (await Bun.file(`${R6}/y10-maths-quadratics-factorising/diagrams.jsonl`).text()).split(
        "\n",
      )[0] as string,
    ).spec;
    expect(areaModelTable(spec)).toMatchObject({
      kind: "table",
      header: ["×", "x", "3"],
      rows: [
        ["x", "x²", "3x"],
        ["2", "2x", "6"],
      ],
    });
  });
  test("r6 y7 s5: a 'Liquid particles' title draws only the liquid", () => {
    const s = particleTitle({
      kind: "particles",
      title: "Liquid particles",
      alt: "a",
      show: "states",
      states: ["solid", "liquid"],
      captions: ["Solid", "Liquid"],
      notes: ["fixed rows", "close, irregular"],
      arrows: ["Movement"],
    });
    expect(s).toMatchObject({
      states: ["liquid"],
      captions: ["Liquid"],
      notes: ["close, irregular"],
    });
    expect((s as { arrows?: unknown }).arrows).toBeUndefined();
  });
  test("r6 y7 s4: a compare of identical panels is one state drawn once", () => {
    expect(
      oneStateCompare({
        kind: "particles",
        alt: "a",
        show: "compare",
        panels: [
          { state: "solid", count: 12 },
          { state: "solid", count: 12 },
        ],
        captions: ["Solid", "Solid"],
        arrows: ["Vibration"],
      }),
    ).toEqual({
      kind: "particles",
      alt: "a",
      show: "states",
      states: ["solid"],
      captions: ["Solid"],
    });
  });
  test("r6 y2 s3: the fraction label points at the shaded part, once", () => {
    const s = shadedFractionLabels({
      kind: "labelled-diagram",
      shapes: [
        { type: "rect", x: 20, y: 30, w: 30, h: 40, fill: "accent" },
        { type: "rect", x: 20, y: 30, w: 60, h: 40, fill: "none" },
      ],
      labels: [
        { text: "one half", at: [35, 50] },
        { text: "one half", at: [65, 50] },
      ],
    }) as { labels: { at: number[] }[] };
    expect(s.labels).toHaveLength(1);
    expect(s.labels[0]?.at).toEqual([35, 50]);
  });
});

describe("round 7: pictures", () => {
  test("round 8: no keyword veto; only an LLM verdict refuses a picture", () => {
    expect(pictureVeto({ request: "A fictional father", provider: "generated" })).toBeUndefined();
    expect(pictureVeto({ veto: "an AI portrait of a real-seeming person" })).toBe(
      "an AI portrait of a real-seeming person",
    );
    expect(pictureFallbackOk("labelled-diagram", "A solid model")).toBe(true);
    expect(pictureFallbackOk("equal-groups", "12 counters")).toBe(false);
    expect(pictureFallbackOk("table", "results")).toBe(false);
  });
  // Round 5 y4's picture requests (and round 6's resources request), replayed through the plan.
  const dir = (route: string, period: string | null, shows: string, named: string | null = null) =>
    planPicture(
      {
        route,
        named,
        period,
        count: null,
        pictures: [{ shows, mustShow: [], queries: ["q"], imagePrompt: "p" }],
      } as never,
      { text: shows, named: null },
    );
  test("replay r5/r6 y4: wheat and ore may be generated; the army landing may not", () => {
    const wheat = dir("pexels", null, "ripe wheat growing in a British field");
    expect(wheat.kind === "photo" && wheat.request.route).toBe("generic");
    const res = dir(
      "library-or-generate",
      "Britain, first century CE",
      "British resources that could bring wealth to Rome",
    );
    expect(res.kind === "photo" && res.request.route).toBe("generic");
    expect(res.kind === "photo" && res.request.depicts).toBeFalsy();
    const army = dir(
      "commons",
      "Roman invasion of Britain, 43 AD",
      "An army facing a sea crossing",
    );
    expect(army.kind === "photo" && army.request.depicts).toBe(true);
    expect(army.kind === "photo" && army.request.route).toBe("real");
    const claudius = dir(
      "commons",
      "1st-century Roman Empire",
      "A surviving portrait of Emperor Claudius",
      "person",
    );
    expect(claudius.kind === "photo" && claudius.request.route).toBe("real");
    const troops = dir(
      "library-or-generate",
      "Roman invasion of Britain, around 43 CE",
      "Roman troops occupying a captured British settlement",
    );
    expect(troops.kind === "photo" && troops.request.depicts).toBe(true);
  });
  test("artefact queries carry the period's names", () => {
    expect(
      artefactQueries("Roman troops occupying a settlement", "Roman invasion of Britain, AD 43"),
    ).toEqual([
      "Roman Britain coin",
      "Roman Britain map",
      "Roman Britain museum",
      "Roman Britain archaeological site",
    ]);
  });
});

describe("round 7: repairs keep asks honest", () => {
  test("r7 y12 s8: a graph redrawn as a table loses its graph ask", () => {
    const fig = (kind: string) => ({
      kind,
      shows: "s",
      ask: "Compare the curves.",
      ask_without: "Early words stay.",
    });
    const out = keepAsksHonest({ figure: fig("line-graph") }, { figure: fig("table") });
    expect((out.figure as { ask: string }).ask).toBe("Early words stay.");
    const same = keepAsksHonest({ figure: fig("table") }, { figure: fig("table") });
    expect((same.figure as { ask: string }).ask).toBe("Compare the curves.");
  });
});
