import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { judgeImageUrl } from "../../../packages/generation/src/stages/illustrate";
import { drawDiagram } from "../../../packages/slides/src/diagrams/draw";
import {
  diagramFaults,
  parseDiagram,
  renderDiagram,
} from "../../../packages/slides/src/diagrams/index";
import {
  contrastRatio,
  labelGapFaults,
  NODE_EDGE_CONTRAST,
  NODE_TEXT_CONTRAST,
  nodeFill,
  STRIPS_LIMITS,
  StripsSchema,
  stripColours,
  withDiagramPolish,
} from "../../../packages/slides/src/diagrams/polish";
import { context } from "../../../packages/slides/src/diagrams/svg";
import { getTheme, THEMES, withKeyStage } from "../../../packages/slides/src/themes";
import { picTiming } from "../services";
import { AB, AB_ARMS, AB_CONFIG, AB_REF } from "./arms";
import {
  gateVerdict,
  imageTokens,
  isPromptLead,
  pixelStats,
  polishTitleLead,
  scaledTo,
} from "./polish";

const RUNS = `${AB}/runs`;
const outputs = [...new Bun.Glob("b3-r2-*/T/*/main.json").scanSync(RUNS)].sort().map((f) => ({
  f,
  out: JSON.parse(JSON.parse(readFileSync(`${RUNS}/${f}`, "utf8")).text),
  brief: JSON.parse(readFileSync(`${RUNS}/${f.replace("main.json", "brief.json")}`, "utf8")),
}));

describe("polish 1: title subtitle", () => {
  test("replayed on base4's 24 writer outputs: 24 recall leads before, 0 after", () => {
    expect(outputs.length).toBe(24);
    const before = outputs.filter((o) => isPromptLead(o.out.title.lead)).length;
    const after = outputs.map((o) => polishTitleLead(o.brief));
    expect(before).toBe(24);
    expect(after.filter(isPromptLead).length).toBe(0);
    expect(after.every((l, i) => !outputs[i]?.out.flow[0].does.includes(l))).toBe(true);
    expect(after[0]).toBe("Year 1 Science");
  });
});

describe("polish 2: flow and cycle nodes", () => {
  const cycle = {
    kind: "cycle",
    alt: "The seasons",
    steps: ["spring", "summer", "autumn", "winter"],
  };
  const t = getTheme("splash", "ks1" as never);
  const widths = (svg: string) =>
    [...svg.matchAll(/<rect [^>]*\swidth="([\d.]+)"/g)].map((m) => Number(m[1]));
  test("off: byte-identical to the default draw; on: boxes narrower, no outline", () => {
    const def = withKeyStage("ks1" as never, () => renderDiagram(cycle, t, { w: 560, h: 420 }));
    const off = withDiagramPolish(false, () =>
      withKeyStage("ks1" as never, () => renderDiagram(cycle, t, { w: 560, h: 420 })),
    );
    const on = withDiagramPolish(true, () =>
      withKeyStage("ks1" as never, () => renderDiagram(cycle, t, { w: 560, h: 420 })),
    );
    expect(off).toBe(def);
    expect(Math.max(...widths(on as string))).toBeLessThan(Math.max(...widths(off as string)));
    expect(on).not.toContain('stroke="#0A5CA2"');
  });
  test("node fill stands off ground, panel and wash, and holds ink, on every theme", () => {
    for (const th of THEMES) {
      const x = context(th, 560, 420);
      const f = nodeFill(x.c, !!x.dark);
      for (const g of [x.c.bg, x.c.surface, x.c.tint])
        expect(contrastRatio(f, g)).toBeGreaterThanOrEqual(NODE_EDGE_CONTRAST - 0.01);
      expect(contrastRatio(x.c.ink, f)).toBeGreaterThanOrEqual(NODE_TEXT_CONTRAST);
    }
  });
});

describe("polish 3: label gap gate and strips", () => {
  const t = getTheme("splash", "ks1" as never);
  test("touching labels are a fault; overlapping 15% was the old bar", () => {
    const a = { x0: 0, x1: 100, y0: 0, y1: 30, text: "daylight", cut: false, fs: 28 };
    const b = { x0: 102, x1: 150, y0: 0, y1: 30, text: "dark", cut: false, fs: 28 };
    expect(labelGapFaults([a, b])).toEqual(['the labels "daylight" and "dark" touch']);
    expect(labelGapFaults([a, { ...b, x0: 120, x1: 170 }])).toEqual([]);
  });
  test("uk-seasons slide 11 at 320 wide: draws under base4, refits then refuses under polish", () => {
    const s11 = readFileSync(`${RUNS}/nz-uk/T/y1-science-seasons-uk/diagrams.jsonl`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((d) => d.key === "10:diagram").spec;
    const rect = { x: 0, y: 0, w: 320, h: 198 };
    const run = (p: boolean) =>
      withDiagramPolish(p, () => withKeyStage("ks1" as never, () => drawDiagram(s11, t, rect)));
    expect(run(false).ok).toBe(true);
    const on = run(true);
    expect(on.ok).toBe(false);
    if (!on.ok) expect(on.reasons.join(" ")).toContain("touch");
  });
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
  test("strips parse only under polish; caps hold", () => {
    expect(parseDiagram(strips)).toBeUndefined();
    expect(withDiagramPolish(true, () => parseDiagram(strips))).toBeDefined();
    expect(StripsSchema.safeParse({ ...strips, rows: strips.rows.slice(0, 1) }).success).toBe(
      false,
    );
    expect(StripsSchema.safeParse({ ...strips, units: STRIPS_LIMITS.units.max + 1 }).success).toBe(
      false,
    );
    expect(
      StripsSchema.safeParse({
        ...strips,
        rows: [
          { label: "a", light: 25 },
          { label: "b", light: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      StripsSchema.safeParse({
        ...strips,
        rows: [
          { label: "a", light: 10, start: 20 },
          { label: "b", light: 1 },
        ],
      }).success,
    ).toBe(false);
  });
  test("strips draw with no fault on light and night themes; day, night and marks contrast", () => {
    for (const th of ["splash", "studio", "night-lab"]) {
      const theme = getTheme(th, "ks1" as never);
      // The layouts' own call (refit from the zone's size down): it draws, at a readable size.
      const d = withDiagramPolish(true, () =>
        withKeyStage("ks1" as never, () =>
          drawDiagram(strips, theme, { x: 0, y: 0, w: 560, h: 420 }),
        ),
      );
      expect(d.ok ? d.rung : d.reasons).toBe(0);
      const svg = withDiagramPolish(true, () =>
        withKeyStage("ks1" as never, () => renderDiagram(strips, theme, { w: 560, h: 420 })),
      );
      expect(svg).toContain("summer");
      expect(svg).toContain("16 hours");
    }
    for (const th of THEMES) {
      const x = context(th, 560, 420);
      const c = stripColours(x.c, !!x.dark, th.id);
      expect(contrastRatio(c.day, c.night)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.sun, c.day)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.moon, c.night)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("polish 4: judge input and photo gate", () => {
  test("pexels candidates are asked at 768 on the long side", () => {
    const c = {
      id: "1",
      width: 4000,
      height: 3000,
      alt: "",
      src: {
        large: "https://images.pexels.com/photos/1/p.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
        medium: "",
        tiny: "t",
      },
    };
    expect(judgeImageUrl(c as never, 768)).toBe(
      "https://images.pexels.com/photos/1/p.jpeg?auto=compress&cs=tinysrgb&w=768",
    );
    expect(judgeImageUrl({ ...c, width: 3000, height: 4000 } as never, 768)).toContain("h=768");
  });
  test("token formula: 280x200 thumbnail 77, 768x576 520", () => {
    expect(imageTokens(280, 200)).toBe(77);
    expect(imageTokens(...(scaledTo(4000, 3000, 768) as [number, number]))).toBe(520);
  });
  const img = (f: (x: number, y: number) => [number, number, number]) => {
    const w = 64,
      h = 48,
      data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = f(x, y);
        const i = (y * w + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    return { width: w, height: h, data };
  };
  test("a grey misty frame is refused, a colourful one passes", () => {
    const misty = pixelStats(img((x) => [150 + (x % 8), 155 + (x % 8), 160 + (x % 8)]));
    const bright = pixelStats(
      img((x, y) => (x < 32 ? [30, 140, 40] : y < 24 ? [90, 160, 230] : [230, 200, 40])),
    );
    expect(gateVerdict(misty).pass).toBe(false);
    expect(gateVerdict(bright).pass).toBe(true);
    expect(misty.haze).toBeGreaterThan(bright.haze);
  });
});

describe("polish 5: picture stage timings", () => {
  const ledger = { committed: 0.21, capUsd: 0.25 };
  test("a slot whose hold never came says so", () => {
    const r = picTiming(
      { key: "0:picture", t0: Date.now() - 60_200, stages: {} },
      false,
      undefined,
      ledger,
    );
    expect(r.cause).toMatch(/^cap hold refused after 6\d{4} ms/);
  });
  test("a stage timeout is the cause; a found picture has none", () => {
    const rec = {
      key: "3:col.0",
      t0: Date.now(),
      holdMs: 3,
      stages: { search: { n: 1, ms: 40000, errs: ["timeout: TimeoutError"] } },
    };
    expect(picTiming(rec, false, undefined, ledger).cause).toBe("search: timeout: TimeoutError");
    expect(picTiming(rec, true, undefined, ledger).cause).toBeUndefined();
    const ac = new AbortController();
    ac.abort("slide took no early job");
    expect(picTiming({ ...rec, stages: {} }, false, ac.signal, ledger).cause).toContain("aborted");
  });
});

test("arm: polish is base4 plus the polish flag", () => {
  expect(AB_ARMS).toContain("polish");
  expect(AB_REF.polish?.ref).toBe("base4");
  const { polish: _p, delta: _d, ...rest } = AB_CONFIG.polish;
  const { delta: _b, ...base } = AB_CONFIG.base4;
  expect(rest).toEqual(base);
});
