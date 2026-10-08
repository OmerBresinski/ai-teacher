// lib arm $0 fill-path test: five hand-written model figures from base4 y1, y2 and y5 slides
// (fixtures/lib-figures.json) through fill (stub: presets), schema check, validate, the library
// engine's render, and the slide's own template, then rendered as a lesson. No model calls.
// bun lab/bakeoff/ab/libsmoke.ts [outDir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { layoutTemplate } from "../../../packages/slides/src/templates";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { normalise } from "../arm-t";
import { renderLesson } from "../render";
import { AB } from "./arms";
import { type Filler, libDiagram, library } from "./lib";
import { closeRenderer, renderModel } from "./librender";

type J = Record<string, unknown>;
type Fx = J & {
  brief: string;
  slide: number;
  heading: string;
  figure: J;
  stub: { model: string; preset: string; patch: J };
};
const out = process.argv[2] ?? `${AB}/arms3/lib/smoke`;
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(`${import.meta.dir}/../fixtures/lib-figures.json`, "utf8"))
  .figures as Fx[];
const { models } = await library();
const BAKEOFF = AB.replace(/\/ab$/, "");

const rows: J[] = [];
for (const [n, f] of fx.entries()) {
  const brief = JSON.parse(readFileSync(`${BAKEOFF}/briefs/${f.brief}.json`, "utf8")) as J;
  const stage = String(brief.keyStage);
  const theme = String(brief.theme ?? "splash");
  const preset = models.get(f.stub.model)?.presets.find((p) => p.id === f.stub.preset);
  if (!preset) throw new Error(`no preset ${f.stub.model}/${f.stub.preset}`);
  const stub: Filler = async () => ({ out: { ...preset.params, ...f.stub.patch }, usd: 0 });
  const words = [f.heading, f.lead, f.formula, ...((f.points as unknown[]) ?? [])]
    .filter(Boolean)
    .map((p) => (typeof p === "string" ? p : `${(p as J).label}: ${(p as J).text}`))
    .join("\n");
  const events: J[] = [];
  const key = `${f.brief}-s${f.slide}`;
  const r = await libDiagram(
    {
      key,
      shows: String(f.figure.intent),
      words,
      yearGroup: String(brief.yearGroup),
      spec: f.figure,
      lib: { lesson: `${brief.subject}: ${brief.topic}`, outDir: out },
    },
    { filler: stub, render: renderModel },
    (e) => events.push(e as J),
  );
  // The slide as the arm lays it out: the writer's template, the drawn model in its figure zone.
  const s = normalise({ ...f, figure: f.figure } as J);
  const dkey = "diagram" in s ? "diagram" : "figure";
  const input = {
    ...s,
    [dkey]: undefined,
    figure: r.libDrawn
      ? { photo: r.libDrawn.src, alt: r.libDrawn.alt, aspect: r.libDrawn.aspect }
      : undefined,
  } as J;
  delete input.brief;
  delete input.stub;
  delete input.base4;
  delete input.slide;
  delete input.diagram;
  const laid = withKeyStage(stage as never, () =>
    layoutTemplate(input as never, getTheme(theme, stage as never), stage as never),
  );
  const now = new Date().toISOString();
  const dir = `${out}/${key}`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/lesson.json`;
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      id: `lib-smoke-${key}`,
      title: f.heading,
      themeId: theme,
      subject: String(brief.subject).toLowerCase(),
      ageBand: stage,
      yearGroup: brief.yearGroup,
      language: "en-GB",
      createdAt: now,
      updatedAt: now,
      slides: laid.slide ? [{ id: "s1", ...laid.slide, notes: "" }] : [],
    }),
  );
  const rendered = laid.slide ? await renderLesson(file, dir) : "no slide";
  const ev = (k: string) => events.filter((e) => e.ev === k);
  const row = {
    n: n + 1,
    key,
    model: f.stub.model,
    template: s.template,
    fill: ev("lib-fill").map((e) => (e.ok ? "ok" : "refused")),
    drawn: !!r.libDrawn,
    aspect: r.libDrawn ? Number(r.libDrawn.aspect.toFixed(2)) : undefined,
    warnings: ev("lib-drawn")[0]?.warnings ?? [],
    fallback: ev("lib-fallback")[0]?.to,
    renderError: ev("lib-render-failed")[0]?.err,
    figureOnSlide: !!laid.slide?.elements?.some?.(
      (e: J) => e.type === "image" && String(e.src).startsWith("data:image/png"),
    ),
    rendered,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
await closeRenderer();
writeFileSync(`${out}/smoke.json`, JSON.stringify(rows, null, 1));
const okN = rows.filter((r) => r.drawn && r.figureOnSlide).length;
console.log(
  `${okN}/${rows.length} model figures filled, checked, drawn and placed on their slides -> ${out}`,
);
if (okN !== rows.length) process.exitCode = 1;
