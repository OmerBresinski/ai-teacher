#!/usr/bin/env bun
/**
 * The teacher's path check (TEACH-227 part b). See README.md.
 *
 *   bun tools/teacher-path/run.ts --stop-usd 49.80 --spend <SPEND.md> [--briefs 1,2] [--who guest,signed-in]
 *   bun tools/teacher-path/run.ts --mode cheap --recording <run>/recording [--briefs 1]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Analysis, analyse, checkObjectives } from "./lib/lesson";
import { ledgerRow, ledgerTotal, logSize, spentInLog } from "./lib/spend";
import { fromWeb, preflight, prepareDatabase, ROOT, startStack } from "./lib/stack";
import {
  type Brief,
  record,
  replayPath,
  type TeacherRun,
  teacherPath,
  type Who,
} from "./lib/teacher";

const HARD_STOP = 49.8;
const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "paid" },
    briefs: { type: "string" },
    who: { type: "string", default: "guest,signed-in" },
    "stop-usd": { type: "string" },
    spend: { type: "string" },
    recording: { type: "string" },
    out: { type: "string" },
    config: { type: "string", default: join(import.meta.dir, "config.json") },
    label: { type: "string", default: "" },
    "no-objective-check": { type: "boolean", default: false },
  },
});

type Config = {
  ports: { api: number; worker: number; web: number };
  forbiddenPorts: number[];
  databaseUrl: string;
  checkModel: string;
  checkModelPriceId: string;
  lessonTimeoutS: number;
  ceilingPerLessonUsd: { ai: number; images: number; check: number };
  teachingKindsExcluded: string[];
  ignoreNetwork: string[];
  workerEnv: Record<string, string>;
  thresholds: Record<string, number | boolean>;
  briefs: Brief[];
};
const config = JSON.parse(readFileSync(args.config, "utf8")) as Config;
// `fake` walks the same path over the worker's scripted fake: a free check of this tool itself.
const fake = args.mode === "fake";
const paid = args.mode === "paid";
const generates = paid || fake;
if (!generates && args.mode !== "cheap")
  throw new Error(`--mode ${args.mode}: paid, cheap or fake`);

const pick = (args.briefs ?? config.briefs.map((_, i) => String(i + 1)).join(","))
  .split(",")
  .map((b) => config.briefs[Number(b) - 1] ?? config.briefs.find((x) => x.id === b));
if (pick.some((b) => !b)) throw new Error(`--briefs ${args.briefs}: unknown brief`);
const briefs = pick as Brief[];
const whos = (args.who ?? "").split(",").filter(Boolean) as Who[];
if (whos.some((w) => w !== "guest" && w !== "signed-in")) throw new Error("--who guest,signed-in");

let stop = 0;
let ledger = "";
if (paid) {
  stop = Number(args["stop-usd"]);
  if (!Number.isFinite(stop) || stop <= 0) throw new Error("paid mode needs --stop-usd");
  if (stop > HARD_STOP) throw new Error(`--stop-usd ${stop} is above $${HARD_STOP}: refused`);
  ledger = resolve(args.spend ?? "");
  if (!args.spend || !existsSync(ledger)) throw new Error("paid mode needs --spend <ledger.md>");
}
const key = (name: string, env: string) =>
  process.env[env] ??
  (existsSync(join(homedir(), name)) ? readFileSync(join(homedir(), name), "utf8").trim() : "");
const openaiKey = key(".dayback-openai-key", "OPENAI_API_KEY");
const pexelsKey = key(".dayback-pexels-key", "PEXELS_API_KEY");
if (paid && !openaiKey)
  throw new Error("paid mode needs OPENAI_API_KEY (or ~/.dayback-openai-key)");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = resolve(args.out ?? join(ROOT, ".data/teacher-path", stamp));
const logDir = join(out, "logs");
mkdirSync(logDir, { recursive: true });
const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT })
  .stdout.toString()
  .trim();
const ceiling = (c: Config["ceilingPerLessonUsd"]) => c.ai + c.images + c.check;
const lessons = briefs.length * (generates ? whos.length : 1);
const tag = `teacher-path ${args.label || stamp} (${commit}, ${args.mode}, ${briefs.map((b) => b.id).join(" ")} x ${paid ? whos.join("+") : "signed-in"})`;

await preflight(config.ports, config.forbiddenPorts, config.databaseUrl);
await prepareDatabase(config.databaseUrl, logDir);
if (paid) {
  const expected = lessons * 0.2;
  ledgerRow(
    ledger,
    `${tag} BEFORE: up to ${lessons} lessons through the real web app, api and worker (ports ${config.ports.api}-${config.ports.web}), ceiling $${ceiling(config.ceilingPerLessonUsd).toFixed(2)} a lesson, expected about $${expected.toFixed(2)}; stop $${stop.toFixed(2)} checked before every lesson`,
    0,
  );
}

const stack = await startStack({
  ports: config.ports,
  databaseUrl: config.databaseUrl,
  logDir,
  storageRoot: join(out, "storage"),
  paid,
  fake,
  workerEnv: config.workerEnv,
  openaiKey,
  pexelsKey,
  imageCapUsd: config.ceilingPerLessonUsd.images * lessons,
  lessonCapUsd: config.ceilingPerLessonUsd.ai,
});

type Row = TeacherRun & {
  analysis: Analysis | null;
  spendUsd: { llm: number; images: number; check: number; total: number };
};
const rows: Row[] = [];
let spent = 0;
const { chromium } = fromWeb("@playwright/test");
const browser = await chromium.launch();
try {
  for (const brief of briefs) {
    for (const who of generates ? whos : (["signed-in"] as Who[])) {
      const dir = join(out, `${brief.id}-${who}`);
      if (paid) {
        const room = ledgerTotal(ledger) + spent + ceiling(config.ceilingPerLessonUsd);
        if (room > stop) {
          console.log(
            `skip ${brief.id} ${who}: ledger + spent + ceiling $${room.toFixed(2)} > stop`,
          );
          continue;
        }
      }
      console.log(`${brief.id} ${who}: starting`);
      const from = logSize(stack.workerLog);
      const run = generates
        ? await teacherPath({
            browser,
            stack,
            brief,
            who,
            outDir: dir,
            timeoutS: config.lessonTimeoutS,
            ignoreNetwork: config.ignoreNetwork,
          })
        : await replayPath({
            browser,
            stack,
            brief,
            recording: join(resolve(args.recording ?? ""), `${brief.id}-signed-in`),
            outDir: dir,
            ignoreNetwork: config.ignoreNetwork,
          });
      // Let the worker finish writing its last lines (notes, cost) before the log is read.
      await Bun.sleep(paid ? 3_000 : 0);
      const to = logSize(stack.workerLog);
      const log = spentInLog(stack.workerLog, from, to);
      const docUsage = Number(run.doc?.generation?.usage?.costUsd ?? 0);
      const row: Row = {
        ...run,
        analysis: null,
        spendUsd: { llm: Math.max(log.llm, docUsage), images: log.images, check: 0, total: 0 },
      };
      if (run.doc) {
        const recorded = generates
          ? null
          : join(resolve(args.recording ?? ""), `${brief.id}-signed-in`, "go.txt");
        const goMs =
          recorded && existsSync(recorded)
            ? Date.parse(readFileSync(recorded, "utf8"))
            : Date.parse(run.goAt ?? new Date().toISOString());
        row.analysis = analyse({
          doc: run.doc,
          requested: brief.slideCount,
          goMs,
          excludedKinds: config.teachingKindsExcluded,
          workerLog: generates ? { path: stack.workerLog, from, to } : undefined,
        });
        if (
          !args["no-objective-check"] &&
          !fake &&
          openaiKey &&
          row.analysis.objectives.length > 0
        ) {
          try {
            row.analysis.coverageModel = await checkObjectives({
              doc: run.doc,
              objectives: row.analysis.objectives,
              model: config.checkModel,
              priceId: config.checkModelPriceId,
              apiKey: openaiKey,
            });
            row.spendUsd.check = row.analysis.coverageModel.costUsd;
          } catch (e) {
            row.analysis.coverageModel = {
              perObjective: [],
              covered: 0,
              costUsd: 0.02,
              note: String(e).slice(0, 200),
            };
            row.spendUsd.check = 0.02;
          }
        }
        if (generates) {
          record(run, stack.storageRoot, join(out, "recording", `${brief.id}-${who}`));
          writeFileSync(join(out, "recording", `${brief.id}-${who}`, "go.txt"), run.goAt ?? "");
        }
      }
      row.spendUsd.total = row.spendUsd.llm + row.spendUsd.images + row.spendUsd.check;
      spent += row.spendUsd.total;
      rows.push(row);
      writeFileSync(join(dir, "lesson.json"), JSON.stringify(run.doc ?? null, null, 2));
      console.log(
        `${brief.id} ${who}: done=${run.times.doneS}s spend $${row.spendUsd.total.toFixed(4)}`,
      );
    }
  }
} finally {
  await browser.close();
  stack.stop();
  // Model calls the api made itself (objectives, check-input) count too.
  const apiSpend = spentInLog(join(logDir, "api.log"));
  spent += apiSpend.llm + apiSpend.images;
  if (paid) {
    ledgerRow(
      ledger,
      `${tag} AFTER (${out}): ${rows.length} lessons; worker and api calls priced from their log lines (an unpriced call at $0.02), pictures from the generator's log, objective check $${rows.reduce((a, r) => a + r.spendUsd.check, 0).toFixed(4)}`,
      spent,
    );
  }
  const results = {
    commit,
    mode: args.mode,
    startedAt: stamp,
    out,
    thresholds: config.thresholds,
    spendUsd: spent,
    runs: rows.map(({ doc: _doc, ...r }) => ({ ...r, checks: verdicts(r) })),
  };
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(out, "report.md"), report(results));
  console.log(`report: ${join(out, "report.md")}`);
}

type Verdict = { item: string; pass: boolean | null; value: string };
function verdicts(r: Row): Verdict[] {
  const t = config.thresholds;
  const a = r.analysis;
  const time = (item: string, v: number | null): Verdict =>
    r.mode === "cheap" && item !== "firstVisibleSlideS" && item !== "firstEditableS"
      ? { item, pass: null, value: "n/a (cheap mode)" }
      : {
          item,
          pass: v !== null && v <= Number(t[item]),
          value: v === null ? "never" : `${v.toFixed(1)} s`,
        };
  const typed = r.edits.filter((e) => e.typedAtS !== null);
  const covered = a?.coverageModel;
  return [
    time("firstVisibleSlideS", r.times.firstVisibleSlideS),
    time("firstEditableS", r.times.firstEditableS),
    time("allEditableS", r.times.allEditableS),
    time("picturesInS", r.times.picturesInS),
    time("doneS", r.times.doneS),
    {
      item: "editSaves",
      pass: typed.length > 0 && typed.every((e) => e.kept),
      value: typed.length
        ? typed.map((e) => `${e.marker} ${e.kept ? "kept" : "LOST"}`).join(", ")
        : "no edit could be typed",
    },
    {
      item: "noFailedWrites",
      pass: r.failedWrites.length === 0,
      value: r.failedWrites.length
        ? `${r.failedWrites.length}: ${[...new Set(r.failedWrites)].slice(0, 3).join("; ")}`
        : "none",
    },
    { item: "exportPdf", pass: r.exportPdf.ok, value: r.exportPdf.note },
    {
      item: "slidesDeliveredMatchRequested",
      pass: a ? a.slidesDelivered === a.slidesRequested : false,
      value: a ? `${a.slidesDelivered} of ${a.slidesRequested}` : "no lesson",
    },
    {
      item: "stockPicturesMin",
      pass: a ? a.pictureCounts.stock >= Number(t.stockPicturesMin) : false,
      value: a
        ? Object.entries(a.pictureCounts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k} ${n}`)
            .join(", ") || "no pictures"
        : "no lesson",
    },
    {
      item: "figuresDroppedMax",
      pass: a?.figuresDropped ? a.figuresDropped.length <= Number(t.figuresDroppedMax) : null,
      value: a?.figuresDropped
        ? a.figuresDropped.length
          ? a.figuresDropped.map((f) => `slide ${f.slide} ${f.path}`).join(", ")
          : "0"
        : "n/a (no worker log in cheap mode)",
    },
    {
      item: "textOnlyTeachingMax",
      pass: a ? a.textOnlyTeaching.length <= Number(t.textOnlyTeachingMax) : false,
      value: a
        ? a.textOnlyTeaching.length
          ? `slides ${a.textOnlyTeaching.join(", ")}`
          : "0"
        : "no lesson",
    },
    {
      item: "objectivesCoveredShare",
      pass:
        covered && a?.objectives.length
          ? covered.covered / a.objectives.length >= Number(t.objectivesCoveredShare)
          : null,
      value:
        covered && a
          ? `${covered.covered} of ${a.objectives.length} taught and checked (model, $${covered.costUsd.toFixed(4)}); code: ${a.coverageCode.checked ? `${a.coverageCode.uncovered.length} uncovered` : a.coverageCode.note}`
          : "not checked",
    },
    {
      item: "consoleErrorsMax",
      pass: r.consoleErrors.length <= Number(t.consoleErrorsMax),
      value: String(r.consoleErrors.length),
    },
    {
      item: "networkErrorsMax",
      pass: r.networkErrors.length <= Number(t.networkErrorsMax),
      value: String(r.networkErrors.length),
    },
  ];
}

function report(results: {
  commit: string;
  mode: string | undefined;
  out: string;
  spendUsd: number;
  runs: (Omit<Row, "doc"> & { checks: Verdict[] })[];
}): string {
  const mark = (v: Verdict) => (v.pass === null ? "n/a" : v.pass ? "PASS" : "**FAIL**");
  const head = results.runs.map((r) => `${r.brief} (${r.who})`);
  const items = results.runs[0]?.checks.map((c) => c.item) ?? [];
  const lines = [
    `# Teacher's path: ${results.commit}, ${results.mode} mode`,
    "",
    `Worker settings: ${JSON.stringify(config.workerEnv)}. Output: \`${results.out}\`. Spend this run: $${results.spendUsd.toFixed(4)}. Thresholds: \`tools/teacher-path/config.json\`.`,
    "",
    `| check | threshold | ${head.join(" | ")} |`,
    `| --- | --- | ${head.map(() => "---").join(" | ")} |`,
    ...items.map(
      (item, k) =>
        `| ${item} | ${config.thresholds[item]} | ${results.runs
          .map((r) => {
            const c = r.checks[k];
            return c ? `${mark(c)} ${c.value}` : "";
          })
          .join(" | ")} |`,
    ),
    "",
  ];
  for (const r of results.runs) {
    const a = r.analysis;
    lines.push(
      `## ${r.brief} (${r.who})`,
      "",
      `- Lesson ${r.lessonId ?? "none"}; go at ${r.goAt ?? "-"}; objectives shown after ${r.times.objectivesShownS?.toFixed(1) ?? "-"} s${r.yearSeeded ? "; the year group is not offered by the brief screen, so it was seeded as the remembered class" : ""}.`,
      `- Spend: model $${r.spendUsd.llm.toFixed(4)}, pictures $${r.spendUsd.images.toFixed(4)}, objective check $${r.spendUsd.check.toFixed(4)}.`,
      `- Save indicator after the edits: ${r.saveStateAfterEdits ?? "not found"}.`,
      ...(r.error ? [`- Error: ${r.error}`] : []),
    );
    if (a) {
      lines.push(
        `- Pictures: ${a.pictures.map((p) => `s${p.slide} ${p.source}`).join(", ") || "none"}.`,
        `- Objectives: ${a.objectives.map((o, i) => `${i + 1}. ${o}`).join(" ")}`,
        ...(a.coverageModel?.perObjective ?? []).map(
          (o) =>
            `  - Objective ${o.objective}: taught on ${o.taughtOn.join(", ") || "none"}; checked on ${o.checkedOn.join(", ") || "none"}.`,
        ),
      );
    }
    const uniq = (xs: string[]) => [...new Set(xs)].slice(0, 8);
    if (r.networkErrors.length)
      lines.push(
        `- Network errors: ${uniq(r.networkErrors)
          .map((x) => `\`${x}\``)
          .join(", ")}`,
      );
    if (r.consoleErrors.length)
      lines.push(
        `- Console errors: ${uniq(r.consoleErrors)
          .map((x) => `\`${x.slice(0, 120)}\``)
          .join(", ")}`,
      );
    lines.push(`- Screenshots: ${r.screenshots.length} in \`${r.brief}-${r.who}/slides/\`.`, "");
  }
  return lines.join("\n");
}
