#!/usr/bin/env bun
// railway run -- bun packages/generation/eval/replay-pw-exit-live.ts
//
// pw prompts-2 (24 Sep): the recorded plan-question-set.v2 EXIT calls of the gpt-5.6-luna waves
// runs (l1 *-WL at low effort, l2 *-WN at none), asked again as v3: the same system text and the
// recorded user turn with v3's exit line appended (the only v2 -> v3 change). Per call, the v2
// answer (recorded) and the v3 answer: exit questions that fit a line of the exit quiz
// (`fitsExitLine`) and the code check (`questionSetProblem`). Budget capped at $0.03.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAi, createBudget } from "@tj/ai";
import pino from "pino";
import { callStructured } from "../src/call";
import { fitsExitLine, questionSetProblem } from "../src/lab/plan-pipeline";
import {
  EXIT_LINE,
  type PlanQuestionSetOutput,
  planQuestionSetOutputSchemaFor,
  planQuestionSetPrompt,
} from "../src/prompts/plan-question-set";

const ROOT = join(import.meta.dir, "results", "lab");
const created = createAi(process.env as never, { route: () => "openai/gpt-5.6-luna" });
if (created.kind === "unconfigured") throw new Error("no AI credentials: run under railway run --");
const budget = createBudget({ capUsd: 0.03, capTokens: 2_000_000 });
const deps = {
  ai: created,
  budget,
  signal: new AbortController().signal,
  logger: pino({ level: "silent" }),
  context: { lessonId: "replay-pw-exit", jobId: "replay-pw-exit" },
} as never;
const runs = (await readdir(ROOT)).filter((r) => /^(l1-.*-WL|l2-.*-WN)$/.test(r)).sort();
const tally = { v2: { qs: 0, fit: 0, bad: 0 }, v3: { qs: 0, fit: 0, bad: 0 }, sets: 0 };
const score = (out: PlanQuestionSetOutput, count: number, key: "v2" | "v3") => {
  const qs = out.questions.slice(0, count);
  tally[key].qs += qs.length;
  tally[key].fit += qs.filter(fitsExitLine).length;
  const problem = questionSetProblem(out, count, 2, "exit");
  if (problem) tally[key].bad++;
  return `${qs.filter(fitsExitLine).length}/${qs.length} fit${problem ? ` (${problem})` : ""}`;
};
for (const run of runs) {
  const effort = run.endsWith("-WN") ? "none" : "low";
  const calls = (await readFile(join(ROOT, run, "calls.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { promptVersion: string; prompt: string; text: string });
  for (const c of calls) {
    if (!c.promptVersion.startsWith("plan-question-set.v2")) continue;
    const count = Number(/Write (\d+) "exit"/.exec(c.prompt)?.[1] ?? 0);
    if (!count) continue;
    const cut = c.prompt.indexOf("\n\nuser: ");
    const system = c.prompt.slice("system: ".length, cut);
    const user = c.prompt.slice(cut + "\n\nuser: ".length);
    if (system !== planQuestionSetPrompt.system)
      throw new Error(`${run}: system text drifted from v2`);
    const keyIdeas = (user.match(/^ {2}\d+: /gm) ?? []).length;
    const position = {
      use: "exit" as const,
      count,
      taught: { keyIdeas: Array(Math.min(2, keyIdeas)) } as never,
    };
    const soft = planQuestionSetOutputSchemaFor(position, { soft: true });
    const v2 = soft.safeParse(
      JSON.parse(c.text.slice(c.text.indexOf("{"), c.text.lastIndexOf("}") + 1)),
    );
    tally.sets++;
    const before = v2.success ? score(v2.data, count, "v2") : "unparsed";
    const prompt = { ...planQuestionSetPrompt, user: () => `${user}\n${EXIT_LINE}` };
    const call = await callStructured({
      deps,
      stage: "plan",
      cls: "frontier",
      effort,
      prompt: prompt as never,
      input: {} as never,
      schema: planQuestionSetOutputSchemaFor(position),
      soft,
      maxOutputTokens: 4000,
    } as never);
    const out = (call as { output: PlanQuestionSetOutput }).output;
    console.log(`${run.padEnd(24)} x${count}  v2 ${before}  ->  v3 ${score(out, count, "v3")}`);
    for (const q of out.questions) console.log(`     [${q.forms.join(",")}] ${q.stem}`);
  }
}
console.log(JSON.stringify(tally));
console.log(
  "spent",
  JSON.stringify((budget as unknown as { snapshot?: () => unknown }).snapshot?.() ?? budget),
);
