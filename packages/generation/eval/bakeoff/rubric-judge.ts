#!/usr/bin/env bun
// railway run bun packages/generation/eval/bakeoff/rubric-judge.ts --blind <lab>/scoring/blind/rewrite-test
//   [--lab <dir>] [--model anthropic/claude-sonnet-5] [--budget <usd>] [--seed 20260923] [--concurrency 3] [--dry-run]
//
// The rewrite task's rubric score (BRIEF.md, Task 1, criterion 3: useful for the outcome and
// pitched for the band). One call per (label, item): the judge sees the section input (subject,
// band, outcome and the numbered sentences, exactly what the contestant's prompt saw) and ONE
// anonymised output set for that section, its items numbered by ref. It never sees another
// contestant's output in the same call, the label→contestant key, the prompt text, evidence ids,
// cost, latency or the code scores. Each call is independent, so no position can favour a label;
// the packets are still run in a seeded order so a rerun is reproducible. The judge's output is
// keyed by the blind label only. Writes `<blindDir>/judge-scores.json`; `--dry-run` prices the run.

import { writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  type ConfiguredAi,
  costUsd,
  createAi,
  createBudget,
  isGatewayModelId,
  isPriced,
} from "@tj/ai";
import { defaultSettingsMiddleware, type LanguageModel, wrapLanguageModel } from "ai";
import pino from "pino";
import { callStructured, type StructuredPrompt } from "../../src/call";
import { callUsageOf } from "../ledger";
import { mapPool } from "../pool";
import type { BlindItem } from "./blind";
import { seededShuffle } from "./metrics";
import { DEFAULT_LAB, estimateTokens, loadItems } from "./run";
import {
  DEFAULT_JUDGE_MODEL,
  JUDGE_EFFORT,
  type JudgeOutput,
  judgeOutputSchema,
  type RewriteOutput,
} from "./schemas";
import { readBlindSets, type ScorerDeps } from "./support-checker";

export interface JudgePacket {
  /** The blind label (A, B, C …) — the only identity the judge ever sees. */
  label: string;
  itemId: string;
  input: { subject: string; band: string; outcome: string; sentences: string };
  output: RewriteOutput;
}

export interface JudgeResult {
  label: string;
  itemId: string;
  /** One per item of the set, keyed `<kind>/<index>`; 1–5. */
  items: { ref: string; useful: number; reason: string }[];
  /** One for the set; 1–5. */
  pitch: { score: number; reason: string };
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** One packet per (label, item) for the sets the judge will see; a failed item yields no packet. */
export function judgePackets(
  sets: { label: string; items: BlindItem[] }[],
  inputs: Record<string, JudgePacket["input"]>,
): JudgePacket[] {
  const packets: JudgePacket[] = [];
  for (const s of sets)
    for (const item of s.items) {
      if (!item.ok || !item.output) continue;
      const input = inputs[item.id];
      if (!input) throw new Error(`no section input for ${item.id}`);
      packets.push({
        label: s.label,
        itemId: item.id,
        input,
        output: item.output as RewriteOutput,
      });
    }
  return packets;
}

/** The set's items in a fixed order, each with the ref the judge scores it under. No evidence ids. */
export function judgeItems(output: RewriteOutput): { ref: string; text: string }[] {
  const items: { ref: string; text: string }[] = [];
  for (const [i, k] of output.keyIdeas.entries())
    items.push({
      ref: `keyIdea/${i}`,
      text: `Key idea: ${k.statement}${k.example ? ` Example: ${k.example}` : ""}`,
    });
  for (const [i, m] of output.misconceptions.entries())
    items.push({
      ref: `misconception/${i}`,
      text: `Misconception: ${m.wrong} Correction: ${m.right}`,
    });
  for (const [i, v] of output.vocabulary.entries())
    items.push({ ref: `vocabulary/${i}`, text: `Term: ${v.term}. Definition: ${v.definition}` });
  for (const [i, w] of output.workedExamples.entries())
    items.push({
      ref: `workedExample/${i}`,
      text: `Worked example. Problem: ${w.problem} Steps: ${w.steps.join(" ")} Answer: ${w.answer}`,
    });
  for (const [i, q] of output.questions.entries())
    items.push({
      ref: `question/${i}`,
      text: `Question (${q.demand}; ${q.forms.join(", ")}): ${q.stem} Answer: ${q.answer}${
        q.distractors.length > 0 ? ` Distractors: ${q.distractors.join("; ")}` : ""
      }`,
    });
  return items;
}

export const JUDGE_PROMPT: StructuredPrompt<JudgePacket> = {
  version: "bakeoff-judge.v1",
  system: `You score one set of lesson facts written for a UK class from the source sentences shown: each item for usefulness, and the set for pitch.

useful (per item)
5: a teacher would put it on a slide for this outcome as it is: central to the outcome, correct, complete on its own.
4: on a slide for this outcome after a small edit.
3: true and on topic, but peripheral to the outcome or needing a rewrite before it could be shown.
2: barely related to the outcome, or too vague or garbled to teach from.
1: off the outcome, wrong, or empty.
For a misconception, useful means pupils of this year group really do believe the wrong statement and the correction puts it right. For a question, useful means the answer is in this set's facts and any distractors are ones a pupil who half-knows the topic would pick.

pitch (the set)
5: every item reads as this year group's: the words, sentence length and depth a teacher would use with them.
4: one or two items a step too hard or too easy.
3: a noticeable share pitched for a different key stage.
2: most of it pitched for a different year group.
1: none of it usable with this year group as written.

reason: up to 15 words each.`,
  user: (p) =>
    [
      `Subject: ${p.input.subject}`,
      `Year group: ${p.input.band}`,
      `Outcome: ${p.input.outcome}`,
      "",
      "Source sentences the set was written from:",
      p.input.sentences,
      "",
      "The set:",
      ...judgeItems(p.output).map((i) => `[${i.ref}] ${i.text}`),
    ].join("\n"),
};

/** The largest set (25 items) at ~40 tokens each plus the pitch line, with room for a retry's JSON. */
export const JUDGE_MAX_OUTPUT_TOKENS = 2500;
/** What a dry run assumes per item and per call on top, for the JSON around the reasons. */
export const JUDGE_EXPECTED_OUTPUT_TOKENS = { perItem: 40, perCall: 80 };

/** One set judged: one structured call on the `standard` class (the host maps it to the judge model). */
export async function judge(packet: JudgePacket, deps: ScorerDeps): Promise<JudgeResult> {
  const refs = judgeItems(packet.output).map((i) => i.ref);
  const r = await callStructured<JudgePacket, JudgeOutput>({
    deps: {
      ai: deps.ai,
      budget: deps.budget,
      signal: deps.signal ?? new AbortController().signal,
      logger: deps.logger ?? pino({ level: "silent" }),
      context: { lessonId: `${packet.label}/${packet.itemId}`, jobId: "bakeoff-judge" },
    },
    stage: "evaluate",
    cls: "standard",
    effort: JUDGE_EFFORT,
    prompt: JUDGE_PROMPT,
    input: packet,
    schema: judgeOutputSchema(refs),
    maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    timeoutMs: 180_000,
  });
  const usage = callUsageOf(r.usage);
  return {
    label: packet.label,
    itemId: packet.itemId,
    items: r.output.items.map((i) => ({ ref: i.ref, useful: i.useful, reason: i.reason })),
    pitch: { score: r.output.pitch.score, reason: r.output.pitch.reason },
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    costUsd: (usage && costUsd(r.modelId, usage)) ?? undefined,
  };
}

/** Expected list cost of judging these packets on `modelId`, one attempt each. */
export function judgeDryRun(
  packets: JudgePacket[],
  modelId: string,
): { calls: number; inputTokens: number; outputTokens: number; usd: number | null } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const p of packets) {
    inputTokens += estimateTokens(JUDGE_PROMPT.system) + estimateTokens(JUDGE_PROMPT.user(p)) + 200;
    outputTokens +=
      JUDGE_EXPECTED_OUTPUT_TOKENS.perCall +
      JUDGE_EXPECTED_OUTPUT_TOKENS.perItem * judgeItems(p.output).length;
  }
  return {
    calls: packets.length,
    inputTokens,
    outputTokens,
    usd: costUsd(modelId, { inputTokens, outputTokens, cachedInputTokens: 0 }),
  };
}

/**
 * The judge's client: the gateway id on the `standard` class, with thinking off for an Anthropic
 * id — every call here asks for JSON in a fixed shape, where hidden reasoning buys nothing
 * (`@tj/ai`'s `NO_THINKING` policy for Bedrock ids, applied to the gateway route).
 */
export function judgeAi(env: { AI_GATEWAY_API_KEY?: string | undefined }, modelId: string) {
  const ai = createAi({ AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY, AI_MODEL_STANDARD: modelId });
  if (ai.kind === "unconfigured") return ai;
  if (!isGatewayModelId(modelId) || !modelId.startsWith("anthropic/")) return ai;
  const wrapped: ConfiguredAi = {
    ...ai,
    model: (cls, context) =>
      wrapLanguageModel({
        // `model()` never returns a bare id string: the gateway route resolves it to a model.
        model: ai.model(cls, context) as Exclude<LanguageModel, string>,
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions: { anthropic: { thinking: { type: "disabled" } } } },
        }),
      }),
  };
  return wrapped;
}

export interface JudgeLabelScore {
  label: string;
  sets: number;
  items: number;
  meanUseful: number;
  meanPitch: number;
  /** Items scored 1 or 2: the ones a teacher could not use. */
  unusable: number;
  costUsd: number;
  results: JudgeResult[];
}

export function summariseJudge(label: string, results: JudgeResult[]): JudgeLabelScore {
  const items = results.flatMap((r) => r.items);
  return {
    label,
    sets: results.length,
    items: items.length,
    meanUseful: items.length ? items.reduce((s, i) => s + i.useful, 0) / items.length : 0,
    meanPitch: results.length ? results.reduce((s, r) => s + r.pitch.score, 0) / results.length : 0,
    unusable: items.filter((i) => i.useful <= 2).length,
    costUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    results,
  };
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

if (import.meta.main) {
  const blindDir = arg("blind");
  if (!blindDir) {
    console.error(
      "usage: rubric-judge.ts --blind <dir> [--lab <dir>] [--model <id>] [--budget <usd>] [--seed <n>] [--concurrency 3] [--dry-run]",
    );
    process.exit(2);
  }
  const lab = resolve(arg("lab") ?? DEFAULT_LAB);
  const modelId = arg("model") ?? DEFAULT_JUDGE_MODEL;
  if (!isPriced(modelId)) throw new Error(`${modelId} has no row in PRICES; add it before judging`);
  const dir = resolve(blindDir);
  const sets = await readBlindSets(dir);
  if (sets.length === 0 || sets[0]?.task !== "rewrite")
    throw new Error(`${dir}: no rewrite sets (${basename(dir)})`);
  const set = sets[0]?.set as "dev" | "test";
  const inputs = Object.fromEntries(
    (await loadItems(lab, "rewrite", set)).map((i) => [
      i.id,
      i.values as unknown as JudgePacket["input"],
    ]),
  );
  const seed = Number(arg("seed") ?? 20260923);
  const packets = seededShuffle(judgePackets(sets, inputs), seed);
  const dry = judgeDryRun(packets, modelId);
  console.log(
    `${basename(dir)}: ${sets.length} sets, ${packets.length} calls on ${modelId} @ ${JUDGE_EFFORT}; expected list cost $${(dry.usd ?? 0).toFixed(4)} (~${dry.inputTokens} in + ~${dry.outputTokens} out)`,
  );
  if (process.argv.includes("--dry-run")) process.exit(0);

  const budgetUsd = Number(arg("budget"));
  if (!(budgetUsd > 0)) throw new Error("set --budget <usd> for a live run");
  const ai = judgeAi({ AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY }, modelId);
  if (ai.kind === "unconfigured") throw new Error("set AI_GATEWAY_API_KEY (railway run)");
  const budget = createBudget({
    capUsd: budgetUsd,
    capTokens: 40_000 * Math.max(1, packets.length),
  });
  const concurrency = Number(arg("concurrency") ?? 3);
  const results = await mapPool(packets, concurrency, (p) => judge(p, { ai, budget }));
  const scores = sets.map((s) =>
    summariseJudge(
      s.label,
      results.filter((r) => r.label === s.label),
    ),
  );
  await writeFile(
    join(dir, "judge-scores.json"),
    `${JSON.stringify({ model: modelId, effort: JUDGE_EFFORT, seed, scores }, null, 2)}\n`,
  );
  console.log("label  sets  items  useful  pitch  unusable  cost");
  for (const s of scores)
    console.log(
      `${s.label.padEnd(6)} ${String(s.sets).padStart(4)}  ${String(s.items).padStart(5)}  ${s.meanUseful.toFixed(2)}    ${s.meanPitch.toFixed(2)}   ${String(s.unusable).padStart(8)}  $${s.costUsd.toFixed(4)}`,
    );
}
