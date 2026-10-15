import { describe, expect, test } from "bun:test";
import { atKeyStage, getTheme, THEMES, typeScale } from "../themes";
import {
  barPanelFrames,
  barPanelGuard,
  barPanelMinWidth,
  barPanelSpec,
  EQUATION_MAX_A,
  PANEL_MIN,
} from "./bar-model";
import { buildCount, svgAtBuild, withBuilds } from "./builds";
import {
  diagramElement,
  diagramFaults,
  parseDiagram,
  renderDiagram,
  shownLabelSize,
} from "./index";

/**
 * TEACH-75 part y (NOTES worked v12, W-d2/W-d3): a worked example's bar-model panel draws at
 * panel size, finds a percentage by tenths with one brace per build, and draws ax + b = c as an
 * equation bar whose x cells are not to scale. Numbers the panel cannot draw exactly fail the
 * guard, so the caller shows the working as text only.
 */
const Y6 = { model: "percent", amount: 80, percent: 35 } as const;
const Y8 = { model: "equation", a: 3, b: 5, c: 20 } as const;
const spec = (p: Parameters<typeof barPanelSpec>[0]) => {
  const r = barPanelSpec(p, "bar model");
  if (!r.ok) throw new Error(r.reason);
  return r.spec;
};
const BOXES = [
  { x: 640, y: 50, w: 320, h: 200 },
  { x: 640, y: 50, w: 320, h: 440 },
  { x: 480, y: 100, w: 480, h: 300 },
];
const svgOf = (s: unknown, ks: string, box = BOXES[1] as (typeof BOXES)[number], built = true) => {
  const t = atKeyStage(getTheme("paper"), ks);
  const el = built ? withBuilds(() => diagramElement(s, t, box)) : diagramElement(s, t, box);
  return decodeURIComponent((el?.src ?? "").replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
};
/** Curly braces drawn (a brace is the only quadratic path; the whole's bracket is straight). */
const braces = (svg: string) => (svg.match(/<path d="M[^"]* Q/g) ?? []).length;
/** The markup Present shows at build k: every frame layer and later build that is hidden, dropped. */
function shownAt(svg: string, k: number): string {
  let out = svg.replace(/<style>[\s\S]*?<\/style>/g, "");
  out = out.replace(/<g data-f="(\d+)">([\s\S]*?)<\/g>(?=<g data-[fs]=|<\/g>)/g, (_, f, body) =>
    Number(f) === k ? body : "",
  );
  out = out.replace(/<g data-s="(\d+)">([\s\S]*)<\/g><\/g>/, (_, s, body) =>
    Number(s) <= k ? `${body}</g>` : "</g>",
  );
  return out;
}

describe("the panel's builds", () => {
  test.each([
    [35, ["unit", "tens", "half", "total"]],
    [30, ["unit", "tens"]],
    [10, ["unit"]],
    [15, ["unit", "half", "total"]],
    [5, ["half"]],
    [100, ["unit", "tens"]],
  ] as const)("%i%% by tenths builds %p", (percent, keys) => {
    expect(barPanelFrames({ model: "percent", amount: 80, percent })).toEqual([...keys]);
  });
  test("an equation bar builds the whole, take, share, check", () => {
    expect(barPanelFrames(Y8)).toEqual(["whole", "take", "share", "check"]);
  });
});

describe("tenths: one brace per build (W-d2)", () => {
  for (const ks of ["ks2", "ks3"])
    test(`35% of 80 at ${ks}: a build per step, each showing one brace`, () => {
      const svg = svgOf(spec(Y6), ks);
      expect(buildCount(svg)).toBe(3);
      for (let k = 0; k <= 3; k++) expect(braces(shownAt(svg, k))).toBe(1);
      // Present's own frame styles hide every other frame's brace.
      expect(svgAtBuild(svg, 1, { answer: true, motion: false })).toContain(
        '[data-f~="1"][data-f][data-f]{opacity:1}',
      );
    });
  test("every other surface shows the finished drawing: the total's brace alone", () => {
    const svg = svgOf(spec(Y6), "ks2", undefined, false);
    expect(braces(svg)).toBe(1);
    expect(svg).not.toContain("data-f");
    expect(svg).toContain(">35% =</tspan>");
    expect(svg).toContain(">28</tspan>");
    expect(svg).not.toContain(">10% =</tspan>");
  });
  test("the brace labels are the tenths: 10% = 8, 30% = 24, 5% = 4, 35% = 28", () => {
    const svg = svgOf(spec(Y6), "ks2");
    for (const lead of ["10%", "30%", "5%", "35%"])
      expect(svg).toContain(`>${lead} =</tspan></text><text`);
    for (const v of ["8", "24", "4", "28"]) expect(svg).toContain(`>${v}</tspan>`);
  });
});

describe("panel size: any box from 320×200 up, labels at or above the age floor", () => {
  const cases = [
    ["percent 35% of 80", Y6],
    ["percent 70% of 240", { model: "percent", amount: 240, percent: 70 }],
    ["equation 3x + 5 = 20", Y8],
    ["equation 6x + 12 = 90", { model: "equation", a: 6, b: 12, c: 90 }],
  ] as const;
  for (const ks of ["ks2", "ks3"])
    for (const [name, p] of cases)
      for (const box of BOXES)
        test(`${name}, ${ks}, ${box.w}×${box.h}`, () => {
          const t = atKeyStage(getTheme("paper"), ks);
          const s = spec(p);
          expect(diagramFaults(s, t, box)).toEqual([]);
          const floor = typeScale(t)?.bodySmall ?? 0;
          expect(floor).toBeGreaterThan(0);
          expect(shownLabelSize(s, t, box)).toBeGreaterThanOrEqual(floor);
          // Every label it sets is at least the floor, in the box's own points.
          const svg = svgOf(s, ks, box);
          const vw = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)?.[1]);
          const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
          expect(Math.min(...sizes) * (box.w / vw)).toBeGreaterThanOrEqual(floor - 0.01);
        });
  test("it draws, without a fault, in every theme at 320×200", () => {
    for (const th of THEMES)
      for (const p of [Y6, Y8])
        expect(diagramFaults(spec(p), atKeyStage(th, "ks3"), { w: 320, h: 200 })).toEqual([]);
  });
  test("under its smallest box it is a fault, so it never draws small and scaled up", () => {
    const t = atKeyStage(getTheme("paper"), "ks3");
    expect(PANEL_MIN.w).toBeLessThanOrEqual(320);
    expect(diagramFaults(spec(Y8), t, { w: 200, h: 140 })).toContain(
      `the panel is smaller than ${PANEL_MIN.w}×${PANEL_MIN.h}`,
    );
  });
});

describe("the KS3 equation bar (W-d3)", () => {
  const xCells = (svg: string) =>
    [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"[^>]*fill="([^"]+)"/g)]
      .filter((m) => m[2] !== "none")
      .map((m) => Number(m[1]));
  test("the x cells are a neutral width: the same whatever x is", () => {
    const a = xCells(
      svgOf(spec({ model: "equation", a: 3, b: 5, c: 20 }), "ks3", undefined, false),
    );
    const b = xCells(
      svgOf(spec({ model: "equation", a: 3, b: 5, c: 50 }), "ks3", undefined, false),
    );
    expect(a.slice(0, 3)).toEqual(b.slice(0, 3));
  });
  test("its finished drawing is the check: x's value in each cell, c with a tick", () => {
    const svg = svgOf(spec(Y8), "ks3", undefined, false);
    expect(svg.split(">5</tspan>").length - 1).toBe(4);
    expect(svg).toContain(">20</tspan>");
    expect(svg).toContain('font-style="italic"');
  });
  test("four builds: the whole, take 5 (15 left), share (three 5s), check", () => {
    const svg = svgOf(spec(Y8), "ks3");
    expect(buildCount(svg)).toBe(3);
    expect(shownAt(svg, 0)).toContain(">20</tspan>");
    expect(shownAt(svg, 1)).toContain(">15</tspan>");
    expect(shownAt(svg, 1)).not.toContain(">20</tspan>");
    expect(shownAt(svg, 2).split(">5</tspan>").length - 1).toBe(5);
  });
});

describe("the guard: numbers the panel cannot draw exactly fall back to text", () => {
  test.each([
    [{ model: "equation", a: EQUATION_MAX_A + 1, b: 5, c: 40 }, "a is not a whole number"],
    [{ model: "equation", a: 2.5, b: 5, c: 40 }, "a is not a whole number"],
    [{ model: "equation", a: 3, b: 0, c: 40 }, "b is not positive"],
    [{ model: "equation", a: 3, b: 20, c: 5 }, "c is not above b"],
    [{ model: "percent", amount: 80, percent: 33 }, "multiple of 5"],
    [{ model: "percent", amount: 80, percent: 120 }, "multiple of 5"],
  ] as const)("%p fails the guard", (p, why) => {
    const g = barPanelGuard(p);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toContain(why);
    expect(barPanelSpec(p, "bar").ok).toBe(false);
    // A spec that carries such a panel does not parse, so nothing draws.
    const raw = { kind: "bar-model", alt: "bar", bars: [{ parts: [{ value: 1 }] }], panel: p };
    expect(parseDiagram(raw)).toBeUndefined();
    expect(renderDiagram(raw, getTheme("paper"), { w: 320, h: 200 })).toBeUndefined();
  });
  test("a = 6 is the largest equation bar drawn", () => {
    expect(barPanelGuard({ model: "equation", a: 6, b: 12, c: 90 }).ok).toBe(true);
  });
});

describe("the panel is code's, not the writer's", () => {
  test("the bar model's wire schema has no panel field", async () => {
    const { diagramJsonSchema } = await import("./wire");
    const j = diagramJsonSchema("bar-model") as { properties: Record<string, unknown> };
    expect(Object.keys(j.properties)).not.toContain("panel");
    expect(Object.keys(j.properties)).toContain("bars");
  });
});

describe("the writer's schema is master's (review of #526)", () => {
  // sha256 of JSON.stringify of each schema, read on origin/master 8c5587793 before this part.
  const sha = (o: unknown) =>
    require("node:crypto").createHash("sha256").update(JSON.stringify(o)).digest("hex");
  test("the bar model's wire and drawer schemas hash as on master", async () => {
    const { diagramJsonSchema, drawerJsonSchema } = await import("./wire");
    expect(sha(diagramJsonSchema("bar-model"))).toBe(
      "75753184e4b98fad675b4625d65b7b96201c214b3097da7c8ddbfbe0afaddc4a",
    );
    expect(sha(drawerJsonSchema("bar-model"))).toBe(
      "089a7e9660c7efdd0d4776d478f81f5d420dcd74a8a7d15c95bc68cca2bf3f23",
    );
  });
});

describe("x cells are measured: a value never overflows its cell", () => {
  const t3 = atKeyStage(getTheme("paper"), "ks3");
  const eq = (a: number, b: number, c: number) => ({ model: "equation" as const, a, b, c });
  test("a 3-digit x in six cells is over at 300 wide, and fits at its measured width", () => {
    const p = eq(6, 12, 762); // x = 125
    const box = { w: 300, h: 300 };
    expect(diagramFaults(spec(p), t3, box)).toContain('the x cells are too narrow for "125"');
    const min = barPanelMinWidth(p, t3, 300) as number;
    expect(min).toBeGreaterThan(300);
    expect(diagramFaults(spec(p), t3, { w: min, h: 300 })).toEqual([]);
    expect(shownLabelSize(spec(p), t3, { w: min, h: 300 })).toBeGreaterThanOrEqual(21);
  });
  test("every value drawn sits inside its cell at the measured width (3-digit, decimal)", () => {
    for (const p of [eq(6, 12, 762), eq(3, 5, 380), eq(2, 3, 8), eq(4, 1, 10), eq(5, 2.5, 15)]) {
      const min = barPanelMinWidth(p, t3, 300) as number;
      expect(min).toBeDefined();
      expect(diagramFaults(spec(p), t3, { w: min, h: 300 })).toEqual([]);
    }
  });
  test("a decimal x draws exactly: 2x + 3 = 8 shows 2.5 in each cell", () => {
    const svg = svgOf(spec(eq(2, 3, 8)), "ks3", undefined, false);
    expect(svg.split(">2.5</tspan>").length - 1).toBe(2);
  });
  test("a recurring x is refused with a clear reason", () => {
    const g = barPanelGuard(eq(3, 2, 12)); // x = 10/3
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toBe("x is not a whole number or a decimal of at most 2 places");
  });
  test("ten x cells are refused (a ≤ 6); the ten tenths of a percent bar draw", () => {
    expect(barPanelGuard(eq(10, 5, 105)).ok).toBe(false);
    const svg = svgOf(spec(Y6), "ks3", undefined, false);
    expect((svg.match(/<line /g) ?? []).length).toBe(9);
    expect(diagramFaults(spec(Y6), t3, { w: 320, h: 200 })).toEqual([]);
  });
});
