#!/usr/bin/env bun
// railway run bun packages/generation/eval/bakeoff/run.ts --prompt <file.json> --task rewrite|select
//   --set test|dev --out <dir> --budget <usd> [--lab <dir>] [--concurrency 4] [--dry-run]
//
// One contestant's prompt over one task's item set on the fixed model (openai/gpt-5.6-luna, medium
// effort), the brief's schema enforced by zod through `callStructured` (one retry on a schema miss,
// as production has). Per item it records the output, attempts, schema failures, tokens, list cost
// and latency; `<out>/results.json` also names the prompt file and its sha256 so `blind.ts` can
// strip them. `--dry-run` renders every item, prices the expected input and output at list price,
// prints the total and sends nothing.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type CreatedAi, costUsd, createAi, createBudget } from "@tj/ai";
import pino from "pino";
import type { z } from "zod";
import { callStructured, type StructuredPrompt } from "../../src/call";
import { StageFailure } from "../../src/types";
import { callUsageOf, createLedger, meteringAi } from "../ledger";
import { mapPool } from "../pool";
import { renderPrompt } from "./render";
import {
  BAKEOFF_EFFORT,
  BAKEOFF_MODEL,
  EXPECTED_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  OUTPUT_SCHEMAS,
  PLACEHOLDERS,
  type PromptFile,
  PromptFileSchema,
  type RewriteItem,
  RewriteItemSchema,
  SETS,
  type SelectItem,
  SelectItemSchema,
  type SetName,
  TASKS,
  type Task,
} from "./schemas";

export const DEFAULT_LAB =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/pe-bakeoff";

export interface ItemInput {
  id: string;
  values: Record<string, string>;
}

/** The items of one task and set as placeholder values. */
export async function loadItems(lab: string, task: Task, set: SetName): Promise<ItemInput[]> {
  const dir = join(lab, set);
  if (task === "select") {
    const rows = (JSON.parse(await readFile(join(dir, "select.json"), "utf8")) as unknown[]).map(
      (r) => SelectItemSchema.parse(r) as SelectItem,
    );
    return rows.map((r) => ({
      id: r.id,
      values: { subject: r.subject, band: r.band, objective: r.objective, cards: r.cards },
    }));
  }
  const files = (await readdir(dir)).filter((f) => /^rewrite-.*\.json$/.test(f)).sort();
  const items: ItemInput[] = [];
  for (const f of files) {
    const r = RewriteItemSchema.parse(
      JSON.parse(await readFile(join(dir, f), "utf8")),
    ) as RewriteItem;
    items.push({
      id: r.id,
      values: { subject: r.subject, band: r.band, outcome: r.outcome, sentences: r.sentences },
    });
  }
  return items;
}

export async function loadPrompt(path: string): Promise<{ prompt: PromptFile; sha256: string }> {
  const text = await readFile(path, "utf8");
  return {
    prompt: PromptFileSchema.parse(JSON.parse(text)),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

/** A rough token count for a dry run: four characters per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface DryRunRow {
  id: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export function dryRun(task: Task, prompt: PromptFile, items: ItemInput[]): DryRunRow[] {
  return items.map((item) => {
    const r = renderPrompt(prompt, item.values, PLACEHOLDERS[task]);
    const inputTokens = estimateTokens(r.system) + estimateTokens(r.user) + 200;
    const outputTokens = EXPECTED_OUTPUT_TOKENS[task];
    const usd = costUsd(BAKEOFF_MODEL, { inputTokens, outputTokens, cachedInputTokens: 0 }) ?? 0;
    return { id: item.id, inputTokens, outputTokens, usd };
  });
}

export interface ItemResult {
  id: string;
  ok: boolean;
  output?: unknown;
  attempts: number;
  /** Answers that failed the schema (0, 1, or 2 when the call gave up). */
  schemaFailures: number;
  /** The zod issues of the last schema miss, when the call failed for that reason. */
  issues?: string[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
  error?: string;
}

export interface RunFile {
  task: Task;
  set: SetName;
  model: string;
  effort: string;
  promptFile: string;
  promptSha256: string;
  placeholdersUsed: string[];
  startedAt: string;
  items: ItemResult[];
  totals: {
    items: number;
    ok: number;
    schemaFailures: number;
    costUsd: number;
    meanLatencyMs: number;
  };
  ledger: unknown;
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

if (import.meta.main) {
  const promptPath = arg("prompt");
  const task = arg("task") as Task | undefined;
  const set = arg("set") as SetName | undefined;
  const out = arg("out");
  const budgetUsd = Number(arg("budget"));
  if (
    !promptPath ||
    !task ||
    !TASKS.includes(task) ||
    !set ||
    !SETS.includes(set) ||
    !out ||
    !(budgetUsd > 0)
  ) {
    console.error(
      "usage: run.ts --prompt <file.json> --task rewrite|select --set test|dev --out <dir> --budget <usd> [--lab <dir>] [--concurrency 4] [--dry-run]",
    );
    process.exit(2);
  }
  const lab = resolve(arg("lab") ?? DEFAULT_LAB);
  const concurrency = Number(arg("concurrency") ?? 4);
  const { prompt, sha256 } = await loadPrompt(resolve(promptPath));
  const items = await loadItems(lab, task, set);
  const placeholdersUsed = renderPrompt(prompt, items[0]?.values ?? {}, PLACEHOLDERS[task]).used;
  console.log(
    `${task}/${set}: ${items.length} items, model ${BAKEOFF_MODEL} @ ${BAKEOFF_EFFORT}, placeholders used: ${placeholdersUsed.join(", ") || "none"}, budget $${budgetUsd}`,
  );

  if (process.argv.includes("--dry-run")) {
    const rows = dryRun(task, prompt, items);
    for (const r of rows)
      console.log(
        `  ${r.id}: ~${r.inputTokens} in + ~${r.outputTokens} out = $${r.usd.toFixed(4)}`,
      );
    const total = rows.reduce((s, r) => s + r.usd, 0);
    console.log(
      `expected list cost $${total.toFixed(4)} (one attempt each; a schema retry doubles an item)`,
    );
    process.exit(0);
  }

  const ai = createAi({
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    AI_MODEL_STANDARD: BAKEOFF_MODEL,
  });
  if (ai.kind === "unconfigured") throw new Error("set AI_GATEWAY_API_KEY (railway run)");
  const ledger = createLedger();
  const metered = meteringAi(ai, ledger, { stage: "other" });
  const budget = createBudget({ capUsd: budgetUsd, capTokens: 60_000 * items.length });
  const schema: z.ZodType<unknown> = OUTPUT_SCHEMAS[task];
  const startedAt = new Date().toISOString();

  const results = await mapPool(items, concurrency, async (item): Promise<ItemResult> => {
    // A per-call logger sink: `callStructured` logs each schema miss (never the text), so counting
    // those lines gives the schema-failure count without touching the call.
    let schemaFailures = 0;
    const logger = pino(
      { level: "info" },
      {
        write(line: string) {
          if (line.includes("did not validate")) schemaFailures += 1;
        },
      },
    );
    const structured: StructuredPrompt<Record<string, string>> = {
      version: `bakeoff-${task}.v1`,
      system: renderPrompt(prompt, item.values, PLACEHOLDERS[task]).system,
      user: (values) => renderPrompt(prompt, values, PLACEHOLDERS[task]).user,
    };
    const t0 = Date.now();
    try {
      const r = await callStructured({
        deps: {
          ai: metered as CreatedAi,
          budget,
          signal: new AbortController().signal,
          logger,
          context: { lessonId: item.id, jobId: `bakeoff-${task}-${set}` },
        },
        stage: "plan",
        cls: "standard",
        effort: BAKEOFF_EFFORT,
        prompt: structured,
        input: item.values,
        schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS[task],
        timeoutMs: 240_000,
      });
      const usage = callUsageOf(r.usage);
      return {
        id: item.id,
        ok: true,
        output: r.output,
        attempts: r.attempts,
        schemaFailures,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        costUsd: (usage && costUsd(r.modelId, usage)) ?? undefined,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      const issues =
        e instanceof StageFailure && Array.isArray(e.cause) ? (e.cause as string[]) : undefined;
      return {
        id: item.id,
        ok: false,
        attempts: schemaFailures > 0 ? 2 : 1,
        schemaFailures,
        ...(issues ? { issues } : {}),
        latencyMs: Date.now() - t0,
        error: String((e as Error).message ?? e).slice(0, 400),
      };
    }
  });

  const okRows = results.filter((r) => r.ok);
  const file: RunFile = {
    task,
    set,
    model: BAKEOFF_MODEL,
    effort: BAKEOFF_EFFORT,
    promptFile: resolve(promptPath),
    promptSha256: sha256,
    placeholdersUsed,
    startedAt,
    items: results,
    totals: {
      items: results.length,
      ok: okRows.length,
      schemaFailures: results.reduce((s, r) => s + r.schemaFailures, 0),
      costUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0),
      meanLatencyMs: results.length
        ? Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)
        : 0,
    },
    ledger: ledger.toJSON(),
  };
  await mkdir(resolve(out), { recursive: true });
  await writeFile(join(resolve(out), "results.json"), `${JSON.stringify(file, null, 2)}\n`);
  console.log(
    `${file.totals.ok}/${file.totals.items} ok, ${file.totals.schemaFailures} schema failures, $${file.totals.costUsd.toFixed(4)}, mean ${file.totals.meanLatencyMs} ms; wrote ${join(resolve(out), "results.json")}`,
  );
  console.log(ledger.markdown());
}
