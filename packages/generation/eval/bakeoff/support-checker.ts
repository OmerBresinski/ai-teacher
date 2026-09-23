#!/usr/bin/env bun
// railway run bun packages/generation/eval/bakeoff/support-checker.ts --blind <lab>/scoring/blind/rewrite-test
//   [--lab <dir>] [--budget <usd>] [--concurrency 4] [--dry-run]
//
// The rewrite task's "supported" score (BRIEF.md, Task 1, criterion 1). One call per fact on
// `SUPPORT_MODEL` (Luna, medium): the checker sees ONE fact, its parts labelled as a reader would
// see them, and ONLY the sentences that fact cites, each with its id. It never sees the outcome,
// the other facts, the whole section, the contestant's label, or which contestant produced the
// fact. Facts with an invalid evidence id are scored "unsupported" by code and not sent (nothing
// to check against). Writes `<blindDir>/support-scores.json`; `--dry-run` prices the run.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { type Budget, type CreatedAi, costUsd, createAi, createBudget } from "@tj/ai";
import pino from "pino";
import { callStructured, type StructuredPrompt } from "../../src/call";
import { callUsageOf } from "../ledger";
import { mapPool } from "../pool";
import type { BlindSet } from "./blind";
import { type FactRow, rewriteFacts, sentencesById } from "./metrics";
import { DEFAULT_LAB, estimateTokens, loadItems } from "./run";
import {
  type RewriteOutput,
  SUPPORT_EFFORT,
  SUPPORT_MODEL,
  type SupportCheck,
  SupportCheckSchema,
  type SupportVerdict,
} from "./schemas";

export type { SupportVerdict } from "./schemas";

export interface SupportPacket {
  /** Stable per (label, item, kind, index); never carries the contestant label. */
  factRef: string;
  /** The fact with its parts labelled (`factView`). */
  fact: string;
  cited: { id: string; text: string }[];
}

export interface SupportResult {
  factRef: string;
  verdict: SupportVerdict;
  /** Up to 20 words naming what the cited sentences do not say (or contradict). */
  note: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * One fact as the checker reads it. The parts a reader is meant to take as false (a
 * misconception's wrong belief, a question's distractors) are labelled so, because the cited
 * sentences will not state them and must not be read as failing to.
 */
export function factView(output: RewriteOutput, kind: FactRow["kind"], index: number): string {
  switch (kind) {
    case "keyIdea": {
      const k = output.keyIdeas[index];
      if (!k) break;
      return [`Key idea: ${k.statement}`, k.example ? `Example: ${k.example}` : ""]
        .filter(Boolean)
        .join("\n");
    }
    case "misconception": {
      const m = output.misconceptions[index];
      if (!m) break;
      return `Misconception (false by design, not a claim): ${m.wrong}\nCorrection: ${m.right}`;
    }
    case "vocabulary": {
      const v = output.vocabulary[index];
      if (!v) break;
      return `Term: ${v.term}\nDefinition: ${v.definition}`;
    }
    case "workedExample": {
      const w = output.workedExamples[index];
      if (!w) break;
      return [
        `Problem: ${w.problem}`,
        "Steps:",
        ...w.steps.map((s, i) => `${i + 1}. ${s}`),
        `Answer: ${w.answer}`,
      ].join("\n");
    }
    case "question": {
      const q = output.questions[index];
      if (!q) break;
      return [
        `Question: ${q.stem}`,
        `Correct answer: ${q.answer}`,
        q.distractors.length > 0
          ? `Wrong options (false by design, not claims): ${q.distractors.join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
  }
  throw new Error(`no ${kind} at index ${index}`);
}

/** The packets for one anonymised rewrite answer: one per fact, only the cited sentences attached. */
export function supportPackets(
  itemId: string,
  output: RewriteOutput,
  sentencesBlock: string,
): {
  packets: SupportPacket[];
  /** Facts that cite an id not in the input: scored unsupported by code, no packet. */
  invalid: FactRow[];
} {
  const sentences = sentencesById(sentencesBlock);
  const rows = rewriteFacts(output, sentences);
  const packets: SupportPacket[] = [];
  const invalid: FactRow[] = [];
  for (const row of rows) {
    if (row.invalidEvidence.length > 0) {
      invalid.push(row);
      continue;
    }
    packets.push({
      factRef: `${itemId}/${row.kind}/${row.index}`,
      fact: factView(output, row.kind, row.index),
      cited: row.evidence.map((id) => ({ id, text: sentences.get(id) as string })),
    });
  }
  return { packets, invalid };
}

export const SUPPORT_PROMPT: StructuredPrompt<SupportPacket> = {
  version: "bakeoff-support.v1",
  system: `You check one fact written for a school lesson against the source sentences it cites. Every claim in the fact must be stated or directly implied by those sentences; what you know from elsewhere does not count, even if true. Parts labelled "false by design" are meant to be wrong and are not claims.

verdict:
supported: every claim is stated or directly implied.
partly: some claims are, at least one is not.
unsupported: no claim is, or the sentences are about something else.
contradicted: the sentences say the opposite of a claim.

reason: up to 20 words naming the claim the sentences do not state or contradict; "all stated" when supported.`,
  user: (p) =>
    `Fact:\n${p.fact}\n\nCited sentences:\n${p.cited.map((c) => `[${c.id}] ${c.text}`).join("\n")}`,
};

export const SUPPORT_MAX_OUTPUT_TOKENS = 1200;
/** What a dry run assumes one verdict costs in output tokens, Luna's reasoning included. */
export const SUPPORT_EXPECTED_OUTPUT_TOKENS = 400;

export interface ScorerDeps {
  ai: CreatedAi;
  budget: Budget;
  logger?: pino.Logger;
  signal?: AbortSignal;
}

/** One fact checked: one structured call on the `standard` class (the host maps it to `SUPPORT_MODEL`). */
export async function checkSupport(
  packet: SupportPacket,
  deps: ScorerDeps,
): Promise<SupportResult> {
  const r = await callStructured<SupportPacket, SupportCheck>({
    deps: {
      ai: deps.ai,
      budget: deps.budget,
      signal: deps.signal ?? new AbortController().signal,
      logger: deps.logger ?? pino({ level: "silent" }),
      context: { lessonId: packet.factRef, jobId: "bakeoff-support" },
    },
    stage: "evaluate",
    cls: "standard",
    effort: SUPPORT_EFFORT,
    prompt: SUPPORT_PROMPT,
    input: packet,
    schema: SupportCheckSchema,
    maxOutputTokens: SUPPORT_MAX_OUTPUT_TOKENS,
    timeoutMs: 120_000,
  });
  const usage = callUsageOf(r.usage);
  return {
    factRef: packet.factRef,
    verdict: r.output.verdict,
    note: r.output.reason,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    costUsd: (usage && costUsd(r.modelId, usage)) ?? undefined,
  };
}

/** Expected list cost of checking these packets, one attempt each. */
export function supportDryRun(packets: SupportPacket[]): {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
} {
  let inputTokens = 0;
  for (const p of packets)
    inputTokens +=
      estimateTokens(SUPPORT_PROMPT.system) + estimateTokens(SUPPORT_PROMPT.user(p)) + 200;
  const outputTokens = SUPPORT_EXPECTED_OUTPUT_TOKENS * packets.length;
  return {
    calls: packets.length,
    inputTokens,
    outputTokens,
    usd: costUsd(SUPPORT_MODEL, { inputTokens, outputTokens, cachedInputTokens: 0 }) ?? 0,
  };
}

export interface SupportLabelScore {
  label: string;
  facts: number;
  /** Invalid-evidence facts, scored unsupported by code and never sent. */
  invalidEvidence: number;
  verdicts: Record<SupportVerdict, number>;
  /** (supported + partly / 2) over every fact, invalid ones included. */
  supportRate: number;
  costUsd: number;
  results: SupportResult[];
}

export function summariseSupport(
  label: string,
  results: SupportResult[],
  invalid: number,
): SupportLabelScore {
  const verdicts: Record<SupportVerdict, number> = {
    supported: 0,
    partly: 0,
    unsupported: invalid,
    contradicted: 0,
  };
  for (const r of results) verdicts[r.verdict] += 1;
  const facts = results.length + invalid;
  return {
    label,
    facts,
    invalidEvidence: invalid,
    verdicts,
    supportRate: facts ? (verdicts.supported + verdicts.partly / 2) / facts : 0,
    costUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    results,
  };
}

/** The `<label>.json` sets of a blind dir (single-letter names only; score files are skipped). */
export async function readBlindSets(blindDir: string): Promise<BlindSet[]> {
  const names = (await readdir(blindDir)).filter((f) => /^[A-Z]\.json$/.test(f)).sort();
  const sets: BlindSet[] = [];
  for (const f of names) sets.push(JSON.parse(await readFile(join(blindDir, f), "utf8")));
  return sets;
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

if (import.meta.main) {
  const blindDir = arg("blind");
  if (!blindDir) {
    console.error(
      "usage: support-checker.ts --blind <dir> [--lab <dir>] [--budget <usd>] [--concurrency 4] [--dry-run]",
    );
    process.exit(2);
  }
  const lab = resolve(arg("lab") ?? DEFAULT_LAB);
  const dir = resolve(blindDir);
  const sets = await readBlindSets(dir);
  if (sets.length === 0 || sets[0]?.task !== "rewrite")
    throw new Error(`${dir}: no rewrite sets (${basename(dir)})`);
  const set = sets[0]?.set as "dev" | "test";
  const sentences = Object.fromEntries(
    (await loadItems(lab, "rewrite", set)).map((i) => [i.id, i.values.sentences as string]),
  );
  const work: { label: string; packets: SupportPacket[]; invalid: number }[] = [];
  for (const s of sets) {
    const packets: SupportPacket[] = [];
    let invalid = 0;
    for (const item of s.items) {
      if (!item.ok || !item.output) continue;
      const block = sentences[item.id];
      if (!block) throw new Error(`no section input for ${item.id}`);
      const r = supportPackets(item.id, item.output as RewriteOutput, block);
      packets.push(...r.packets);
      invalid += r.invalid.length;
    }
    work.push({ label: s.label, packets, invalid });
  }
  const all = work.flatMap((w) => w.packets);
  const dry = supportDryRun(all);
  console.log(
    `${basename(dir)}: ${sets.length} sets, ${all.length} facts to check on ${SUPPORT_MODEL} @ ${SUPPORT_EFFORT} (+${work.reduce((s, w) => s + w.invalid, 0)} invalid-evidence, scored by code); expected list cost $${dry.usd.toFixed(4)} (~${dry.inputTokens} in + ~${dry.outputTokens} out)`,
  );
  if (process.argv.includes("--dry-run")) process.exit(0);

  const budgetUsd = Number(arg("budget"));
  if (!(budgetUsd > 0)) throw new Error("set --budget <usd> for a live run");
  const ai = createAi({
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    AI_MODEL_STANDARD: SUPPORT_MODEL,
  });
  if (ai.kind === "unconfigured") throw new Error("set AI_GATEWAY_API_KEY (railway run)");
  const budget = createBudget({ capUsd: budgetUsd, capTokens: 20_000 * Math.max(1, all.length) });
  const concurrency = Number(arg("concurrency") ?? 4);
  const scores: SupportLabelScore[] = [];
  for (const w of work) {
    const results = await mapPool(w.packets, concurrency, (p) => checkSupport(p, { ai, budget }));
    scores.push(summariseSupport(w.label, results, w.invalid));
  }
  await writeFile(
    join(dir, "support-scores.json"),
    `${JSON.stringify({ model: SUPPORT_MODEL, effort: SUPPORT_EFFORT, scores }, null, 2)}\n`,
  );
  console.log("label  facts  supported  partly  unsupported  contradicted  rate   cost");
  for (const s of scores)
    console.log(
      `${s.label.padEnd(6)} ${String(s.facts).padStart(5)}  ${String(s.verdicts.supported).padStart(9)}  ${String(s.verdicts.partly).padStart(6)}  ${String(s.verdicts.unsupported).padStart(11)}  ${String(s.verdicts.contradicted).padStart(12)}  ${s.supportRate.toFixed(2)}  $${s.costUsd.toFixed(4)}`,
    );
}
