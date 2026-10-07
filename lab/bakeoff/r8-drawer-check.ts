// Round 8 drawer check (DIAGRAM-SOURCE C4): the new drawer once on the 5 round 7 failure requests,
// each drawn to SVG and PNG at its slot. Usage: bun lab/bakeoff/r8-drawer-check.ts <outDir>
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { renderDiagram } from "../../packages/slides/src/diagrams/index";
import { getTheme, withKeyStage } from "../../packages/slides/src/themes";
import { diagramContext } from "./harness";
import { type DiagramAsk, diagramSpec, Ledger } from "./services";

const out = process.argv[2];
mkdirSync(out, { recursive: true });
type Case = {
  id: string;
  ks: string;
  theme: string;
  year: string;
  kind: string;
  slide: Record<string, unknown>;
};
// The round 7 writer slides (round7/runs/T/*/main.json), kind moved to the v2 menu's kind where the
// round 7 menu had none (y2: equal-groups); y7's ask is its lead's move, which v2 calls the ask.
const fig = (s: Record<string, unknown>) => s.figure as { shows: string; labels: string[] };
const cases: Case[] = [
  {
    id: "y2-quarter-of-12",
    ks: "ks1",
    theme: "splash",
    year: "Year 2",
    kind: "equal-groups",
    slide: {
      template: "steps",
      heading: "Find a quarter of 12",
      points: [
        "Start with 12 counters.",
        "Share into four equal groups.",
        "Count one group: a quarter of 12 is 3.",
      ],
      figure: {
        kind: "equal-groups",
        shows:
          "12 counters arranged in four separate equal group rings, each containing three counters",
        labels: ["3", "3", "3", "3"],
        ask: null,
      },
    },
  },
  {
    id: "y7-identify-states",
    ks: "ks3",
    theme: "studio",
    year: "Year 7",
    kind: "particles",
    slide: {
      template: "big-visual",
      heading: "Identify the states",
      lead: "Name each state. Describe its arrangement, spacing and movement.",
      figure: {
        kind: "particles",
        shows:
          "three unnamed equal-sized panels: A has widely separated circles with movement arrows in varied directions; B has close ordered circles with vibration marks; C has close irregular circles with arrows past neighbouring circles",
        labels: ["A", "B", "C"],
        ask: "Name each state.",
      },
    },
  },
  {
    id: "y11-collisions",
    ks: "ks4",
    theme: "studio",
    year: "Year 11",
    kind: "particles",
    slide: {
      template: "visual-text",
      heading: "Which collisions succeed?",
      lead: "Reactant particles must collide with enough energy to react.",
      points: [
        "Activation energy: the minimum energy needed for a successful collision.",
        "Successful collision: a collision that produces a reaction.",
      ],
      figure: {
        kind: "particles",
        shows:
          "two collision panels using the same two different reactant particles: in the first, short movement arrows lead to a collision and unchanged particles move apart; in the second, longer movement arrows lead to a collision and a joined product particle forms",
        labels: [
          "Below activation energy",
          "Particles unchanged",
          "Enough energy",
          "Product forms",
        ],
        ask: null,
      },
    },
  },
  {
    id: "y12-multi-store",
    ks: "ks5",
    theme: "studio",
    year: "Year 12",
    kind: "flow",
    slide: {
      template: "visual-text",
      heading: "How information moves",
      lead: "Atkinson and Shiffrin proposed separate memory stores.",
      points: [
        "Attention selects sensory information for STM.",
        "Maintenance rehearsal keeps information active and can transfer it to LTM.",
        "Decay is fading; displacement is replacement in a limited store.",
      ],
      figure: {
        kind: "flow",
        shows:
          "Sensory register to STM via attention; STM to LTM via maintenance rehearsal. Add a rehearsal loop at STM and a retrieval arrow from LTM to STM. Show loss from the sensory register and STM through decay, and from STM through displacement.",
        labels: [
          "Sensory register",
          "Attention",
          "Short-term memory",
          "Maintenance rehearsal",
          "Long-term memory",
          "Retrieval",
          "Decay",
          "Displacement",
        ],
        ask: null,
      },
    },
  },
  {
    id: "y10m-zero-product",
    ks: "ks4",
    theme: "studio",
    year: "Year 10",
    kind: "flow",
    slide: {
      template: "visual-text",
      heading: "A zero product gives two possibilities",
      lead: "If two factors multiply to zero, at least one factor must be zero.",
      points: [
        "Solve: set each factor equal to zero.",
        "Roots: values that make the equation true.",
      ],
      figure: {
        kind: "flow",
        shows:
          "The equation (x + 3)(x − 4) = 0 branches into x + 3 = 0 leading to x = −3, and x − 4 = 0 leading to x = 4",
        labels: ["(x + 3)(x − 4) = 0", "x + 3 = 0", "x = −3", "x − 4 = 0", "x = 4"],
        ask: null,
      },
    },
  },
];

const ledger = new Ledger(0.01);
const log = (e: object) => appendFileSync(`${out}/log.jsonl`, `${JSON.stringify(e)}\n`);
const words = (s: Record<string, unknown>) =>
  [s.heading, s.lead, ...((s.points as string[]) ?? [])].filter(Boolean).join("\n");
const results = await Promise.all(
  cases.map(async (c) => {
    const ctx = diagramContext(c.slide);
    const ask: DiagramAsk = {
      key: c.id,
      kind: c.kind,
      shows: fig(c.slide).shows,
      labels: fig(c.slide).labels,
      words: words(c.slide),
      yearGroup: c.year,
      ...ctx,
    };
    const spec = await diagramSpec(ask, ledger, log).catch(
      (e) => (log({ id: c.id, err: String(e) }), undefined),
    );
    return { c, ctx, spec };
  }),
);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const { c, ctx, spec } of results) {
  writeFileSync(`${out}/${c.id}.spec.json`, `${JSON.stringify(spec ?? null, null, 1)}\n`);
  if (!spec) {
    console.log(c.id, "NO SPEC");
    continue;
  }
  const st = c.ks as "ks1";
  const svg = withKeyStage(st, () =>
    renderDiagram(spec, getTheme(c.theme as "studio", st), { w: ctx.slot.w, h: ctx.slot.h }),
  );
  if (!svg) {
    console.log(c.id, "DID NOT DRAW");
    continue;
  }
  writeFileSync(`${out}/${c.id}.svg`, svg);
  await page.setViewportSize({ width: Math.round(ctx.slot.w), height: Math.round(ctx.slot.h) });
  await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
  await page.screenshot({ path: `${out}/${c.id}.png` });
  console.log(c.id, "ok");
}
await browser.close();
console.log("usd", ledger.total.toFixed(5), JSON.stringify(ledger.parts));
