#!/usr/bin/env bun
// bun packages/generation/eval/facts-bench.ts --models <id,…> --label <name> --briefs <file,…>
//   --fixture <objectives.json> [--sources <briefBasename>:<file>,…] [--repeat N] [--effort low|medium|high]
//   [--budget 0.35] [--concurrency 6] [--dry-run]
//
// The per-objective facts call (plan-facts-objective.v<n>): one call per confirmed objective, the
// calls through a pool of --concurrency, so a lesson's facts land in about the time of its slowest
// single call. Records per-call latency, tokens and list cost, the lesson's wall time (first start
// to last end of its calls), and writes the merged facts per lesson for hand grading. One budget
// for the run: every call reserves its worst case before it is sent. Never a full lesson.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type CreatedAi, costUsd, createAi, createBudget } from "@tj/ai";
import { CreateLessonSchema, lessonFromBrief } from "@tj/domain/documents";
import pino from "pino";
import { callStructured } from "../src/call";
import { mergeObjectiveFacts } from "../src/merge-objective-facts";
import {
  type PlanFactsObjectiveInput,
  type PlanFactsObjectiveOutput,
  planFactsObjectiveOutputSchemaFor,
  planFactsObjectivePrompt,
} from "../src/prompts/plan-facts-objective";
import { audienceOf, shapeOf } from "../src/stages/shared";
import { callUsageOf, createLedger, type Ledger, meteringAi } from "./ledger";
import { DEFAULT_CONCURRENCY, mapPool } from "./pool";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const models = (arg("models") ?? "").split(",").filter(Boolean);
const label = arg("label") ?? "facts";
const fixturePath = arg("fixture");
if (!models.length || !fixturePath) {
  console.error(
    "usage: facts-bench.ts --models <id,…> --label <name> --briefs <file,…> --fixture <objectives.json> …",
  );
  process.exit(2);
}
const effort = (arg("effort") ?? "medium") as "low" | "medium" | "high";
const budgetUsd = Number(arg("budget") ?? 0.35);
const concurrency = Number(arg("concurrency") ?? DEFAULT_CONCURRENCY);
const repeat = Number(arg("repeat") ?? 1);
const softFirst = process.env.SOFT_FIRST !== "0";
const briefPaths = (arg("briefs") ?? "").split(",").filter(Boolean);
const sourceSpecs = (arg("sources") ?? "")
  .split(",")
  .filter(Boolean)
  .map((spec) => {
    const [base, file] = spec.split(":");
    if (!base || !file) throw new Error(`--sources: ${spec}`);
    return { base, file };
  });

type Fixture = Record<string, { objectives: { text: string }[] }>;
const fixture: Fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));

type Brief = {
  id: string;
  lesson: ReturnType<typeof lessonFromBrief>;
  shape: ReturnType<typeof shapeOf>;
  audience: ReturnType<typeof audienceOf>;
  objectives: { text: string }[];
  curriculum?: { text: string } | undefined;
};
const briefs: Brief[] = [];
for (const path of briefPaths) {
  const input = CreateLessonSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
  const id =
    path
      .split("/")
      .pop()
      ?.replace(/\.json$/, "") ?? path;
  const lesson = lessonFromBrief(input, `facts-${id}`, new Date());
  const fx = fixture[id];
  if (!fx) throw new Error(`fixture has no objectives for ${id}`);
  const src = sourceSpecs.find((s) => s.base === id || s.base === `${id}.json`);
  briefs.push({
    id,
    lesson,
    shape: shapeOf(lesson),
    audience: audienceOf(lesson),
    objectives: fx.objectives,
    curriculum: src ? { text: await readFile(resolve(src.file), "utf8") } : undefined,
  });
}

const dir = join(import.meta.dir, "results", "lab", `facts-${label}`);
await mkdir(dir, { recursive: true });
const calls = briefs.reduce((n, b) => n + b.objectives.length, 0) * models.length * repeat;
console.log(
  `prompt ${planFactsObjectivePrompt.version}; effort ${effort}; repeat ${repeat}; budget $${budgetUsd} for the run; ${concurrency} in flight; ${calls} calls`,
);
for (const b of briefs)
  console.log(
    `  ${b.id}: ${b.lesson.subject} ${b.lesson.yearGroup}, verb ${b.shape.verb}, ${b.objectives.length} objectives, source ${b.curriculum ? "yes" : "no"}`,
  );
console.log(`  models: ${models.join(", ")}`);
if (flag("dry-run")) process.exit(0);

type Row = {
  brief: string;
  model: string;
  repeat: number;
  objective: number;
  ok: boolean;
  ms: number;
  startedAt: number;
  endedAt: number;
  in?: number;
  out?: number;
  cost?: number;
  attempts?: number;
  /** Set when the first send failed at the transport and the call was re-sent. */
  resent?: boolean;
  /** Length caps the answer broke and the soft schema let through. */
  editorialMisses?: unknown[];
  output?: unknown;
  error?: string;
};
type Group = {
  brief: string;
  model: string;
  repeat: number;
  wallMs: number;
  cost: number;
  ok: boolean;
  /** Vocabulary terms `mergeObjectiveFacts` dropped as repeats across the lesson's calls (v7 metric). */
  duplicateTerms: number;
};
const rows: Row[] = [];
const groups: Group[] = [];

function causeChain(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; cur && i < 4; i++) {
    if (Array.isArray(cur)) {
      parts.push(`issues: ${cur.map(String).join("; ")}`);
      break;
    }
    const err = cur as { message?: string; cause?: unknown };
    if (err.message) parts.push(String(err.message));
    cur = err.cause;
  }
  return parts.join(" <- ");
}

/** A provider/transport failure (not a schema miss): re-sent once, as production would. */
function isTransport(e: unknown): boolean {
  const text = causeChain(e);
  return !text.includes("did not produce a valid") && !text.includes("Budget");
}

type Cell = { b: Brief; rep: number; model: string; target: number };
const cellsToRun: Cell[] = [];
for (const model of models)
  for (const b of briefs)
    for (let rep = 1; rep <= repeat; rep++)
      for (let target = 0; target < b.objectives.length; target++)
        cellsToRun.push({ b, rep, model, target });
const ledgers = new Map(models.map((m) => [m, createLedger()] as const));
// One client per model, its calls metered into that model's ledger.
const ais = new Map(
  models.map((model) => {
    const ai = createAi({
      AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
      AI_MODEL_STANDARD: model,
    });
    if (ai.kind === "unconfigured") throw new Error("set AI_GATEWAY_API_KEY");
    return [model, meteringAi(ai, ledgers.get(model) as Ledger)] as const;
  }),
);
// One budget for the whole run: before a call is sent it reserves its worst case (the input
// estimate plus `maxOutputTokens`, at list price) and settles what it used on completion; a
// call whose reservation does not fit is refused, and none starts once the budget is exceeded.
const budget = createBudget({ capUsd: budgetUsd, capTokens: 40_000 * Math.max(1, calls) });
await mapPool(cellsToRun, concurrency, async ({ b, rep, model, target }) => {
  const base = { brief: b.id, model, repeat: rep, objective: target };
  const t = Date.now();
  if (budget.exceeded()) {
    rows.push({
      ...base,
      ok: false,
      ms: 0,
      startedAt: t,
      endedAt: t,
      error: `budget $${budgetUsd} exceeded before the call started`,
    });
    return;
  }
  const input: PlanFactsObjectiveInput = {
    topic: b.lesson.brief?.topic ?? b.lesson.title,
    shape: b.shape,
    audience: b.audience,
    objectives: b.objectives,
    target,
    priorKnowledge: b.lesson.brief?.classContext?.priorKnowledge,
    curriculum: b.curriculum,
  };
  let resent = false;
  const send = () =>
    callStructured({
      deps: {
        ai: ais.get(model) as CreatedAi,
        budget,
        signal: new AbortController().signal,
        logger: pino({ level: "silent" }),
        context: { lessonId: b.lesson.id, jobId: `facts-${label}` },
      },
      stage: "plan",
      cls: "standard",
      effort,
      prompt: planFactsObjectivePrompt,
      input,
      // Validate soft first: a length cap is editorial, not worth a 10 s retry; the hard
      // schema is checked afterwards and its misses recorded (SOFT_FIRST=0 restores the
      // hard-then-soft order the monolithic call uses, for comparison).
      schema: planFactsObjectiveOutputSchemaFor(input, { soft: softFirst }),
      soft: planFactsObjectiveOutputSchemaFor(input, { soft: true }),
      maxOutputTokens: 3000,
    });
  try {
    const result = await send().catch(async (e) => {
      if (!isTransport(e)) throw e;
      resent = true;
      return send();
    });
    const usage = callUsageOf(result.usage);
    const hard = planFactsObjectiveOutputSchemaFor(input).safeParse(result.output);
    const capMisses = hard.success
      ? []
      : hard.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    rows.push({
      ...base,
      ok: true,
      ms: Date.now() - t,
      startedAt: t,
      endedAt: Date.now(),
      in: usage?.inputTokens,
      out: usage?.outputTokens,
      cost: (usage && costUsd(result.modelId, usage)) ?? 0,
      attempts: result.attempts,
      resent,
      editorialMisses: capMisses.length ? capMisses : undefined,
      output: result.output,
    });
  } catch (e) {
    rows.push({
      ...base,
      ok: false,
      ms: Date.now() - t,
      startedAt: t,
      endedAt: Date.now(),
      resent,
      error: causeChain(e).slice(0, 600),
    });
  }
});
// Per lesson (one brief, repeat and model): wall time from its first call's start to its last
// call's end, cost the sum of its calls.
for (const model of models)
  for (const b of briefs)
    for (let rep = 1; rep <= repeat; rep++) {
      const rs = rows.filter((r) => r.model === model && r.brief === b.id && r.repeat === rep);
      if (!rs.length) continue;
      const wallMs =
        Math.max(...rs.map((r) => r.endedAt)) - Math.min(...rs.map((r) => r.startedAt));
      const cost = rs.reduce((s, r) => s + (r.cost ?? 0), 0);
      // The same merge the stage will run, on the calls that completed: a term defined by two
      // objectives is repaired here, not by the prompt, so the count is reported rather than ruled.
      const outputs = b.objectives.map((_, i) => {
        const r = rs.find((x) => x.objective === i && x.ok);
        return r ? (r.output as PlanFactsObjectiveOutput) : null;
      });
      const duplicateTerms = mergeObjectiveFacts(outputs).duplicates.vocabulary;
      groups.push({
        brief: b.id,
        model,
        repeat: rep,
        wallMs,
        cost,
        ok: rs.every((r) => r.ok),
        duplicateTerms,
      });
      console.log(
        `${model} ${b.id} #${rep}: ${(wallMs / 1000).toFixed(1)} s, $${cost.toFixed(4)}, ${duplicateTerms} duplicate term(s)`,
      );
    }
const spent = rows.reduce((s, r) => s + (r.cost ?? 0), 0);

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
};
const L: string[] = [
  `# Facts bench — ${label}`,
  "",
  `Prompt ${planFactsObjectivePrompt.version}, effort ${effort}, ${repeat} repeat(s), ${rows.length} calls, ${rows.filter((r) => !r.ok).length} failed, total list cost $${spent.toFixed(4)}.`,
  "",
  "## Per call (one objective), per model",
  "",
  "| model | n | median ms | min | max | median in | median out | median $ | fails | schema retries | re-sent | cap misses |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
];
for (const model of models) {
  const rs = rows.filter((r) => r.model === model);
  const ok = rs.filter((r) => r.ok);
  L.push(
    `| ${model} | ${rs.length} | ${med(ok.map((r) => r.ms))} | ${Math.min(...ok.map((r) => r.ms))} | ${Math.max(...ok.map((r) => r.ms))} | ${med(ok.map((r) => r.in ?? 0))} | ${med(ok.map((r) => r.out ?? 0))} | ${med(ok.map((r) => r.cost ?? 0)).toFixed(4)} | ${rs.length - ok.length} | ${ok.filter((r) => (r.attempts ?? 1) > 1).length} | ${rs.filter((r) => r.resent).length} | ${ok.filter((r) => r.editorialMisses?.length).length} |`,
  );
}
L.push(
  "",
  "## Per lesson (all objectives in parallel): wall time and cost, per model",
  "",
  "| model | lessons | median wall ms | min | max | median $ per lesson | all ok | merge duplicates (terms) |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
);
for (const model of models) {
  const gs = groups.filter((g) => g.model === model);
  L.push(
    `| ${model} | ${gs.length} | ${med(gs.map((g) => g.wallMs))} | ${Math.min(...gs.map((g) => g.wallMs))} | ${Math.max(...gs.map((g) => g.wallMs))} | ${med(gs.map((g) => g.cost)).toFixed(4)} | ${gs.filter((g) => g.ok).length}/${gs.length} | ${gs.reduce((s, g) => s + g.duplicateTerms, 0)} |`,
  );
}
L.push(
  "",
  "## Wall time per brief (ms), median over repeats",
  "",
  `| brief | ${models.join(" | ")} |`,
  `|---|${models.map(() => "---:").join("|")}|`,
);
for (const b of briefs)
  L.push(
    `| ${b.id} | ${models.map((m) => med(groups.filter((g) => g.brief === b.id && g.model === m).map((g) => g.wallMs))).join(" | ")} |`,
  );
L.push("", "## Facts (first repeat of each lesson)");
for (const b of briefs)
  for (const model of models) {
    L.push("", `### ${b.id} · ${model}`);
    b.objectives.forEach((o, i) => {
      const r = rows.find(
        (x) => x.brief === b.id && x.model === model && x.repeat === 1 && x.objective === i,
      );
      L.push("", `**Objective ${i + 1}: ${o.text}**${r?.ok ? "" : ` · FAILED ${r?.error ?? ""}`}`);
      if (r?.ok) L.push("```json", JSON.stringify(r.output, null, 1), "```");
    });
  }
L.push("", "## Cost ledger, per model");
for (const [model, ledger] of ledgers) L.push("", `### ${model}`, "", ledger.markdown());
await writeFile(join(dir, "RESULTS.md"), L.join("\n"));
await writeFile(join(dir, "rows.json"), JSON.stringify({ rows, groups }, null, 2));
await writeFile(
  join(dir, "ledger.json"),
  JSON.stringify(Object.fromEntries([...ledgers].map(([m, l]) => [m, l.toJSON()])), null, 2),
);
console.log(L.slice(0, 30).join("\n"));
for (const [model, ledger] of ledgers) console.log(`\nledger ${model}\n${ledger.markdown()}`);
console.log(`\ntotal list cost $${spent.toFixed(4)} of budget $${budgetUsd}; wrote ${dir}`);
