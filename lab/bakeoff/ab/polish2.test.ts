// polish2 (D30): label clashes refit then drop one label (never the diagram); blank-render guard.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drawDiagram } from "../../../packages/slides/src/diagrams/draw";
import {
  clashPair,
  dropLabels,
  onLabelDrop,
  setDiagramPolish,
} from "../../../packages/slides/src/diagrams/polish";
import { atFullSize, layoutTemplate } from "../../../packages/slides/src/templates/index";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { slideWord } from "../render";
import { AB, AB_CONFIG, AB_REF, abFiles, pinFaults } from "./arms";

const RUNS = `${AB}/runs`;
afterEach(() => {
  setDiagramPolish(false);
  onLabelDrop(() => {});
});

describe("per-label clash fallback", () => {
  test("clash faults name their pair", () => {
    expect(clashPair('the labels "100" and "Gas volume (cm³)" touch')).toEqual([
      "100",
      "Gas volume (cm³)",
    ]);
    expect(clashPair('the labels "a" and "b" overlap')).toEqual(["a", "b"]);
    expect(clashPair('the label "a" is cut short')).toBeUndefined();
  });
  test("dropLabels takes the label and its leader, nothing else", () => {
    const svg =
      '<svg><line x1="1" y1="2" x2="10" y2="20"/><circle cx="10" cy="20" r="3"/><text x="0"><tspan x="0" y="0">Clamp</tspan></text>' +
      '<line x1="0" y1="0" x2="5" y2="5"/><circle cx="9" cy="9" r="3"/><text><tspan>Bung</tspan></text></svg>';
    const r = dropLabels(svg, ["Clamp"]);
    expect(r.dropped).toEqual(["Clamp"]);
    expect(r.svg).not.toContain("Clamp");
    expect(r.svg).not.toContain('x2="10"');
    expect(r.svg).toContain("Bung");
    expect(r.svg).toContain('x2="5"'); // not a leader of a dropped label: kept
  });

  // The 4 diagrams the polish runs lost to the label gate (polish2replay.ts), in their own layouts.
  const lost = [
    ["polish-1", "y11-chemistry-rates-of-reaction", 6],
    ["polish-1", "y8-french-my-family", 3],
    ["polish-2", "y11-chemistry-rates-of-reaction", 4],
    ["polish-2", "y11-chemistry-rates-of-reaction", 8],
  ] as const;
  const layout = (run: string, lesson: string, slide: number) => {
    const dir = `${RUNS}/${run}/T/${lesson}`;
    const brief = JSON.parse(readFileSync(`${dir}/brief.json`, "utf8"));
    const spec = readFileSync(`${dir}/diagrams.jsonl`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((x) => JSON.parse(x))
      .filter((d) => d.key === `${slide - 1}:diagram`)
      .pop()?.spec;
    const ws = JSON.parse(JSON.parse(readFileSync(`${dir}/main.json`, "utf8")).text).slides[
      slide - 3
    ];
    const input = {
      template: ws.template === "big-visual" ? "big-diagram" : "diagram-text",
      heading: String(ws.heading),
      ...(ws.lead ? { lead: String(ws.lead) } : {}),
      ...(Array.isArray(ws.points)
        ? { points: ws.points.map((p: unknown) => (typeof p === "string" ? p : JSON.stringify(p))) }
        : {}),
      figure: { diagram: spec },
    };
    return () =>
      withKeyStage(brief.keyStage, () =>
        atFullSize(() =>
          layoutTemplate(input as never, getTheme(brief.theme, brief.keyStage), brief.keyStage),
        ),
      ) as { diagram?: string[] };
  };
  test("lost under polish's whole-diagram gate, all 4 drawn under polish2, each drop logged", () => {
    const drops: string[] = [];
    onLabelDrop((e) => drops.push(e.label));
    for (const [run, lesson, slide] of lost) {
      const lay = layout(run, lesson, slide);
      setDiagramPolish(true, "diagram");
      expect(lay().diagram?.join(" ")).toMatch(/touch|overlap/);
      setDiagramPolish(true, "label");
      expect(lay().diagram).toBeUndefined();
    }
    expect(drops).toContain("100"); // the tick goes, the axis title stays
    expect(drops).not.toContain("Gas volume (cm³)");
  });
  test("switch off: base4's draw, no label dropped", () => {
    const drops: string[] = [];
    onLabelDrop((e) => drops.push(e.label));
    const spec = { kind: "cycle", alt: "s", steps: ["spring", "summer", "autumn", "winter"] };
    const t = getTheme("splash", "ks1" as never);
    const r = withKeyStage("ks1" as never, () =>
      drawDiagram(spec, t, { x: 0, y: 0, w: 560, h: 420 }),
    );
    expect(r.ok && r.droppedLabels).toBeFalsy();
    expect(drops).toEqual([]);
  });
});

describe("arm", () => {
  test("polish2 = polish's config plus polish2; same writer files; pinned", () => {
    const { polish2: _q, delta: _d, ...rest } = AB_CONFIG.polish2;
    const { delta: _e, ...pol } = AB_CONFIG.polish;
    expect(rest).toEqual(pol);
    expect(AB_REF.polish2?.ref).toBe("polish");
    for (const st of ["KS1", "KS2", "KS3-5"]) {
      const a = abFiles("polish2", st);
      const b = abFiles("polish", st);
      expect(readFileSync(a.system, "utf8")).toBe(readFileSync(b.system, "utf8"));
      expect(readFileSync(a.schema, "utf8")).toBe(readFileSync(b.schema, "utf8"));
    }
    expect(pinFaults("polish2")).toEqual([]);
  });
});

describe("blank render guard (D30, y1fix-1 slide 10)", () => {
  test("slideWord reads a slide's first words", () => {
    for (const [lesson, want] of [
      ["y5-maths-fractions-of-amounts", "Your turn: a"],
      ["y8-french-my-family", "Modèle : frères"],
    ]) {
      const l = JSON.parse(readFileSync(`${RUNS}/y1fix-1/T/${lesson}/lesson.json`, "utf8"));
      expect(slideWord(l.slides[9])).toBe(want);
    }
    expect(slideWord({ elements: [] })).toBeUndefined();
  });
});
