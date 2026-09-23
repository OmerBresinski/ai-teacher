#!/usr/bin/env bun
// bun packages/generation/eval/objectives-bench.ts --models <id,…> --label <name> [--briefs <file,…>]
//   [--sources <briefBasename>:<file>:<condition>,…] [--repeat N] [--effort low|medium|high]
//   [--budget 0.3] [--concurrency 6] [--dry-run]
//
// The objectives-only first call (plan-objectives.v<n>) on one brief, one call per model and per
// condition (no source / the retrieved curriculum as source). Records latency, tokens, the gateway's
// own cost and the objectives, for hand grading. Sub-cent per call; never a full lesson.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type CreatedAi, costUsd, createAi, createBudget } from "@tj/ai";
import { CreateLessonSchema, lessonFromBrief } from "@tj/domain/documents";
import pino from "pino";
import { callStructured } from "../src/call";
import { checkObjectives, describeIssues } from "../src/objectives-check";
import {
  planObjectivesOutputSchemaFor,
  planObjectivesPrompt,
} from "../src/prompts/plan-objectives";
import { audienceOf, shapeOf } from "../src/stages/shared";
import { callUsageOf, createLedger, type Ledger, meteringAi } from "./ledger";
import { DEFAULT_CONCURRENCY, mapPool } from "./pool";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const models = (arg("models") ?? "").split(",").filter(Boolean);
const label = arg("label") ?? "objectives";
if (!models.length) {
  console.error(
    "usage: objectives-bench.ts --models <id,…> --label <name> [--sources …] [--effort low|medium|high] [--budget usd] [--concurrency n] [--dry-run]",
  );
  process.exit(2);
}
const effort = (arg("effort") ?? "medium") as "low" | "medium" | "high";
const budgetUsd = Number(arg("budget") ?? 0.3);
const concurrency = Number(arg("concurrency") ?? DEFAULT_CONCURRENCY);
const briefPaths = (arg("briefs") ?? "packages/generation/eval/briefs/y4-history-romans.json")
  .split(",")
  .filter(Boolean);
const repeat = Number(arg("repeat") ?? 1);
/** `--sources y4-history-romans.json:bench/x.md:outcomes,…`: extra conditions per brief basename. */
const sourceSpecs = (arg("sources") ?? "")
  .split(",")
  .filter(Boolean)
  .map((spec) => {
    const [base, file, condition] = spec.split(":");
    if (!base || !file) throw new Error(`--sources: ${spec}`);
    return { base, file, condition: condition ?? "curriculum" };
  });
type Brief = {
  id: string;
  lesson: ReturnType<typeof lessonFromBrief>;
  shape: ReturnType<typeof shapeOf>;
  audience: ReturnType<typeof audienceOf>;
  conditions: [string, { text: string } | undefined][];
};
const briefs: Brief[] = [];
for (const path of briefPaths) {
  const input = CreateLessonSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
  const id =
    path
      .split("/")
      .pop()
      ?.replace(/\.json$/, "") ?? path;
  const lesson = lessonFromBrief(input, `objectives-${id}`, new Date());
  const conditions: [string, { text: string } | undefined][] = [["none", undefined]];
  for (const spec of sourceSpecs)
    if (spec.base === `${id}.json` || spec.base === id)
      conditions.push([spec.condition, { text: await readFile(resolve(spec.file), "utf8") }]);
  briefs.push({ id, lesson, shape: shapeOf(lesson), audience: audienceOf(lesson), conditions });
}
const dir = join(import.meta.dir, "results", "lab", `objectives-${label}`);
await mkdir(dir, { recursive: true });
const cells = briefs.reduce((n, b) => n + b.conditions.length, 0) * models.length * repeat;
console.log(
  `prompt ${planObjectivesPrompt.version}; effort ${effort}; repeat ${repeat}; budget $${budgetUsd} for the run; ${concurrency} in flight; ${cells} calls`,
);
for (const b of briefs)
  console.log(
    `  ${b.id}: ${b.lesson.subject} ${b.lesson.yearGroup}, "${b.lesson.brief?.topic}", ${b.lesson.brief?.durationMin} min, verb ${b.shape.verb}, ${b.shape.confidence}; conditions ${b.conditions.map((c) => c[0]).join("+")}`,
  );
console.log(`  models: ${models.join(", ")}`);
if (flag("dry-run")) process.exit(0);

/** The error's message and those of its `cause` chain: the gateway's reason lives one or two levels down. */
function causeChain(e: unknown): string {
  const parts: string[] = [];
  for (
    let cur = e as { message?: string; cause?: unknown } | undefined, i = 0;
    cur && i < 4;
    cur = cur.cause as typeof cur, i++
  )
    if (cur.message) parts.push(String(cur.message));
  return parts.join(" <- ");
}
type Row = {
  brief: string;
  model: string;
  condition: string;
  repeat: number;
  ok: boolean;
  ms: number;
  in?: number;
  out?: number;
  reasoning?: number;
  cost?: number;
  attempts?: number;
  objectives?: { text: string; curriculumAnchor?: string }[];
  /** `checkObjectives` issue lines; empty when the set passed. */
  check?: string[];
  error?: string;
};
const rows: Row[] = [];
type Cell = {
  b: Brief;
  condition: string;
  curr: { text: string } | undefined;
  rep: number;
  model: string;
};
const cellsToRun: Cell[] = [];
for (const model of models)
  for (const b of briefs)
    for (const [condition, curr] of b.conditions)
      for (let rep = 1; rep <= repeat; rep++) cellsToRun.push({ b, condition, curr, rep, model });
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
const budget = createBudget({ capUsd: budgetUsd, capTokens: 50_000 * Math.max(1, cells) });
await mapPool(cellsToRun, concurrency, async ({ b, condition, curr, rep, model }) => {
  const base = { brief: b.id, model, condition, repeat: rep };
  if (budget.exceeded()) {
    rows.push({
      ...base,
      ok: false,
      ms: 0,
      error: `budget $${budgetUsd} exceeded before the call started`,
    });
    return;
  }
  const t = Date.now();
  try {
    const result = await callStructured({
      deps: {
        ai: ais.get(model) as CreatedAi,
        budget,
        signal: new AbortController().signal,
        logger: pino({ level: "silent" }),
        context: { lessonId: b.lesson.id, jobId: `objectives-${label}` },
      },
      stage: "plan",
      cls: "standard",
      effort,
      prompt: planObjectivesPrompt,
      input: {
        topic: b.lesson.brief?.topic ?? b.lesson.title,
        shape: b.shape,
        audience: b.audience,
        priorKnowledge: b.lesson.brief?.classContext?.priorKnowledge,
        curriculum: curr,
      },
      schema: planObjectivesOutputSchemaFor(Boolean(curr)),
      maxOutputTokens: 1200,
    });
    const usage = callUsageOf(result.usage);
    const cost = (usage && costUsd(result.modelId, usage)) ?? 0;
    rows.push({
      ...base,
      ok: true,
      ms: Date.now() - t,
      in: usage?.inputTokens,
      out: usage?.outputTokens,
      cost,
      attempts: result.attempts,
      objectives: result.output.objectives,
      check: describeIssues(
        checkObjectives(result.output.objectives, b.shape.verb, { hasSource: Boolean(curr) })
          .issues,
      ),
    });
    console.log(
      `${model} ${b.id} ${condition} #${rep}: ${Date.now() - t} ms, $${cost.toFixed(4)} (run $${(budget.totals().costUsd ?? 0).toFixed(4)})`,
    );
  } catch (e) {
    rows.push({ ...base, ok: false, ms: Date.now() - t, error: causeChain(e).slice(0, 300) });
  }
});
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
};
const L: string[] = [
  `# Objectives bench — ${label}`,
  "",
  `Prompt ${planObjectivesPrompt.version}, effort ${effort}, ${repeat} repeat(s), ${rows.length} calls, ${rows.filter((r) => !r.ok).length} failed.`,
  "",
];
L.push(
  "## Latency (ms) and list cost, per model and condition, over all briefs and repeats",
  "",
  "| model | condition | n | median ms | min | max | median $ | fails | retries | check pass |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
);
const conditionNames = [...new Set(rows.map((r) => r.condition))];
for (const model of models)
  for (const condition of conditionNames) {
    const rs = rows.filter((r) => r.model === model && r.condition === condition);
    if (!rs.length) continue;
    const ok = rs.filter((r) => r.ok);
    L.push(
      `| ${model} | ${condition} | ${rs.length} | ${med(ok.map((r) => r.ms))} | ${Math.min(...ok.map((r) => r.ms))} | ${Math.max(...ok.map((r) => r.ms))} | ${med(ok.map((r) => r.cost ?? 0)).toFixed(4)} | ${rs.length - ok.length} | ${ok.filter((r) => (r.attempts ?? 1) > 1).length} | ${ok.filter((r) => !r.check?.length).length}/${ok.length} |`,
    );
  }
L.push(
  "",
  "## Latency (ms) per brief, condition none, median over repeats",
  "",
  `| brief | ${models.join(" | ")} |`,
  `|---|${models.map(() => "---:").join("|")}|`,
);
for (const b of briefs)
  L.push(
    `| ${b.id} | ${models.map((m) => med(rows.filter((r) => r.brief === b.id && r.model === m && r.condition === "none" && r.ok).map((r) => r.ms))).join(" | ")} |`,
  );
L.push("", "## Objectives (first repeat of each cell)");
for (const b of briefs)
  for (const [condition] of b.conditions)
    for (const model of models) {
      const r = rows.find(
        (x) => x.brief === b.id && x.condition === condition && x.model === model && x.repeat === 1,
      );
      L.push(
        "",
        `### ${b.id} · ${condition} · ${model}${r?.ok ? "" : ` · FAILED ${r?.error ?? ""}`}`,
      );
      for (const o of r?.objectives ?? [])
        L.push(`- ${o.text}${o.curriculumAnchor ? `  _(anchor: ${o.curriculumAnchor})_` : ""}`);
      for (const line of r?.check ?? []) L.push(`  - check: ${line}`);
    }
L.push("", "## Cost ledger, per model");
for (const [model, ledger] of ledgers) L.push("", `### ${model}`, "", ledger.markdown());
await writeFile(join(dir, "RESULTS.md"), L.join("\n"));
await writeFile(join(dir, "rows.json"), JSON.stringify(rows, null, 2));
await writeFile(
  join(dir, "ledger.json"),
  JSON.stringify(Object.fromEntries([...ledgers].map(([m, l]) => [m, l.toJSON()])), null, 2),
);
console.log(L.join("\n"));
console.log(
  `\ntotal list cost $${rows.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(4)} of budget $${budgetUsd}; wrote ${dir}`,
);
