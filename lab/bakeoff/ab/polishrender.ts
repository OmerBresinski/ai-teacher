// polish arm ($0): before/after renders of saved base4 diagrams and the new strips kind.
// bun lab/bakeoff/ab/polishrender.ts cycle|strips <outDir>
// Each spec is drawn by drawDiagram (the layouts' own call: refit, simpler forms, then a refusal)
// in a side slot on its lesson's theme and on Night Lab, with the polish switch off (before) and on
// (after), set on the theme's panel, and shot with Playwright.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium as pw } from "../../../apps/web/node_modules/@playwright/test/index.mjs";
import { drawDiagram } from "../../../packages/slides/src/diagrams/draw";
import { diagramFaults } from "../../../packages/slides/src/diagrams/index";
import { withDiagramPolish } from "../../../packages/slides/src/diagrams/polish";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { AB } from "./arms";

type Item = { name: string; spec: unknown; theme: string; stage: string };
const RUNS = `${AB}/runs`;

function savedFlows(): Item[] {
  const out: Item[] = [];
  const glob = new Bun.Glob("{b3-r2-1,b3-r2-2,nz-uk}/T/*/diagrams.jsonl");
  for (const f of [...glob.scanSync(RUNS)].sort()) {
    const dir = `${RUNS}/${f.replace(/\/diagrams\.jsonl$/, "")}`;
    const brief = JSON.parse(readFileSync(`${dir}/brief.json`, "utf8"));
    readFileSync(`${RUNS}/${f}`, "utf8")
      .split("\n")
      .filter(Boolean)
      .forEach((l, i) => {
        const d = JSON.parse(l);
        if (!["cycle", "flow"].includes(d.spec?.kind)) return;
        const run = f.split("/")[0];
        const key = String(d.key).replace(/:.*/, "");
        out.push({
          name: `${run}-${brief.id}-k${key}-${i}`,
          spec: d.spec,
          theme: brief.theme,
          stage: brief.keyStage,
        });
      });
  }
  return out;
}

/** uk-seasons slides 10 and 11 as the strips kind, plus the saved freeform drawings they replace. */
function seasons(): Item[] {
  const dir = `${RUNS}/nz-uk/T/y1-science-seasons-uk`;
  const saved = readFileSync(`${dir}/diagrams.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((d) => d.spec?.kind === "labelled-diagram");
  const base = {
    kind: "strips",
    units: 24,
    unit: "hours",
    key: { light: "daylight", dark: "dark" },
  };
  return [
    ...saved.map((d) => ({
      name: `saved-s${Number(String(d.key).replace(/:.*/, "")) + 1}-labelled`,
      spec: d.spec,
      theme: "splash",
      stage: "ks1",
    })),
    {
      name: "s10-strips",
      spec: {
        ...base,
        alt: "Two 24-hour strips: summer has 16 hours of daylight, winter has 8.",
        rows: [
          { label: "summer", light: 16 },
          { label: "winter", light: 8 },
        ],
      },
      theme: "splash",
      stage: "ks1",
    },
    {
      name: "s11-strips",
      spec: {
        ...base,
        alt: "Two 24-hour strips: A has 7 hours of daylight, B has 17.",
        rows: [
          { label: "A", light: 7 },
          { label: "B", light: 17 },
        ],
      },
      theme: "splash",
      stage: "ks1",
    },
  ];
}

const SIDE = { x: 0, y: 0, w: 560, h: 420 };

async function main() {
  const [mode, outDir] = [process.argv[2], process.argv[3]];
  if (!outDir || !["cycle", "strips"].includes(mode ?? ""))
    throw new Error("usage: cycle|strips <outDir>");
  mkdirSync(outDir, { recursive: true });
  const items = mode === "cycle" ? savedFlows() : seasons();
  const browser = await (pw as { launch: () => Promise<any> }).launch();
  const page = await browser.newPage({
    viewport: { width: 1300, height: 600 },
    deviceScaleFactor: 1,
  });
  const report: object[] = [];
  for (const it of items)
    for (const th of [it.theme, "night-lab"]) {
      const theme = getTheme(th, it.stage as never);
      const cells: string[] = [];
      const row: Record<string, unknown> = { name: it.name, theme: th };
      for (const polish of [false, true]) {
        const r = withDiagramPolish(polish, () =>
          withKeyStage(it.stage as never, () => drawDiagram(it.spec, theme, SIDE)),
        );
        const faults = withDiagramPolish(polish, () =>
          withKeyStage(it.stage as never, () => diagramFaults(it.spec, theme, SIDE)),
        );
        row[polish ? "after" : "before"] = r.ok ? { ok: true, fs: r.fs, rung: r.rung } : r;
        row[polish ? "afterFaults" : "beforeFaults"] = faults;
        const img = r.ok
          ? `<img src="${(r.element as { src: string }).src}" width="${SIDE.w}" height="${SIDE.h}">`
          : `<div class="no">no drawing: ${r.reasons.slice(0, 2).join("; ")}</div>`;
        cells.push(
          `<div class="cell"><div class="cap">${polish ? "after (polish)" : "before (base4)"}</div><div class="panel">${img}</div></div>`,
        );
      }
      const c = theme.colors;
      await page.setContent(
        `<html><body style="margin:0;background:${c.background};font:14px sans-serif;color:${c.ink}"><div style="display:flex;gap:24px;padding:20px">${cells.join("")}</div><style>.panel{background:${c.panel ?? c.surface};border-radius:16px;padding:16px;width:${SIDE.w}px;height:${SIDE.h}px}.cap{margin-bottom:6px}.no{padding:40px;color:${c.muted}}</style></body></html>`,
      );
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${outDir}/${it.name}-${th}.png`, fullPage: true });
      report.push(row);
    }
  await browser.close();
  writeFileSync(`${outDir}/report.json`, `${JSON.stringify(report, null, 1)}\n`);
  console.log(
    JSON.stringify(
      report.map((r) => [
        (r as { name: string }).name,
        (r as { theme: string }).theme,
        JSON.stringify((r as { before: unknown }).before).slice(0, 60),
        JSON.stringify((r as { after: unknown }).after).slice(0, 60),
      ]),
    ),
  );
}
await main();
