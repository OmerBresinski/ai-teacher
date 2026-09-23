#!/usr/bin/env bun
// railway run bun packages/generation/eval/bakeoff/paraphrase.ts --file <select-construction.json> [--budget 0.02] [--dry-run]
//
// Fills `objective` on every item of the select construction file whose `objective` is null: one
// Luna call per distinct `seedOutcome` (lesson X's pupil outcome), paraphrase only. This is the
// only model call in the data build; labels are never touched here. Writes the file back in place
// and prints the ledger.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type CreatedAi, createAi, createBudget } from "@tj/ai";
import pino from "pino";
import { z } from "zod";
import { callStructured } from "../../src/call";
import { createLedger, meteringAi } from "../ledger";
import { mapPool } from "../pool";
import { BAKEOFF_EFFORT, BAKEOFF_MODEL } from "./schemas";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const file = resolve(arg("file") ?? "");
if (!file) {
  console.error(
    "usage: paraphrase.ts --file <select-construction.json> [--budget 0.02] [--dry-run]",
  );
  process.exit(2);
}
const budgetUsd = Number(arg("budget") ?? 0.02);

type Item = { id: string; seedOutcome: string; objective: string | null; kind: string };
const data = JSON.parse(await readFile(file, "utf8")) as { items: Item[] };
const todo = [...new Set(data.items.filter((i) => !i.objective).map((i) => i.seedOutcome))];
console.log(
  `${data.items.length} items, ${todo.length} distinct outcomes to paraphrase, cap $${budgetUsd}`,
);
if (process.argv.includes("--dry-run") || todo.length === 0) process.exit(0);

const prompt = {
  version: "bakeoff-paraphrase.v1",
  system:
    "Rewrite a pupil's 'I can …' lesson outcome as the lesson objective a teacher would type into a planner. Keep the same meaning and scope: every concept in the outcome stays, nothing is added. Change the wording: different verbs and phrasing where possible, no 'I can'. One sentence, at most 25 words.",
  user: (input: { outcome: string }) => `Outcome: ${input.outcome}`,
};
const Schema = z.object({ objective: z.string().min(8).max(220) });

const ai = createAi({
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  AI_MODEL_STANDARD: BAKEOFF_MODEL,
});
if (ai.kind === "unconfigured") throw new Error("set AI_GATEWAY_API_KEY (railway run)");
const ledger = createLedger();
const metered = meteringAi(ai, ledger, { stage: "other" });
const budget = createBudget({ capUsd: budgetUsd, capTokens: 20_000 * todo.length });
const logger = pino({ level: "silent" });

const results = new Map<string, string>();
await mapPool(todo, 4, async (outcome) => {
  try {
    const r = await callStructured({
      deps: {
        ai: metered as CreatedAi,
        budget,
        signal: new AbortController().signal,
        logger,
        context: { lessonId: "bakeoff", jobId: "paraphrase" },
      },
      stage: "plan",
      cls: "standard",
      effort: BAKEOFF_EFFORT,
      prompt,
      input: { outcome },
      schema: Schema,
      maxOutputTokens: 600,
      timeoutMs: 60_000,
    });
    results.set(outcome, r.output.objective.trim());
  } catch (e) {
    console.error(`FAILED: ${outcome.slice(0, 60)}… ${(e as Error).message}`);
  }
});
for (const item of data.items) {
  const p = results.get(item.seedOutcome);
  if (p && !item.objective) item.objective = p;
}
await writeFile(file, `${JSON.stringify(data, null, 1)}\n`);
console.log(
  `filled ${results.size}/${todo.length}; ${data.items.filter((i) => !i.objective).length} still null`,
);
console.log(ledger.markdown());
