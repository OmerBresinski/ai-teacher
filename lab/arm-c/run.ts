// Arm C runner: one lesson, free-form HTML agent with render / probe / picture / diagram tools.
// Usage: bun lab/arm-c/run.ts <brief> [--stub] [--check-real] [--out <dir>]
//   <brief>: a name in BAKEOFF/briefs/ (or lab/visual/briefs/), or a path to a brief JSON.
//   --stub: scripted model, stub pictures and probes, real drawer and renderer; no network calls.
//   --check-real: import and construct the real model, pictures, diagrams and probes; no calls; exit.
// Env: CAP_USD (0.40), MAX_TURNS (40), EFFORT (medium), MODEL (gpt-6.1-sol), PROBE_MODEL (gpt-6-luna),
//      PG_URL (postgres://postgres:postgres@localhost:5619/teaching_journey), PICTURE_STORE.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { realDiagrams, stubDiagrams } from "./diagrams.ts";
import { type Model, responsesModel, stubModel } from "./model.ts";
import { slideText, writeNotes } from "./notes.ts";
import { realPictures, stubPictures } from "./pictures.ts";
import { realProbe, stubProbe } from "./probes.ts";
import { Renderer } from "./renderer.ts";
import { tokensFor, tokenTable } from "./tokens.ts";
import { Lesson, toolDefs } from "./tools.ts";

const BAKE = resolve(import.meta.dir, "../../../quality-prd/lab/rounds/BAKEOFF");
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const STUB = flag("--stub"),
  CHECK = flag("--check-real");
const briefArg = argv.find(
  (a, i) => !a.startsWith("--") && argv[i - 1] !== "--out" && argv[i - 1] !== "--objectives",
);
if (!briefArg) {
  console.error("brief required");
  process.exit(2);
}
const briefFile = [
  briefArg,
  `${BAKE}/briefs/${briefArg}.json`,
  resolve(BAKE, `../../visual/briefs/${briefArg}.json`),
].find((f) => f.endsWith(".json") && existsSync(f));
if (!briefFile) {
  console.error(`no brief ${briefArg}`);
  process.exit(2);
}
const B = JSON.parse(readFileSync(briefFile, "utf8"));
const fixed = B.brief?.slideCount ?? B.slideCount;
const brief = {
  yearGroup: B.yearGroup,
  subject: B.subject,
  topic: B.brief?.topic ?? B.topic,
  durationMin: B.brief?.durationMin ?? B.durationMin ?? 60,
  slidesMin: fixed ?? B.slides?.min ?? 10,
  slidesMax: fixed ?? B.slides?.max ?? 10,
};
const BRIEF_KEYS = [
  "yearGroup",
  "subject",
  "brief",
  "topic",
  "durationMin",
  "slides",
  "slideCount",
];
const name = basename(briefFile, ".json");
const runDir = resolve(opt("--out") ?? `${BAKE}/runs/C${STUB ? "-stub" : ""}/${name}`);
if (existsSync(join(runDir, "lesson.json"))) {
  console.error(`${runDir} already has a lesson.json; use a fresh --out`);
  process.exit(2);
}
for (const d of ["assets", "work", "html", "render"])
  mkdirSync(join(runDir, d), { recursive: true });

const P = resolve(import.meta.dir, "prompts");
const read = (f: string) => readFileSync(join(P, f), "utf8");
const tk = tokensFor(brief.yearGroup);
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 40),
  CAP = Number(process.env.CAP_USD ?? 0.4);
const PG = process.env.PG_URL ?? "postgres://postgres:postgres@localhost:5619/teaching_journey";
const logFile = join(runDir, "log.jsonl");
const t0 = performance.now();
const log = (r: Record<string, unknown>) =>
  appendFileSync(logFile, `${JSON.stringify({ ms: Math.round(performance.now() - t0), ...r })}\n`);
const costs = { model: 0, ai: 0, bank: 0, diagrams: 0, probes: 0, notes: 0 };

if (!STUB) {
  const marked = ["system.md", "user.md", "tool-descriptions.json", "probes.json"].filter((f) =>
    read(f).includes("PROMPT-AGENT:"),
  );
  if (marked.length && !CHECK) {
    console.error(`prompt files still placeholders: ${marked.join(", ")}`);
    process.exit(3);
  }
}
// Objectives are an approved input (BAKEOFF prompts: objectives call first). --objectives <file>,
// else BAKEOFF/arm-c/objectives/<brief>.json: [{teacher, pupil}].
const objFile = opt("--objectives") ?? `${BAKE}/arm-c/objectives/${name}.json`;
const objectives: { teacher: string; pupil: string }[] = existsSync(objFile)
  ? JSON.parse(readFileSync(objFile, "utf8"))
  : [];
if (!STUB && !objectives.length) {
  console.error(`no approved objectives at ${objFile}`);
  process.exit(2);
}
const objectivesText = objectives
  .map((o, i) => `${i + 1}. Teacher: ${o.teacher} | Pupils: ${o.pupil}`)
  .join("\n");
const user = read("user.md").replace(/\{\{(\w+)\}\}/g, (_, k) =>
  k === "tokens"
    ? tokenTable(tk)
    : k === "objectives"
      ? objectivesText
      : k === "slideCount"
        ? brief.slidesMin === brief.slidesMax
          ? String(brief.slidesMin)
          : `${brief.slidesMin} to ${brief.slidesMax}`
        : k === "keyStage"
          ? tk.ks.toUpperCase()
          : k === "theme"
            ? tk.themeId
            : k === "extra"
              ? JSON.stringify(
                  Object.fromEntries(Object.entries(B).filter(([x]) => !BRIEF_KEYS.includes(x))),
                )
              : String((brief as any)[k] ?? ""),
);
const tools = toolDefs(JSON.parse(read("tool-descriptions.json")));
const lessonCtx = {
  title: brief.topic,
  yearGroup: brief.yearGroup,
  subject: brief.subject,
  slideCount: brief.slidesMax,
  objectives,
};
const findPicture = STUB ? stubPictures(runDir) : await realPictures(runDir, lessonCtx, costs, PG);
const drawDiagram = STUB
  ? stubDiagrams(tk, runDir)
  : realDiagrams(tk, runDir, brief.yearGroup, costs, (r) => log({ kind: "diagram", r }));
const probe = STUB ? stubProbe : realProbe(costs, (r) => log({ kind: "probe", r }));
const model: Model = STUB
  ? stubModel(Math.min(Math.max(10, brief.slidesMin), brief.slidesMax), brief.topic)
  : responsesModel({
      model: process.env.MODEL ?? "gpt-6.1-sol",
      effort: process.env.EFFORT ?? "medium",
      instructions: read("system.md"),
      user,
      tools,
    });
if (CHECK) {
  console.log(
    "check-real: model, pictures, diagrams and probes constructed; tokens:",
    tk.themeId,
    tk.ks,
    "tools:",
    tools.length,
  );
  process.exit(0);
}

const renderer = new Renderer();
await renderer.start();
const lesson = new Lesson({
  runDir,
  tk,
  slideCount: brief.slidesMax,
  slideMin: brief.slidesMin,
  slideMax: brief.slidesMax,
  t0,
  renderer,
  findPicture,
  drawDiagram,
  probe,
});
const total = () => Object.values(costs).reduce((a, b) => a + b, 0);
log({ kind: "start", user, brief, runDir, stub: STUB, theme: tk.themeId, ks: tk.ks });
let results: { call_id: string; output: string }[] = [];
let turns = 0,
  stop = "finish";
while (!lesson.done) {
  if (turns >= MAX_TURNS) {
    stop = "turn cap";
    break;
  }
  if (total() > CAP) {
    stop = "cost cap";
    break;
  }
  lesson.turnsLeft = MAX_TURNS - turns - 1;
  const turn = await model.next(results);
  turns++;
  costs.model += turn.usd;
  log({
    kind: "turn",
    turn: turns,
    ms_model: turn.ms,
    usage: turn.usage,
    usd: turn.usd,
    text: turn.text.slice(0, 2000),
    calls: turn.calls.map((c) => c.name),
  });
  if (!turn.calls.length) {
    stop = "no tool call";
    break;
  }
  // Calls on one slide run in order; different slides run in parallel; set_plan first, finish last.
  const parsed = turn.calls.map((c) => {
    let a: any;
    try {
      a = JSON.parse(c.arguments || "{}");
    } catch {
      a = undefined;
    }
    return { c, a };
  });
  const out = new Map<string, unknown>();
  const run1 = async ({ c, a }: { c: (typeof parsed)[number]["c"]; a: any }) => {
    const ts = performance.now();
    const r =
      a === undefined
        ? { ok: false, error: "arguments were not valid JSON" }
        : await lesson
            .call(c.name, a)
            .catch((e) => ({ ok: false, error: `tool failed: ${String(e).slice(0, 200)}` }));
    out.set(c.call_id, r);
    log({
      kind: "tool",
      turn: turns,
      name: c.name,
      args: c.name === "render_slide" ? { slide: a?.slide, htmlChars: a?.html?.length } : a,
      ms_tool: Math.round(performance.now() - ts),
      result: r,
    });
  };
  for (const p of parsed.filter((p) => p.c.name === "set_plan")) await run1(p);
  const groups = new Map<string, typeof parsed>();
  for (const p of parsed.filter((p) => p.c.name !== "set_plan" && p.c.name !== "finish")) {
    const k = String(p.a?.slide ?? "_");
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  await Promise.all(
    [...groups.values()].map(async (g) => {
      for (const p of g) await run1(p);
    }),
  );
  for (const p of parsed.filter((p) => p.c.name === "finish")) await run1(p);
  results = turn.calls.map((c) => ({
    call_id: c.call_id,
    output: JSON.stringify(out.get(c.call_id)),
  }));
}
const auto = lesson.autoSubmit();
const slides = await lesson.output();
await renderer.stop();
const slidesSubmittedMs = lesson.timings.editable;
// Speaker notes: the shared notes call per slide (not the agent), so time to editable matches T, K and R.
const lessonJson = JSON.stringify({
  title: lesson.plan?.title ?? brief.topic,
  objectives: lesson.plan?.objectives ?? [],
  flow: lesson.plan?.flow ?? [],
  slides: slides.map((s) => ({ slide: s.slide, text: s.html ? slideText(s.html) : null })),
});
const notes = await writeNotes({
  stub: STUB,
  user,
  lessonJson,
  count: slides.length,
  costs,
  log: (r) => log(r),
});
for (const s of slides) {
  const n = notes.get(s.slide);
  s.notes = n?.notes ?? "";
  (s as Record<string, unknown>).answers = n?.answers ?? [];
}
lesson.timings.slides_submitted = slidesSubmittedMs;
lesson.timings.notes = Math.round(performance.now() - t0);
lesson.timings.editable = lesson.timings.notes;
const ms = Math.round(performance.now() - t0);
log({ kind: "end", stop, turns, auto, ms });
writeFileSync(
  join(runDir, "lesson.json"),
  JSON.stringify(
    {
      arm: "C",
      brief: name,
      stub: STUB,
      theme: tk.themeId,
      keyStage: tk.ks,
      tokens: tk.vars,
      plan: lesson.plan ?? null,
      stop,
      turns,
      autoSubmitted: auto,
      pictures: lesson.pictures,
      diagrams: lesson.diagrams,
      slides,
    },
    null,
    1,
  ),
);
writeFileSync(
  join(runDir, "timings.json"),
  JSON.stringify({ ...lesson.timings, total: ms, turns }, null, 1),
);
writeFileSync(
  join(runDir, "cost.json"),
  JSON.stringify(
    {
      ...Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, +v.toFixed(5)])),
      total: +total().toFixed(5),
    },
    null,
    1,
  ),
);
const sub = slides.filter((s) => s.status === "submitted").length;
console.log(
  `C ${name}: ${sub}/${slides.length} slides, ${turns} turns, stop=${stop}, ${ms} ms, $${total().toFixed(4)} -> ${runDir}`,
);
process.exit(0);
