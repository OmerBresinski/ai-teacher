// polish2 ($0, D30): the diagrams the polish runs lost to the label gate, drawn again in their
// slide's layout under polish (whole-diagram gate) and polish2 (refit, then per-label drop).
// bun lab/bakeoff/ab/polish2replay.ts <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setDiagramPolish } from "../../../packages/slides/src/diagrams/polish";
import { atFullSize, layoutTemplate } from "../../../packages/slides/src/templates/index";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { AB } from "./arms";

const RUNS = `${AB}/runs`;
const out = process.argv[2] as string;
mkdirSync(out, { recursive: true });
type Lost = { run: string; lesson: string; slide: number; fault: string };
const lost: Lost[] = [];
for (const f of [...new Bun.Glob("polish-*/T/*/log.jsonl").scanSync(RUNS)].sort()) {
  const [run, , lesson] = f.split("/") as [string, string, string];
  const checks = readFileSync(`${RUNS}/${f}`, "utf8")
    .split("\n")
    .filter((l) => l.includes('"ev":"checks"'))
    .map((l) => JSON.parse(l) as { failing: string[] });
  const last = checks[checks.length - 1];
  for (const x of last?.failing ?? []) {
    const m = /^s(\d+): diagram: figure could not be drawn: (.*)$/.exec(x);
    if (m && / (touch|overlap)\b/.test(m[2] as string))
      lost.push({ run, lesson, slide: Number(m[1]), fault: m[2] as string });
  }
}
const cells: string[] = [];
const rows: object[] = [];
let survive = 0;
for (const l of lost) {
  const dir = `${RUNS}/${l.run}/T/${l.lesson}`;
  const brief = JSON.parse(readFileSync(`${dir}/brief.json`, "utf8"));
  const key = `${l.slide - 1}:diagram`;
  const specs = readFileSync(`${dir}/diagrams.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((x) => JSON.parse(x))
    .filter((d) => d.key === key);
  const spec = specs[specs.length - 1]?.spec;
  const main = JSON.parse(JSON.parse(readFileSync(`${dir}/main.json`, "utf8")).text);
  const ws = main.slides[l.slide - 3] ?? {};
  const theme = getTheme(brief.theme, brief.keyStage);
  const input = {
    template: ws.template === "big-visual" ? "big-diagram" : "diagram-text",
    heading: String(ws.heading ?? "Heading"),
    ...(ws.lead ? { lead: String(ws.lead) } : {}),
    ...(Array.isArray(ws.points)
      ? { points: ws.points.map((p: unknown) => (typeof p === "string" ? p : JSON.stringify(p))) }
      : {}),
    figure: { diagram: spec },
  };
  const draw = (gate: "diagram" | "label") => {
    setDiagramPolish(true, gate);
    try {
      return withKeyStage(brief.keyStage, () =>
        atFullSize(() => layoutTemplate(input as never, theme, brief.keyStage)),
      ) as { slide: { elements: { type: string; src?: string }[] }; diagram?: string[] };
    } finally {
      setDiagramPolish(false);
    }
  };
  const a = draw("diagram");
  const b = draw("label");
  const ok = !b.diagram?.length && !!spec;
  if (ok) survive++;
  const img = b.slide.elements.find(
    (e) => e.type === "image" && e.src?.startsWith("data:image/svg"),
  );
  rows.push({
    ...l,
    kind: spec?.kind,
    polish: a.diagram ?? "drawn",
    polish2: b.diagram ?? "drawn",
  });
  cells.push(
    `<div style="margin:12px;width:560px;font:13px sans-serif"><div>${l.run} ${l.lesson} s${l.slide} (${spec?.kind}): ${ok ? "drawn" : `lost: ${(b.diagram ?? []).join("; ")}`}</div>${img ? `<img src="${img.src}" style="max-width:560px;background:${theme.colors.panel ?? theme.colors.surface}">` : ""}</div>`,
  );
}
writeFileSync(
  `${out}/lost.html`,
  `<html><body style="display:flex;flex-wrap:wrap;background:#eee">${cells.join("")}</body></html>`,
);
writeFileSync(`${out}/lost.json`, `${JSON.stringify(rows, null, 1)}\n`);
console.log(`lost under polish: ${lost.length}; drawn under polish2: ${survive}`);
for (const r of rows) console.log(JSON.stringify(r).slice(0, 260));
