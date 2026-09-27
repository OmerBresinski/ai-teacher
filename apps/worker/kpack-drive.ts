// l6kp2 driver (lab/l6kp2): E50's e50-drive.ts with a knowledge-pack arm. Both arms per brief run side by side (2 at a time), same settings.
// KP = deps.labPack from a Sol recall pack minus its session drop list; KN = no pack. Stops starting jobs past --limit USD.
// stopAfter planned) -> confirm (plan.state confirmed, objectives unchanged, as the API does) ->
// generate (resume, withObjectivesSlide). gpt-6-luna on every class, effort low, images off.
// Usage: bun kpack-drive.ts <outDir> <limitUsd> <briefId>=<packJson>[,<dropFile>] ...   Never prints the key.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Writable } from "node:stream";
import { createAi, createBudget } from "@tj/ai";
import { isContinuation, type Lesson, lessonFromBrief } from "@tj/domain/documents";
import { noSources, type PipelineDeps, runLessonPipeline } from "@tj/generation";
import pino from "pino";
import {
  labPackFor,
  loadRecallPack,
  type Selection,
} from "../../packages/generation/eval/lab-pack";
import { withObjectivesSlide } from "./src/jobs/lesson-generate";

const [outDir, limitArg, ...specs] = process.argv.slice(2);
if (!outDir || !limitArg || specs.length === 0) throw new Error("usage");
const limit = Number(limitArg);
let spent = 0;
mkdirSync(outDir, { recursive: true });
const Q = "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd";
const briefPath = (id: string) =>
  existsSync(`${Q}/look/briefs/${id}.json`)
    ? `${Q}/look/briefs/${id}.json`
    : `${Q}/briefs-18/${id}.json`;
const MODEL = "openai/gpt-6-luna";
const ai = createAi({
  OPENAI_API_KEY: readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim(),
  AI_MODEL_FRONTIER: MODEL,
  AI_MODEL_STANDARD: MODEL,
  AI_MODEL_SMALL: MODEL,
} as never);
const caps = { capUsd: 0.5, capTokens: 300_000 };
let n = 0;
const ids = () => `e${(++n).toString(36)}${Date.now().toString(36)}`;

async function run(briefId: string, arm: "KP" | "KN", packSpec: string, label: string) {
  const raw = JSON.parse(readFileSync(briefPath(briefId), "utf8"));
  let lesson: Lesson = lessonFromBrief(raw, `kp-${label}`, new Date());
  const [packPath, dropPath] = packSpec.split(",");
  const loaded = arm === "KP" ? loadRecallPack(packPath as string, dropPath) : undefined;
  const selections: Selection[] = [];
  const summaries: Record<string, unknown>[] = [];
  const fallbacks: Record<string, unknown>[] = [];
  const continued: Record<string, unknown>[] = [];
  const mk = (phase: string, t0: number, onSlides: (l: Lesson) => void): PipelineDeps => {
    const d = {
      ai,
      budget: createBudget(
        caps,
        lesson.generation?.usage ? { spent: lesson.generation.usage } : {},
      ),
      effortFor: () => "low",
      signal: new AbortController().signal,
      logger: pino(
        { level: "info" },
        new Writable({
          write(chunk, _e, cb) {
            for (const line of chunk.toString().split("\n").filter(Boolean)) {
              const r = JSON.parse(line);
              if (r.msg === "generation summary") summaries.push({ phase, ...r.generation });
              if (r.msg === "slide continued")
                continued.push({ phase, slide: r.slide, slides: r.slides });
              if (r.metric === "shape-fallback")
                fallbacks.push({ phase, stage: r.stage, shape: r.shape, index: r.index });
              if (r.level >= 50) process.stderr.write(`${label} ${phase} ${r.msg}\n`);
            }
            cb();
          },
        }),
      ),
      now: () => new Date(),
      ids,
      sources: noSources,
      persist: async (l) => {
        lesson = l;
        onSlides(l);
        return { updatedAt: new Date().toISOString() };
      },
      onProgress: async () => undefined,
      context: { lessonId: lesson.id, jobId: `${label}-${phase}` },
    } as PipelineDeps;
    if (loaded)
      d.labPack = labPackFor(
        loaded.pack,
        { subject: raw.subject, yearGroup: raw.yearGroup },
        () => d,
        selections,
      );
    return d;
  };
  const t0 = Date.now();
  let error = "";
  let objectivesS = 0;
  let firstSlideS: number | null = null;
  let totalS: number | null = null;
  try {
    const plan = await runLessonPipeline(
      { lesson },
      mk("plan", t0, () => {}),
      {
        stopAfter: "planned",
        planner: "objectives-first",
      },
    );
    lesson = plan.lesson;
    objectivesS = (Date.now() - t0) / 1000;
    lesson = {
      ...lesson,
      plan: { ...(lesson.plan ?? { revision: 1 }), state: "confirmed" } as never,
    };
    const t1 = Date.now();
    const deps = mk("generate", t1, (l) => {
      if (
        firstSlideS === null &&
        l.slides.filter((s) => s.kind !== "title" && s.kind !== "objectives").length > 0
      )
        firstSlideS = (Date.now() - t1) / 1000;
    });
    const gen = await runLessonPipeline({ lesson: withObjectivesSlide(lesson, deps) }, deps);
    lesson = gen.lesson;
    totalS = (Date.now() - t1) / 1000;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : "Error";
  }
  const g = summaries.find((s) => s.phase === "generate") ?? {};
  const facts = lesson.facts;
  const text = JSON.stringify(lesson.slides);
  const row = {
    arm,
    label,
    brief: briefId,
    objectivesS,
    firstSlideS,
    readableS: typeof g.readableMs === "number" ? g.readableMs / 1000 : null,
    checkedS: typeof g.checkedMs === "number" ? g.checkedMs / 1000 : null,
    totalS,
    pack: loaded ? { id: loaded.pack.id, dropped: loaded.dropped, selections } : null,
    cost: lesson.generation?.usage?.costUsd ?? null,
    slides: lesson.slides.length,
    stage: lesson.generation?.stage,
    objectives: facts?.objectives.map((o) => o.text) ?? [],
    workedPerObjective: (facts?.objectives ?? []).map(
      (o) =>
        (facts?.workedExamples ?? []).filter((w) => (w.objectiveRefs as unknown[]).includes(o.id))
          .length,
    ),
    shapeFallbacks: fallbacks.length,
    shapeFallbackDetail: fallbacks,
    continuedLogged: continued.length,
    continuedDetail: continued,
    continuationSlides: lesson.slides.filter((s, i) => isContinuation(s, lesson.slides[i - 1]))
      .length,
    keyIdeaShapes: ((facts as { keyIdeas?: { shape?: string }[] } | undefined)?.keyIdeas ?? []).map(
      (k) => k.shape ?? null,
    ),
    textLen: text.length,
    promptVersions: lesson.generation?.promptVersions,
    error,
  };
  writeFileSync(`${outDir}/${label}.lesson.json`, JSON.stringify(lesson, null, 1));
  spent += typeof row.cost === "number" ? row.cost : 0;
  appendFileSync(`${outDir}/rows.jsonl`, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify({ ...row, promptVersions: undefined }));
}

const jobs: [string, "KP" | "KN", string, string][] = [];
for (const spec of specs) {
  const [id, pack] = spec.split("=");
  for (const arm of ["KP", "KN"] as const)
    jobs.push([id as string, arm, pack as string, `${arm}-${id}-p1`]);
}
// Two at a time (WORKER_CONCURRENCY=2): each brief's pack and no-pack lessons run side by side.
for (let i = 0; i < jobs.length; i += 2) {
  if (spent >= limit) {
    console.log(`stopped: spent $${spent.toFixed(4)} >= limit $${limit}`);
    break;
  }
  await Promise.all(
    jobs.slice(i, i + 2).map(([id, arm, pack, label]) => run(id, arm, pack, label)),
  );
}
console.log(`spent $${spent.toFixed(4)}`);
