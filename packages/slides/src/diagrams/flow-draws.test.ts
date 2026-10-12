import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import DRAWER from "./drawer-specs.fixture.json";
import MASTER from "./flow-draws.fixture.json";
import { DIAGRAM_SAMPLES, renderDiagram } from "./index";
import { MEANING_SAMPLES } from "./meaning-samples";
import { TEMPLATE_SPECS } from "./template-specs";
import H1 from "./writer-specs.fixture.json";

/*
 * TEACH-247 ac: the stricter flow graph checks (no line through a box, words a clear gap apart)
 * never leave blank a flow that drew before them. Every flow in the corpus (the never-throw
 * samples, the writer and drawer replay specs, and the base4 lab outputs) is drawn on every theme
 * in every zone the diagram suites use; the set that draws must hold every case that drew on
 * master before part ac (`flow-draws.fixture.json`, written by WRITE_FLOW_DRAWS=1 on that code).
 */
const BASE4 = new URL(
  "../../../generation/src/writer/fixtures/base4-diagrams.json",
  import.meta.url,
);
const corpus: Record<string, unknown> = {
  ...DIAGRAM_SAMPLES,
  ...TEMPLATE_SPECS,
  ...MEANING_SAMPLES,
  ...(H1 as Record<string, unknown>),
  ...(DRAWER as Record<string, unknown>),
};
const walk = (o: unknown, tag: string) => {
  if (Array.isArray(o)) {
    for (const [i, v] of o.entries()) walk(v, `${tag}.${i}`);
  } else if (o && typeof o === "object") {
    if ((o as { kind?: unknown }).kind === "flow") corpus[tag] = o;
    else for (const [k, v] of Object.entries(o)) walk(v, `${tag}.${k}`);
  }
};
walk(JSON.parse(readFileSync(BASE4, "utf8")), "base4");
/** A drawing with anything in it (a flow that cannot lay out comes back as an empty shell). */
const drawsSomething = (svg: string | undefined) => /<(rect|line|path|text)\b/.test(svg ?? "");
const flows = Object.entries(corpus).filter(([, s]) => (s as { kind?: string }).kind === "flow");
const ZONES = [
  { w: 716, h: 208 },
  { w: 348, h: 284 },
  { w: 788, h: 235 },
  { w: 403, h: 336 },
  { w: 300, h: 420 },
  { w: 860, h: 380 },
];

describe("TEACH-247 ac: no flow that drew on master is blank now", () => {
  test("the drawn set holds master's", () => {
    const drawn: string[] = [];
    const perCase: Record<string, [number, number]> = {};
    const master = new Set(MASTER as string[]);
    for (const [name, spec] of flows)
      for (const t of THEMES)
        for (const z of ZONES) {
          const key = `${name}|${t.id}|${z.w}x${z.h}`;
          const ok = drawsSomething(renderDiagram(spec, t, z));
          if (ok) drawn.push(key);
          const c = perCase[name] ?? [0, 0];
          perCase[name] = [c[0] + (master.has(key) ? 1 : 0), c[1] + (ok ? 1 : 0)];
        }
    if (process.env.WRITE_FLOW_DRAWS) {
      writeFileSync(
        new URL("./flow-draws.fixture.json", import.meta.url),
        `${JSON.stringify(drawn, null, 1)}\n`,
      );
      return;
    }
    if (process.env.SHOW_FLOW_DRAWS)
      for (const [n, [m, a]] of Object.entries(perCase)) console.log(`${n}: ${m} -> ${a}`);
    expect(flows.length).toBeGreaterThan(20);
    const now = new Set(drawn);
    expect([...master].filter((k) => !now.has(k))).toEqual([]);
  }, 240_000);
});
