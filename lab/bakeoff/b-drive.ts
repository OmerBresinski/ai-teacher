// BAKEOFF arm B driver: a copy of lab/fit-lab/harness/fit-drive-full.ts (FULL-RUN) with a hard picture generation cap.
// FULL-RUN copy (6 Oct): + BANK_DB picture library (createPictureBank, real embedder and generator,
// BANK_CAP, events to BANK_LOG, cost booked to the ledger) and AI_LOG_FILE (every ai call's log line).
// fit-lab driver (untracked). Runs the real lesson pipeline in process against ANY worktree, no DB,
// no worker, no queue (after quality-prd/look/pr2-smoke/pr2-drive.ts): plan (objectives-first,
// stopAfter planned) -> confirm (plan.state confirmed, objectives unchanged, as the API does) ->
// generate (resume, withPlanSlides as lesson.generate does). gpt-6-luna on every class, effort
// low, OpenAI direct, images off (no image placer) unless --images <photoDir>. Never prints a key.
//
// Usage:
//   bun fit-drive.ts --worktree <path> --out <dir> --budget-file <json> --cap <usd> <brief.json> ...
// Hard spend guard, between lessons: before each lesson the running total in --budget-file is
// read; the lesson is refused if total + reserve (--reserve, default 0.02) > cap, and the lesson's
// actual cost is added after. Lessons run one at a time. The in-pipeline budget is PRODUCTION's
// per-lesson budget (the env contract's Railway AI_LESSON_COST_CAP_USD / AI_LESSON_TOKEN_CAP),
// never the harness cap: the pipeline reserves each call's cap up front, so a smaller lesson
// budget refuses calls production would admit.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { Writable } from "node:stream";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const wt = resolve(opt("--worktree") ?? "");
const outDir = resolve(opt("--out") ?? "");
const budgetFile = resolve(opt("--budget-file") ?? "");
const cap = Number(opt("--cap"));
const labelTag = opt("--tag") ?? basename(wt);
// `designer` (spike/lesson-designer): one pass, title -> objectives -> design -> ... -> repair, with
// no stop for the plan screen (the arcs ride in memory from the objectives step to the design).
const planner = opt("--planner") ?? "objectives-first";
const briefs = argv;
if (!existsSync(`${wt}/packages/generation`) || !Number.isFinite(cap) || briefs.length === 0) {
  console.error(
    "usage: bun fit-drive.ts --worktree <path> --out <dir> --budget-file <json> --cap <usd> [--tag t] <brief.json> ...",
  );
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const { createAi, createBudget } = await import(`${wt}/packages/ai/src/index.ts`);
const { envVar } = await import(`${wt}/infra/env.contract.ts`);
const LESSON_CAP_USD = Number(envVar("AI_LESSON_COST_CAP_USD")?.railwayValue);
const LESSON_CAP_TOKENS = Number(envVar("AI_LESSON_TOKEN_CAP")?.railwayValue);
if (!(LESSON_CAP_USD > 0) || !(LESSON_CAP_TOKENS > 0)) {
  console.error("production lesson budget not found in infra/env.contract.ts");
  process.exit(2);
}
const { lessonFromBrief } = await import(`${wt}/packages/domain/src/documents/index.ts`);
const { noSources, runLessonPipeline, planWriteRoute } = await import(
  `${wt}/packages/generation/src/index.ts`
);
const { withPlanSlides } = await import(`${wt}/apps/worker/src/jobs/lesson-generate.ts`);
const pino = (await import(`${wt}/apps/worker/node_modules/pino/pino.js`)).default;

// --images <photoDir> (lab/visual, 30 Sep): illustrate ON. Pexels search + store as the worker's
// imagePlacer does, with the bytes written under <photoDir>/<key> (a local disk put) so
// lab/visual/harness/render.ts can serve them to the presenter. Needs PEXELS_API_KEY in the
// environment (lab/visual/harness/gen-images.sh takes it from Railway without printing it).
// Without the flag nothing changes: images off, as before.
let bankCost = 0;
const photoDir = opt("--images");
let photoPlacer: unknown;
if (photoDir) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    console.error("--images needs PEXELS_API_KEY in the environment");
    process.exit(2);
  }
  const { createPexelsClient, storePhoto } = await import(`${wt}/packages/images/src/index.ts`);
  const client = createPexelsClient({ apiKey: key });
  const root = resolve(photoDir);
  const storage = {
    put: async (k: string, body: unknown) => {
      const bytes =
        body instanceof ReadableStream
          ? new Uint8Array(await new Response(body).arrayBuffer())
          : (body as Uint8Array);
      mkdirSync(resolve(root, k, ".."), { recursive: true });
      writeFileSync(resolve(root, k), bytes);
      return { key: k };
    },
  };
  const WS = "0e7a1000-0000-4000-8000-000000000e7a";
  photoPlacer = {
    search: (query: string, o: Record<string, unknown>) =>
      client
        .search({ query, ...o, locale: "en-GB" })
        .then((page: { photos: unknown[] }) => page.photos),
    store: (photo: unknown, target: string) =>
      storePhoto({ photo, target, storage, workspaceId: WS }),
  };
  // pv-par2 (30 Sep): a worktree whose @tj/images has Commons gets searchCommons (ruling 139).
  const imagesMod = await import(`${wt}/packages/images/src/index.ts`);
  if (typeof imagesMod.createCommonsClient === "function") {
    const commons = imagesMod.createCommonsClient();
    (photoPlacer as Record<string, unknown>).searchCommons = (
      q: string,
      o: Record<string, unknown>,
    ) => commons.search({ query: q, ...o });
    console.error("Commons ON (named subjects first)");
  }
  if (process.env.BANK_DB) {
    const { createDb } = await import(`${wt}/packages/db/src/index.ts`);
    const { createStorage } = await import(`${wt}/packages/storage/src/index.ts`);
    const { createPictureBank } = await import(`${wt}/apps/worker/src/picture-bank.ts`);
    const { newId } = await import(`${wt}/packages/domain/src/index.ts`);
    const okey = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
    const dbh = createDb(process.env.BANK_DB);
    const bankLog = process.env.BANK_LOG ?? `${outDir}/bank.jsonl`;
    (photoPlacer as Record<string, unknown>).bank = createPictureBank({
      db: dbh.unsafeDb ?? dbh.db,
      storage: createStorage({ STORAGE_ROOT: root }).adapter,
      embedder: imagesMod.createOpenAiEmbedder({ apiKey: okey }),
      // BAKEOFF: the bank's own cap did not hold under parallel generation (ONECALL smoke 3); each
      // generation reserves ~$0.0063 first and none starts past BANK_CAP (as lab/bakeoff/services.ts).
      generator: (() => {
        const g = imagesMod.createOpenAiImageGenerator({ apiKey: okey });
        const capUsd = Number(process.env.BANK_CAP ?? "0.04");
        let reserved = 0;
        return {
          ...g,
          generate: async (a: never) => {
            if (bankCost + reserved + 0.0063 > capUsd + 1e-9)
              throw new Error(`picture generation cap $${capUsd} reached`);
            reserved += 0.0063;
            try {
              return await g.generate(a);
            } finally {
              reserved -= 0.0063;
            }
          },
        };
      })(),
      capUsd: Number(process.env.BANK_CAP ?? "0.04"),
      ids: () => newId(),
      onEvent: (e: { costUsd?: number }) => {
        bankCost += e.costUsd ?? 0;
        appendFileSync(bankLog, `${JSON.stringify({ t: Date.now(), ...e })}\n`);
      },
    });
    console.error(
      `bank ON: library in ${process.env.BANK_DB.replace(/\/\/[^@]*@/, "//***@")}, cap $${process.env.BANK_CAP ?? "0.04"}`,
    );
  }
  console.error(`images ON: Pexels placer, photos under ${root}`);
}

// --look-check (lab/cand-fix look check, 5 Oct): plan-write renders its slides through the lab's own
// renderer (lab/visual/harness/render.ts: seed-library + the presenter's printed state at 1440x810,
// on the stack at VISUAL_API / VISUAL_WEB) and checks each image. Slides are split over up to three
// render processes. Every round's PNGs and the lesson snapshot stay under <out>/look/<brief>/r<k>.
const lookCheck = argv.includes("--look-check");
if (lookCheck) argv.splice(argv.indexOf("--look-check"), 1);
const VISUAL = resolve(
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/fit-lab/harness",
  "../../visual",
);
const RENDER_PROCS = 3;
let lookBrief = "";
let lookRound = 0;
const renderSlides = async (
  l: { slides: unknown[]; brief?: Record<string, unknown> },
  indices: number[],
) => {
  const round = `${outDir}/look/${lookBrief}/r${++lookRound}`;
  mkdirSync(round, { recursive: true });
  const body = JSON.parse(JSON.stringify(l));
  if (body.brief) delete body.brief.exitTicketOnSlides;
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const per = Math.ceil(sorted.length / RENDER_PROCS);
  const chunks = Array.from({ length: Math.ceil(sorted.length / per) }, (_, i) =>
    sorted.slice(i * per, (i + 1) * per),
  );
  const out = new Map<number, string>();
  // Parallel sign-ins on one stack collide (same-millisecond email, INVALID_TOKEN): stagger the
  // processes, then render any slide still missing once more in one process.
  const renderChunk = async (chunk: number[], c: string, delayMs: number) => {
    await Bun.sleep(delayMs);
    const dir = `${round}/c${c}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/deck.lesson.json`, JSON.stringify(body));
    const proc = Bun.spawn(["bun", "harness/render.ts", `${dir}/png`, `${dir}/deck.lesson.json`], {
      cwd: VISUAL,
      env: { ...process.env, ONLY: chunk.map((i) => i + 1).join(",") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    if (err.trim()) appendFileSync(`${round}/render.err`, err);
    chunk.forEach((index, k) => {
      const f = `${dir}/png/deck/slide-${String(k + 1).padStart(2, "0")}.png`;
      if (!existsSync(f)) return;
      const bytes = readFileSync(f);
      writeFileSync(`${round}/s${String(index + 1).padStart(2, "0")}.png`, bytes);
      out.set(index, `data:image/png;base64,${bytes.toString("base64")}`);
    });
  };
  await Promise.all(chunks.map((chunk, c) => renderChunk(chunk, String(c), c * 3000)));
  const missing = sorted.filter((i) => !out.has(i));
  if (missing.length > 0) await renderChunk(missing, "retry", 0);
  console.error(`look render ${lookBrief} r${lookRound}: ${out.size}/${sorted.length} slides`);
  return out;
};

const AI_LOGGER = process.env.AI_LOG_FILE
  ? pino({ level: "info" }, pino.destination({ dest: process.env.AI_LOG_FILE, sync: true }))
  : undefined;
const MODEL = "openai/gpt-6-luna";
const ai = createAi(
  {
    OPENAI_API_KEY: readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim(),
    AI_MODEL_FRONTIER: MODEL,
    AI_MODEL_STANDARD: MODEL,
    AI_MODEL_SMALL: MODEL,
  },
  planner === "plan-write" && process.env.PLAN_WRITE_PLANNER_MODEL
    ? // As the worker's deps.ts: plan-write routes its planner call to PLAN_WRITE_PLANNER_MODEL.
      {
        logger: AI_LOGGER,
        route: ((r) => (cls: unknown, ctx: { promptVersion?: string } | undefined) => {
          const m = r(cls, ctx);
          if (m) console.error(`route ${ctx?.promptVersion} -> ${m}`);
          return m;
        })(planWriteRoute(process.env.PLAN_WRITE_PLANNER_MODEL)),
      }
    : { logger: AI_LOGGER },
);
if (planner === "plan-write")
  console.error(`plan-write planner model: ${process.env.PLAN_WRITE_PLANNER_MODEL ?? "(default)"}`);
// The per-lesson guard (--reserve, default 0.02): a lesson is refused when total + reserve > cap.
const RESERVE = Number(opt("--reserve") ?? "0.02");

// Concurrent runs (several fit-drive processes on one --budget-file): an admitted lesson holds its
// reserve in reserved_usd until its actual cost is booked, so parallel lessons cannot jointly
// overshoot the cap by more than their actual-over-reserve.
type Ledger = {
  cap_usd: number;
  total_usd: number;
  reserved_usd?: number;
  lessons: Record<string, unknown>[];
};
const lock = `${budgetFile}.lock`;
async function withLedger<T>(fn: (l: Ledger) => T): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (i > 600) throw new Error(`budget lock stuck: ${lock}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    const l: Ledger = existsSync(budgetFile)
      ? JSON.parse(readFileSync(budgetFile, "utf8"))
      : { cap_usd: cap, total_usd: 0, lessons: [] };
    const out = fn(l);
    mkdirSync(resolve(budgetFile, ".."), { recursive: true });
    writeFileSync(budgetFile, JSON.stringify(l, null, 1));
    return out;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

let n = 0;
const ids = () => `f${(++n).toString(36)}${Date.now().toString(36)}`;

async function run(briefPath: string) {
  const briefId = basename(briefPath).replace(/\.json$/, "");
  const admitted = await withLedger((l) => {
    const ok = l.total_usd + (l.reserved_usd ?? 0) + RESERVE <= cap + 1e-9;
    if (ok) l.reserved_usd = Math.round(((l.reserved_usd ?? 0) + RESERVE) * 1e6) / 1e6;
    return ok;
  });
  if (!admitted) {
    console.error(
      `REFUSED ${briefId}: running total + in-flight reserves + ${RESERVE} would exceed cap $${cap} (${budgetFile})`,
    );
    return false;
  }
  const raw = JSON.parse(readFileSync(briefPath, "utf8"));
  for (const k of Object.keys(raw)) if (k.startsWith("_")) delete raw[k];
  const label = `${labelTag}-${briefId}`;
  lookBrief = briefId;
  lookRound = 0;
  let lesson = lessonFromBrief(raw, `fit-${label}-${Date.now().toString(36)}`, new Date());
  const logs: Record<string, unknown>[] = [];
  const t0 = Date.now();
  const marks = {
    title: null as number | null,
    firstSlot: null as number | null,
    editable: null as number | null,
  };
  // Per-slide visible times (FINAL-ROUND-SPEC, 30 Sep), seconds from the start, from the saves:
  // slides are saved in order, so slide k is visible at the first save holding k slides.
  const requested = Number(raw.slideCount ?? 10);
  const vis = {
    title: null as number | null,
    first: null as number | null,
    mid: null as number | null,
    last: null as number | null,
  };
  const midAt = Math.ceil(requested / 2);
  let planWrite: Record<string, unknown> | null = null;
  let streamHeaderMs: number | null = null;
  const logFile = `${outDir}/${briefId}.log.jsonl`;
  writeFileSync(logFile, "");
  const mk = (phase: string) => ({
    ai,
    budget: createBudget(
      { capUsd: LESSON_CAP_USD, capTokens: LESSON_CAP_TOKENS },
      lesson.generation?.usage ? { spent: lesson.generation.usage } : {},
    ),
    // Low everywhere, except a call that asks for medium Verify (the designer's post-save Verify).
    // The look check asks medium (look-check.v2): kept, as verify-facts' medium is.
    effortFor: (_stage: string, name: string, asked: string) =>
      (name === "verify-facts" || name.startsWith("look-check")) && asked === "medium"
        ? "medium"
        : "low",
    signal: new AbortController().signal,
    logger: pino(
      { level: "info" },
      new Writable({
        write(chunk, _e, cb) {
          for (const line of chunk.toString().split("\n").filter(Boolean)) {
            const r = JSON.parse(line);
            appendFileSync(logFile, `${JSON.stringify({ phase, ...r })}\n`);
            if (
              r.msg === "generation summary" ||
              r.msg === "slide continued" ||
              (typeof r.msg === "string" && r.msg.startsWith("callout dropped"))
            )
              logs.push({
                phase,
                msg: r.msg,
                index: r.index,
                stage: r.stage,
                generation: r.generation,
              });
            if (r.msg === "plan-write report") planWrite = r.planWrite;
            if (r.msg === "stream header") streamHeaderMs = r.ms;
            if (r.level >= 50) process.stderr.write(`${label} ${phase} ${r.msg}\n`);
          }
          cb();
        },
      }),
    ),
    now: () => new Date(),
    ids,
    sources: noSources,
    persist: async (l: typeof lesson) => {
      lesson = l;
      const at = (Date.now() - t0) / 1000;
      if (marks.title === null && l.slides.length >= 1) marks.title = at;
      if (marks.firstSlot === null && l.slides.length >= 4) marks.firstSlot = at;
      if (vis.title === null && l.slides.length >= 1) vis.title = at;
      if (vis.first === null && l.slides.length >= 2) vis.first = at;
      if (vis.mid === null && l.slides.length >= midAt) vis.mid = at;
      if (vis.last === null && l.slides.length >= requested) vis.last = at;
      if (marks.editable === null && l.generation?.stage === "generated") marks.editable = at;
      return { updatedAt: new Date().toISOString() };
    },
    onProgress: async () => undefined,
    context: { lessonId: lesson.id, jobId: `${label}-${phase}` },
    ...(photoPlacer ? { images: photoPlacer } : {}),
    ...(lookCheck ? { renderSlides } : {}),
  });
  let error = "";
  let objectivesS: number | null = null;
  let generateS: number | null = null;
  try {
    if (planner === "designer" || planner === "plan-write") {
      // One pass: plan-write (spike/plan-write) plans, checks and writes with no plan-screen stop.
      const deps = mk("generate");
      const gen = await runLessonPipeline({ lesson }, deps, { planner });
      lesson = gen.lesson;
      generateS = (Date.now() - t0) / 1000;
    } else {
      const plan = await runLessonPipeline({ lesson }, mk("plan"), {
        stopAfter: "planned",
        planner: "objectives-first",
      });
      lesson = plan.lesson;
      objectivesS = (Date.now() - t0) / 1000;
      lesson = { ...lesson, plan: { ...(lesson.plan ?? { revision: 1 }), state: "confirmed" } };
      const deps = mk("generate");
      const t1 = Date.now();
      const gen = await runLessonPipeline({ lesson: withPlanSlides(lesson, deps) }, deps);
      lesson = gen.lesson;
      generateS = (Date.now() - t1) / 1000;
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "Error";
  }
  const doneS = (Date.now() - t0) / 1000;
  const summary = (logs.find((l) => l.phase === "generate" && l.msg === "generation summary")
    ?.generation ?? {}) as {
    readableMs?: number;
    fit?: { designer?: unknown };
  };
  const designer = summary.fit?.designer;
  if (designer)
    writeFileSync(
      `${outDir}/${briefId}.designer.json`,
      JSON.stringify({ ...designer, marks }, null, 1),
    );
  const usage = lesson.generation?.usage ?? {};
  const cost = typeof usage.costUsd === "number" ? usage.costUsd : null;
  const row = {
    brief: briefId,
    worktree: wt,
    cost_usd: cost,
    latency_s:
      planner === "designer" || planner === "plan-write"
        ? marks.editable
        : objectivesS !== null && typeof summary.readableMs === "number"
          ? Math.round((objectivesS + summary.readableMs / 1000) * 10) / 10
          : null,
    calls: usage.calls ?? null,
    planner,
    title_s: marks.title,
    first_slot_s: marks.firstSlot,
    editable_s: marks.editable,
    objectives_s: objectivesS,
    generate_s: generateS,
    tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    stage: lesson.generation?.stage ?? null,
    slides: lesson.slides.length,
    images: photoPlacer ? ((summary as { images?: unknown }).images ?? null) : "off",
    calloutDropsLogged: logs.filter((l) => String(l.msg).startsWith("callout dropped")).length,
    deck: `${outDir}/${briefId}.lesson.json`,
    promptVersions: lesson.generation?.promptVersions,
    error,
  };
  writeFileSync(row.deck, JSON.stringify(lesson, null, 1));
  // Overflow after Tidy on every theme: fit-score on this deck, measured by this worktree's ruler.
  const scoreFile = `${outDir}/${briefId}.score.json`;
  const scored = Bun.spawnSync(
    [
      "bun",
      "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/fit-lab/harness/fit-score.ts",
      "--worktree",
      wt,
      "--out",
      scoreFile,
      row.deck,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  let overflowByTheme: Record<string, number> | null = null;
  if (scored.exitCode === 0 && existsSync(scoreFile)) {
    const sc = JSON.parse(readFileSync(scoreFile, "utf8"))[0] as {
      themes: { theme: string; overflowAfterTidy: number }[];
    };
    overflowByTheme = Object.fromEntries(sc.themes.map((t) => [t.theme, t.overflowAfterTidy]));
  }
  const pw = planWrite as {
    slides?: { fits: boolean; rewritten?: unknown }[];
    delivered?: number;
    mode?: string;
    checksDoneMs?: number;
    photosDoneMs?: number;
    checks?: unknown;
    photoReady?: unknown;
    noPicture?: number[];
    lessonPass?: number;
  } | null;
  // Empty picture slots left in the saved deck (spike/parallel-slides): a placeholder photo, or a
  // diagram slot whose drawing never landed (the slide still carries its `diagram` brief).
  const { PLACEHOLDER_IMAGE } = await import(`${wt}/packages/slides/src/index.ts`);
  const emptySlots = lesson.slides.flatMap((s, i) => {
    const photo = s.elements.some(
      (e) => e.type === "image" && (e as { src?: string }).src === PLACEHOLDER_IMAGE,
    );
    const diagram = (s as { diagram?: unknown }).diagram !== undefined;
    return photo || diagram ? [{ slide: i + 1, photo, diagram }] : [];
  });
  Object.assign(row, {
    mode: pw?.mode ?? process.env.PLAN_WRITE_MODE ?? null,
    model: process.env.PLAN_WRITE_PLANNER_MODEL ?? MODEL,
    visible_s: {
      title: vis.title,
      first_content: vis.first,
      midpoint: vis.mid,
      last: vis.last,
      editable: marks.editable,
      checks_done: pw?.checksDoneMs === undefined ? null : pw.checksDoneMs / 1000,
      photos_done: pw?.photosDoneMs === undefined ? null : pw.photosDoneMs / 1000,
      done: error ? null : doneS,
    },
    slide_checks: pw?.checks ?? null,
    photo_ready: pw?.photoReady ?? null,
    no_picture: pw?.noPicture ?? null,
    lesson_pass_faults: pw?.lessonPass ?? null,
    empty_slots: emptySlots,
    stream_header_s: streamHeaderMs === null ? null : streamHeaderMs / 1000,
    tokens_in: usage.inputTokens ?? null,
    tokens_out: usage.outputTokens ?? null,
    requested,
    delivered: pw?.delivered ?? lesson.slides.length,
    fit_first_time: pw?.slides
      ? `${pw.slides.filter((x) => x.fits && !x.rewritten).length}/${pw.slides.length}`
      : null,
    overflow_after_tidy: overflowByTheme,
    overflow_total: overflowByTheme
      ? Object.values(overflowByTheme).reduce((a, b) => a + b, 0)
      : null,
  });
  Object.assign(row, { bank_cost_usd: bankCost, t0 });
  appendFileSync(`${outDir}/rows.jsonl`, `${JSON.stringify(row)}\n`);
  await withLedger((l) => {
    // Unknown cost counts as the full reserve, so the guard never under-counts.
    l.total_usd = Math.round((l.total_usd + (cost ?? RESERVE) + bankCost) * 1e6) / 1e6;
    l.reserved_usd = Math.max(0, Math.round(((l.reserved_usd ?? 0) - RESERVE) * 1e6) / 1e6);
    l.lessons.push({
      brief: briefId,
      tag: labelTag,
      cost_usd: cost,
      bank_cost_usd: bankCost,
      at: new Date().toISOString(),
      error,
    });
  });
  console.log(JSON.stringify({ ...row, promptVersions: undefined }));
  return true;
}

for (const b of briefs) await run(resolve(b));
process.exit(0);
