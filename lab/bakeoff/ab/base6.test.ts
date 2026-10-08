// base6 (8 Oct, rootcause/base5-loss.txt NEXT CANDIDATE): polish's code title subtitle and snug nodes,
// split out of the one polish switch. Every existing arm keeps its switches and draws byte for byte.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drawDiagram } from "../../../packages/slides/src/diagrams/draw";
import { parseDiagram, renderDiagram } from "../../../packages/slides/src/diagrams/index";
import {
  diagramPolish,
  labelGate,
  polishGapGate,
  polishNodes,
  polishStrips,
  setDiagramParts,
  setDiagramPolish,
  withDiagramPolish,
} from "../../../packages/slides/src/diagrams/polish";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import {
  AB,
  AB_ARMS,
  AB_CONFIG,
  AB_REF,
  abPolish,
  abPolish2,
  abSnugNodes,
  abTitleSub,
  setAbCodeArm,
} from "./arms";

const RUNS = `${AB}/runs`;
const t = getTheme("splash", "ks1" as never);
const cycle = {
  kind: "cycle",
  alt: "The seasons",
  steps: ["spring", "summer", "autumn", "winter"],
};
const strips = {
  kind: "strips",
  alt: "Day length",
  units: 24,
  unit: "hours",
  key: { light: "daylight", dark: "dark" },
  rows: [
    { label: "summer", light: 16 },
    { label: "winter", light: 8 },
  ],
};
const ks1 = <T>(f: () => T) => withKeyStage("ks1" as never, f);
const s11 = () =>
  readFileSync(`${RUNS}/nz-uk/T/y1-science-seasons-uk/diagrams.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((d) => d.key === "10:diagram").spec;
const rect = { x: 0, y: 0, w: 320, h: 198 };

afterEach(() => {
  setDiagramPolish(false);
  setAbCodeArm(undefined);
});

describe("arm switches", () => {
  test("base6 = base4 + titleSub + snugNodes, nothing else", () => {
    const { titleSub, snugNodes, delta, ...rest } = AB_CONFIG.base6;
    const { delta: _d, ...b4 } = AB_CONFIG.base4;
    expect(titleSub && snugNodes).toBe(true);
    expect(rest).toEqual(b4);
    expect(AB_REF.base6?.ref).toBe("base4");
  });
  test("base6sync = base6's code + figureSync; no other arm has figureSync", () => {
    const { delta: _a, figureSync, ...s } = AB_CONFIG.base6sync;
    const { delta: _b, ...b6 } = AB_CONFIG.base6;
    expect(s).toEqual(b6);
    expect(figureSync).toBe(true);
    for (const a of AB_ARMS) expect(Boolean(AB_CONFIG[a].figureSync)).toBe(a === "base6sync");
  });
  test("every other arm: titleSub = polish, snugNodes off, polish and polish2 unchanged", () => {
    for (const a of AB_ARMS) {
      setAbCodeArm(a);
      if (a === "base6" || a === "base6sync") {
        expect([abTitleSub(), abSnugNodes(), abPolish(), abPolish2()]).toEqual([
          true,
          true,
          false,
          false,
        ]);
        continue;
      }
      expect(AB_CONFIG[a].titleSub).toBeUndefined();
      expect(AB_CONFIG[a].snugNodes).toBeUndefined();
      expect(abTitleSub()).toBe(Boolean(AB_CONFIG[a].polish));
      expect(abSnugNodes()).toBe(false);
    }
  });
});

describe("renderer parts", () => {
  test("setDiagramPolish sets all three parts, as the one switch did", () => {
    setDiagramPolish(true);
    expect([diagramPolish(), polishNodes(), polishGapGate(), polishStrips()]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    setDiagramPolish(true, "label");
    expect([polishNodes(), polishGapGate(), polishStrips(), labelGate()]).toEqual([
      true,
      true,
      true,
      "label",
    ]);
    setDiagramPolish(false);
    expect([diagramPolish(), polishNodes(), polishGapGate(), polishStrips()]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
  test("polish via setDiagramPolish draws byte for byte as withDiagramPolish(true)", () => {
    const w = ks1(() => withDiagramPolish(true, () => renderDiagram(cycle, t, { w: 560, h: 420 })));
    setDiagramPolish(true);
    expect(ks1(() => renderDiagram(cycle, t, { w: 560, h: 420 }))).toBe(w);
    expect(ks1(() => drawDiagram(s11(), t, rect)).ok).toBe(false);
    expect(parseDiagram(strips)).toBeDefined();
  });
  test("base6 parts: polish's nodes, base4's gate (no gap fault), no strips", () => {
    const base4 = ks1(() => renderDiagram(cycle, t, { w: 560, h: 420 }));
    const polish = ks1(() =>
      withDiagramPolish(true, () => renderDiagram(cycle, t, { w: 560, h: 420 })),
    );
    const base4S11 = ks1(() => drawDiagram(s11(), t, rect));
    setDiagramParts({ nodes: true });
    expect([polishNodes(), polishGapGate(), polishStrips(), labelGate()]).toEqual([
      true,
      false,
      false,
      "diagram",
    ]);
    expect(ks1(() => renderDiagram(cycle, t, { w: 560, h: 420 }))).toBe(polish);
    expect(polish).not.toBe(base4);
    // uk-seasons s11: touching labels refuse under polish's gap gate; base6 draws as base4 does.
    const s = ks1(() => drawDiagram(s11(), t, rect));
    expect(s.ok).toBe(true);
    expect(s.ok && base4S11.ok && s.rung).toBe(base4S11.ok && base4S11.rung);
    expect(parseDiagram(strips)).toBeUndefined();
  });
  test("withDiagramPolish restores the parts it found", () => {
    setDiagramParts({ nodes: true });
    withDiagramPolish(true, () => expect(polishGapGate()).toBe(true));
    withDiagramPolish(false, () => expect(polishNodes()).toBe(false));
    expect([polishNodes(), polishGapGate(), polishStrips()]).toEqual([true, false, false]);
  });
});
