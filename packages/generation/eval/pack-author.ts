#!/usr/bin/env bun
// bun packages/generation/eval/pack-author.ts --topic <id> --arm luna-rewrite|sol-rewrite|sol-knowledge
//   [--dry-run] [--cap 0.10] [--out <dir>] [--no-check]
//   or: bun packages/generation/eval/pack-author.ts --mode recall --topic <id> [--only sec1] (W7 arm M)
//
// Writes one topic pack by one authoring arm (quality PRD np1, the thing under test):
//   luna-rewrite   gpt-5.6-luna rewrites the section's facts from its source sentences, in its own words
//   sol-rewrite    gpt-6-sol does the same
//   sol-knowledge  gpt-6-sol writes from its own knowledge; a luna call then links every fact to the
//                  source sentences that support it (a fact no sentence supports is reported and
//                  left out: the pack schema requires evidence on every fact)
// After writing, code measures verbatim overlap (longest shared word run; flagged at 8) and two
// checkers — luna and sol, each blind to the other — declare per fact whether the evidence
// supports it and whether it is correct. Both verdict lists are recorded as given; nothing here
// decides admission. Live calls need `railway run --` from the repo root (AI_GATEWAY_API_KEY);
// every prompt is a STUB until the prompt-engineer writes it, and a stub refuses to run live.
//
// Writes `eval/packs/<topic>.<arm>.json` (the pack) and `eval/results/packs/<topic>.<arm>/`
// (report.json with overlap, checks, unlinked facts; ledger.json; calls.jsonl).

import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { type CreatedAi, createAi, createBudget, PRICES } from "@tj/ai";
import pino from "pino";
import { z } from "zod";
import { callStructured } from "../src/call";
import type { PipelineDeps } from "../src/types";
import {
  type AuthoringArm,
  type Experiment,
  type ExperimentTopic,
  loadExperiment,
} from "./experiments/np1";
import { createLedger, type Ledger, meteringAi } from "./ledger";
import { type FactOverlapRow, factText, sectionOverlap } from "./packs/overlap";
import {
  assertNoStubs,
  checkFactText,
  type PackCheckOutput,
  PackCheckOutputSchema,
  type PackKnowledgeOutput,
  PackKnowledgeOutputSchema,
  PackLinkOutputSchema,
  PackRecallOutputSchema,
  type PackWriteOutput,
  PackWriteOutputSchema,
  packCheckPrompt,
  packKnowledgePrompt,
  packLinkPrompt,
  packRecallPrompt,
  packRewritePrompt,
} from "./packs/prompts";
import {
  checkPack,
  EvidenceSchema,
  FACT_TYPES,
  type FactType,
  type Pack,
  type PackFacts,
  type PackIssue,
  PackKeyIdeaSchema,
  PackMisconceptionSchema,
  PackQuestionSchema,
  PackSchema,
  type PackSection,
  type PackSource,
  PackVocabularySchema,
  PackWorkedExampleSchema,
  SectionSchema,
  type Sentence,
} from "./packs/schema";
import { fetchPage, toPackSource } from "./packs/sources";

export const MAX_OUTPUT_TOKENS_PACK = {
  // pack-rewrite.v1 smoke (Luna, 79-sentence window, 12 items with evidence): 3,178 output tokens;
  // at 2,400 both attempts truncated. One observation, so the ceiling is set with headroom.
  write: 4000,
  knowledge: 2000,
  link: 800,
  // pack-check.v1 on romans.luna-rewrite (12 facts a section): Luna at low effort hit 600 on all
  // six attempts (three sections × two) and none validated; Sol answered sec1 in 451. Raised so
  // the cap is not the reason a check fails (the budget reserves it at list price: Sol ≈ $0.015).
  check: 1500,
  // pack-recall.v1 on Sol: the rewrite's facts without evidence (Sol rewrite averaged ~2,840
  // output tokens a section with evidence, reasoning included). Kept under $0.03 a call at list
  // price so one smoke call fits a $0.03 cap.
  recall: 2800,
} as const;

/** The deps a call needs, one per model the arm uses; `luna`/`sol` name the checker each runs on. */
export interface AuthorDeps {
  writer: PipelineDeps;
  linker: PipelineDeps;
  checkerLuna: PipelineDeps;
  checkerSol: PipelineDeps;
}

export interface SectionReport {
  id: string;
  outcome: string;
  window: number;
  overlap: FactOverlapRow[];
  /** Facts the link call left unsupported (arm 3 only), flattened, so the reader sees what went. */
  /** `supported` is the link call's own word; `yes` with no evidence given, or `none` when it named no link. */
  unlinked: { type: FactType; text: string; supported: "yes" | "partly" | "no" | "none" }[];
  checks: { luna: PackCheckOutput["verdicts"] | null; sol: PackCheckOutput["verdicts"] | null };
  /** The order the checkers' `fact` numbers refer to. */
  factOrder: { type: FactType; index: number }[];
  issues: PackIssue[];
  timings: { writeMs: number; linkMs: number; checkMs: number };
}

export interface AuthorReport {
  topic: string;
  arm: AuthoringArm;
  sections: SectionReport[];
  flagged: number;
  facts: number;
  issues: number;
  status: { executed: boolean; complete: boolean; incomplete: string[] };
}

/** Sentences whose heading path is one of the section's headings, in reading order, capped. */
export function windowFor(
  sources: readonly PackSource[],
  headings: readonly string[],
  max: number,
): Sentence[] {
  const want = new Set(headings);
  const out: Sentence[] = [];
  for (const s of sources) for (const x of s.sentences) if (want.has(x.heading)) out.push(x);
  return out.slice(0, max);
}

const urlOfSentence = (sources: readonly PackSource[], id: string): string => {
  const ordinal = id.split(".")[0];
  const src = sources.find((s) => s.id === ordinal);
  if (!src) throw new Error(`evidence cites ${id}, which belongs to no source`);
  return src.url;
};

/** A writing call's answer as pack facts: evidence gains the source url; nothing else changes. */
export function toPackFacts(written: PackWriteOutput, sources: readonly PackSource[]): PackFacts {
  const withUrl = <T extends { evidence: { sentenceIds: string[]; snippet: string }[] }>(x: T) => ({
    ...x,
    evidence: x.evidence.map((e) => ({
      url: urlOfSentence(sources, e.sentenceIds[0] ?? ""),
      sentenceIds: e.sentenceIds,
      snippet: e.snippet,
    })),
  });
  return {
    keyIdeas: written.keyIdeas.map(withUrl),
    misconceptions: written.misconceptions.map(withUrl),
    vocabulary: written.vocabulary.map(withUrl),
    workedExamples: written.workedExamples.map(withUrl),
    questions: written.questions.map(withUrl),
  };
}

/** Every fact of an answer in one flat order (the order link and check calls number them by). */
export function flatten(
  facts: PackKnowledgeOutput | PackFacts,
): { type: FactType; index: number; text: string }[] {
  const out: { type: FactType; index: number; text: string }[] = [];
  for (const type of FACT_TYPES)
    (facts[type] as unknown[]).forEach((fact, index) => {
      out.push({ type, index, text: factText(type, fact as never) });
    });
  return out;
}

/**
 * Arm 3's second step: attach the link call's evidence to the knowledge call's facts. A fact the
 * call marked `no`, or gave no evidence, is dropped from the pack and returned in `unlinked`.
 */
export function attachLinks(
  facts: PackKnowledgeOutput,
  links: z.infer<typeof PackLinkOutputSchema>["links"],
  sources: readonly PackSource[],
): { facts: PackFacts; unlinked: SectionReport["unlinked"] } {
  const flat = flatten(facts);
  const byFact = new Map(links.map((l) => [l.fact, l]));
  const out: PackFacts = {
    keyIdeas: [],
    misconceptions: [],
    vocabulary: [],
    workedExamples: [],
    questions: [],
  };
  const unlinked: SectionReport["unlinked"] = [];
  // Misconception ordinals must survive the drop: remap by the kept misconceptions' new indexes.
  const keptMisconception = new Map<number, number>();
  flat.forEach((f, n) => {
    const link = byFact.get(n);
    if (!link || link.supported === "no" || link.evidence.length === 0) {
      unlinked.push({ type: f.type, text: f.text, supported: link ? link.supported : "none" });
      return;
    }
    const evidence = link.evidence.map((e) => ({
      url: urlOfSentence(sources, e.sentenceIds[0] ?? ""),
      sentenceIds: e.sentenceIds,
      snippet: e.snippet,
    }));
    const fact = (facts[f.type] as unknown[])[f.index] as Record<string, unknown>;
    if (f.type === "misconceptions") keptMisconception.set(f.index, out.misconceptions.length);
    (out[f.type] as unknown[]).push({ ...fact, evidence });
  });
  const remap = (ref: { type: "misconception"; index: number } | undefined) => {
    if (!ref) return {};
    const to = keptMisconception.get(ref.index);
    return to === undefined
      ? {}
      : { misconceptionRef: { type: "misconception" as const, index: to } };
  };
  out.workedExamples = out.workedExamples.map(({ misconceptionRef, ...x }) => ({
    ...x,
    ...remap(misconceptionRef),
  }));
  out.questions = out.questions.map((q) => ({
    ...q,
    ...(q.distractors
      ? {
          distractors: q.distractors.map(({ misconceptionRef, ...d }) => ({
            ...d,
            ...remap(misconceptionRef),
          })),
        }
      : {}),
  }));
  return { facts: out, unlinked };
}

/**
 * The checker's user-turn input for one section: every fact labelled by type, each followed by the
 * text of the sentences it cites. Exported so a check can be re-run on a written pack
 * (`pack-recheck.ts`) with the input the authoring run would have built.
 */
export function checkInputFor(
  topic: Pick<ExperimentTopic, "subject" | "yearGroup">,
  outcome: string,
  facts: PackFacts,
  window: readonly Sentence[],
) {
  const sentenceById = new Map(window.map((s) => [s.id, s.text]));
  return {
    subject: topic.subject,
    yearGroup: topic.yearGroup,
    outcome,
    facts: flatten(facts).map((f) => {
      const fact = (facts[f.type] as { evidence: { sentenceIds: string[] }[] }[])[f.index];
      const ids = fact?.evidence.flatMap((e) => e.sentenceIds) ?? [];
      return {
        text: checkFactText(f.type, fact ?? {}),
        evidence: ids.map((sid) => `${sid}: ${sentenceById.get(sid) ?? "(outside the window)"}`),
      };
    }),
  };
}

export interface AuthorOptions {
  check?: boolean;
  /** Only these section ids (`sec2`); the rest are skipped, not reported (a retry of failed sections). */
  only?: readonly string[];
  now?: () => Date;
  /** Wraps `fetchPage` for tests (no network). */
  loadSources?: (topic: ExperimentTopic) => Promise<PackSource[]>;
}

async function defaultLoadSources(topic: ExperimentTopic): Promise<PackSource[]> {
  const out: PackSource[] = [];
  let ordinal = 0;
  for (const req of topic.sources)
    out.push(toPackSource(await fetchPage(req), ++ordinal, req.licence));
  return out;
}

/** Write one pack by one arm. Never throws for a failed section: the report names it and `complete` is false. */
export async function authorPack(
  exp: Experiment,
  topic: ExperimentTopic,
  arm: AuthoringArm,
  deps: AuthorDeps,
  options: AuthorOptions = {},
): Promise<{ pack: Pack; report: AuthorReport }> {
  const now = options.now ?? (() => new Date());
  const sources = await (options.loadSources ?? defaultLoadSources)(topic);
  const sections: PackSection[] = [];
  const reports: SectionReport[] = [];
  const incomplete: string[] = [];
  const models = { writer: "", linker: "", checkerLuna: "", checkerSol: "" };
  for (const [i, spec] of topic.sections.entries()) {
    const id = `sec${i + 1}`;
    if (options.only && !options.only.includes(id)) continue;
    const window = windowFor(sources, spec.headings, exp.windowMaxSentences);
    if (window.length === 0) {
      incomplete.push(`${id}: no source sentence under its headings`);
      continue;
    }
    const base = {
      topic: topic.id,
      subject: topic.subject,
      yearGroup: topic.yearGroup,
      outcome: spec.outcome,
    };
    let facts: PackFacts;
    let unlinked: SectionReport["unlinked"] = [];
    const timings = { writeMs: 0, linkMs: 0, checkMs: 0 };
    try {
      const t0 = Date.now();
      if (arm === "sol-knowledge") {
        const known = await callStructured({
          deps: deps.writer,
          stage: "plan",
          cls: "standard",
          effort: "medium",
          prompt: packKnowledgePrompt,
          input: base,
          schema: PackKnowledgeOutputSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS_PACK.knowledge,
        });
        models.writer = known.modelId;
        timings.writeMs = Date.now() - t0;
        const t1 = Date.now();
        const linked = await callStructured({
          deps: deps.linker,
          stage: "plan",
          cls: "standard",
          effort: "low",
          prompt: packLinkPrompt,
          input: {
            outcome: spec.outcome,
            facts: flatten(known.output).map((f) => f.text),
            sentences: window,
          },
          schema: PackLinkOutputSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS_PACK.link,
        });
        models.linker = linked.modelId;
        timings.linkMs = Date.now() - t1;
        ({ facts, unlinked } = attachLinks(known.output, linked.output.links, sources));
      } else {
        const written = await callStructured({
          deps: deps.writer,
          stage: "plan",
          cls: "standard",
          effort: "medium",
          prompt: packRewritePrompt,
          input: { ...base, sentences: window },
          schema: PackWriteOutputSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS_PACK.write,
        });
        models.writer = written.modelId;
        timings.writeMs = Date.now() - t0;
        facts = toPackFacts(written.output, sources);
      }
    } catch (error) {
      incomplete.push(
        `${id}: writing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const section: PackSection = {
      id,
      outcome: spec.outcome,
      sentenceIds: window.map((s) => s.id),
      facts,
    };
    const overlap = sectionOverlap(facts, window);
    const factOrder = flatten(facts).map(({ type, index }) => ({ type, index }));
    const checks: SectionReport["checks"] = { luna: null, sol: null };
    if (options.check !== false) {
      const t2 = Date.now();
      const input = checkInputFor(topic, spec.outcome, facts, window);
      // Two checkers, blind to each other: separate calls, separate deps, neither sees the other's answer.
      const [luna, sol] = await Promise.all(
        (
          [
            ["checkerLuna", deps.checkerLuna],
            ["checkerSol", deps.checkerSol],
          ] as const
        ).map(async ([key, d]) => {
          try {
            const r = await callStructured({
              deps: d,
              stage: "plan",
              cls: "standard",
              effort: "low",
              prompt: packCheckPrompt,
              input,
              schema: PackCheckOutputSchema,
              maxOutputTokens: MAX_OUTPUT_TOKENS_PACK.check,
            });
            models[key] = r.modelId;
            return r.output.verdicts;
          } catch (error) {
            incomplete.push(
              `${id}: ${key} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          }
        }),
      );
      checks.luna = luna ?? null;
      checks.sol = sol ?? null;
      timings.checkMs = Date.now() - t2;
    }
    sections.push(section);
    reports.push({
      id,
      outcome: spec.outcome,
      window: window.length,
      overlap,
      unlinked,
      checks,
      factOrder,
      issues: [],
      timings,
    });
  }
  const pack: Pack = {
    id: `${topic.id}.${arm}`,
    topic: topic.id,
    subject: topic.subject,
    yearGroup: topic.yearGroup,
    arm,
    writtenAt: now().toISOString(),
    provenance: {
      writer: models.writer,
      writerPrompt:
        arm === "sol-knowledge" ? packKnowledgePrompt.version : packRewritePrompt.version,
      ...(arm === "sol-knowledge"
        ? { linker: models.linker, linkerPrompt: packLinkPrompt.version }
        : {}),
    },
    sources,
    sections,
  };
  const issues = sections.length > 0 ? checkPack(pack) : [];
  for (const issue of issues) {
    const m = issue.path.match(/^sections\[(\d+)\]/);
    const r = m ? reports[Number(m[1])] : undefined;
    if (r) r.issues.push(issue);
  }
  const flagged = reports.reduce(
    (n, r) => n + r.overlap.filter((o) => o.overlap.flagged).length,
    0,
  );
  const facts = reports.reduce((n, r) => n + r.factOrder.length, 0);
  return {
    pack,
    report: {
      topic: topic.id,
      arm,
      sections: reports,
      flagged,
      facts,
      issues: issues.length,
      status: {
        executed: true,
        complete: incomplete.length === 0 && sections.length === topic.sections.length,
        incomplete,
      },
    },
  };
}

/* ------------------------------ W7 arm M: Sol from memory -------------------------------- */

export const RECALL_ARM = "sol-recall";

/*
 * A recall pack: the pack schema with no sources, so every `evidence` list and every section's
 * `sentenceIds` is empty, and the writer is named as model recall. Derived from the pack schema's
 * own pieces so the item shapes cannot drift; it is its own schema because `PackSchema` requires
 * evidence on every fact.
 */
const noEvidence = { evidence: z.array(EvidenceSchema).max(0) };
export const RecallPackSchema = PackSchema.extend({
  arm: z.literal(RECALL_ARM),
  provenance: z.strictObject({
    writer: z.string().startsWith("model-recall: "),
    writerPrompt: z.string(),
  }),
  sources: z.array(z.never()).max(0),
  sections: z
    .array(
      SectionSchema.extend({
        sentenceIds: z.array(z.string()).max(0),
        facts: z.strictObject({
          keyIdeas: z.array(PackKeyIdeaSchema.extend(noEvidence)),
          misconceptions: z.array(PackMisconceptionSchema.extend(noEvidence)),
          vocabulary: z.array(PackVocabularySchema.extend(noEvidence)),
          workedExamples: z.array(PackWorkedExampleSchema.extend(noEvidence)),
          questions: z.array(PackQuestionSchema.extend(noEvidence)),
        }),
      }),
    )
    .min(1),
});
export type RecallPack = z.infer<typeof RecallPackSchema>;

export interface RecallReport {
  topic: string;
  arm: typeof RECALL_ARM;
  sections: { id: string; outcome: string; facts: number; writeMs: number }[];
  facts: number;
  status: { executed: boolean; complete: boolean; incomplete: string[] };
}

/**
 * Write one topic's pack from Sol's own knowledge: one pack-recall call per section, no sources,
 * no link and no check (the W7 audit is done in session, blind to arm). A failed section is named
 * in the report and `complete` is false; it never throws for one.
 */
export async function recallPack(
  topic: ExperimentTopic,
  writer: PipelineDeps,
  options: Pick<AuthorOptions, "only" | "now"> = {},
): Promise<{ pack: RecallPack; report: RecallReport }> {
  const now = options.now ?? (() => new Date());
  const sections: RecallPack["sections"] = [];
  const reports: RecallReport["sections"] = [];
  const incomplete: string[] = [];
  let modelId = "";
  for (const [i, spec] of topic.sections.entries()) {
    const id = `sec${i + 1}`;
    if (options.only && !options.only.includes(id)) continue;
    const t0 = Date.now();
    try {
      const r = await callStructured({
        deps: writer,
        stage: "plan",
        cls: "standard",
        effort: "medium",
        prompt: packRecallPrompt,
        input: {
          topic: topic.id,
          subject: topic.subject,
          yearGroup: topic.yearGroup,
          outcome: spec.outcome,
        },
        schema: PackRecallOutputSchema,
        maxOutputTokens: MAX_OUTPUT_TOKENS_PACK.recall,
      });
      modelId = r.modelId;
      const o = r.output;
      const facts = {
        keyIdeas: o.keyIdeas.map((x) => ({ ...x, evidence: [] })),
        misconceptions: o.misconceptions.map((x) => ({ ...x, evidence: [] })),
        vocabulary: o.vocabulary.map((x) => ({ ...x, evidence: [] })),
        workedExamples: o.workedExamples.map((x) => ({ ...x, evidence: [] })),
        questions: o.questions.map((x) => ({ ...x, evidence: [] })),
      };
      sections.push({ id, outcome: spec.outcome, sentenceIds: [], facts });
      reports.push({
        id,
        outcome: spec.outcome,
        facts: FACT_TYPES.reduce((n, t) => n + facts[t].length, 0),
        writeMs: Date.now() - t0,
      });
    } catch (error) {
      incomplete.push(
        `${id}: writing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const pack: RecallPack = {
    id: `${topic.id}.${RECALL_ARM}`,
    topic: topic.id,
    subject: topic.subject,
    yearGroup: topic.yearGroup,
    arm: RECALL_ARM,
    writtenAt: now().toISOString(),
    provenance: {
      // "model-recall: gpt-6-sol": the model the facts came from, with no source behind them.
      writer: `model-recall: ${modelId.split("/").pop() ?? modelId}`,
      writerPrompt: packRecallPrompt.version,
    },
    sources: [],
    sections,
  };
  return {
    pack,
    report: {
      topic: topic.id,
      arm: RECALL_ARM,
      sections: reports,
      facts: reports.reduce((n, r) => n + r.facts, 0),
      status: {
        executed: true,
        complete: incomplete.length === 0 && sections.length === topic.sections.length,
        incomplete,
      },
    },
  };
}

/* ----------------------------------------------------------------------------------------- */

const EnvSchema = z.object({ AI_GATEWAY_API_KEY: z.string().optional() });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

export function depsFor(
  ai: CreatedAi,
  budget: ReturnType<typeof createBudget>,
  signal: AbortSignal,
): PipelineDeps {
  const silent = new Writable({ write: (_c, _e, cb) => cb() });
  return {
    ai,
    budget,
    signal,
    // PACK_LOG=1 sends warnings (validation issues, timeouts) to stderr; silent otherwise.
    logger: pino({ level: "warn" }, process.env.PACK_LOG ? pino.destination(2) : silent),
    now: () => new Date(),
    ids: () => "x",
    sources: async () => [],
    persist: async () => ({ updatedAt: new Date().toISOString() }),
    onProgress: async () => {},
    context: { lessonId: "pack", jobId: "pack" },
  };
}

export function routedAi(
  env: { AI_GATEWAY_API_KEY?: string },
  id: string,
  ledger: Ledger,
  record: string,
): CreatedAi {
  const created = createAi(env, { route: () => id });
  if (created.kind === "unconfigured") throw new Error("set AI_GATEWAY_API_KEY (railway run --)");
  const metered = meteringAi(created, ledger);
  return {
    ...metered,
    model: (cls, context) => {
      void appendFile(
        record,
        `${JSON.stringify({ at: new Date().toISOString(), model: id, promptVersion: context?.promptVersion })}\n`,
      );
      return metered.model(cls, context);
    },
  };
}

/**
 * `--mode recall`: W7 arm M. Writes `eval/packs/<topic>.sol-recall.json` and
 * `eval/results/packs/<topic>.sol-recall/` (report.json, ledger.json, calls.jsonl). With `--only`
 * and a pack already on disk, the named sections replace theirs and the rest are kept.
 */
async function runRecall(exp: Experiment, topic: ExperimentTopic): Promise<never> {
  const writerId = exp.models.writerSol ?? "";
  const n = topic.sections.length;
  const only = arg("only")?.split(",");
  const calls = only ? only.length : n;
  const p = PRICES[writerId];
  const worst = p
    ? (calls * (1000 * p.inputPerMTok + MAX_OUTPUT_TOKENS_PACK.recall * p.outputPerMTok)) / 1e6
    : Number.NaN;
  console.log(`pack ${topic.id} by ${RECALL_ARM} (${packRecallPrompt.version}, ${writerId})`);
  console.log(
    `${calls} call(s), no sources, no checks; at most $${worst.toFixed(4)} at the ${MAX_OUTPUT_TOKENS_PACK.recall}-token output cap`,
  );
  for (const [i, s] of topic.sections.entries())
    if (!only || only.includes(`sec${i + 1}`)) console.log(`sec${i + 1}: ${s.outcome}`);
  if (flag("dry-run")) process.exit(0);
  assertNoStubs([packRecallPrompt]);
  const env = EnvSchema.parse(process.env);
  const outDir =
    arg("out") ?? join(import.meta.dir, "results", "packs", `${topic.id}.${RECALL_ARM}`);
  await mkdir(outDir, { recursive: true });
  const ledger = createLedger({ run: `pack-${topic.id}-${RECALL_ARM}` });
  const budget = createBudget({ capUsd: Number(arg("cap") ?? 0.1), capTokens: 2_000_000 });
  const writer = depsFor(
    routedAi(env, writerId, ledger, join(outDir, "calls.jsonl")),
    budget,
    new AbortController().signal,
  );
  const started = Date.now();
  let ledgerName = "ledger.json";
  for (let k = 2; await Bun.file(join(outDir, ledgerName)).exists(); k++)
    ledgerName = `ledger-${k}.json`;
  try {
    const { pack, report } = await recallPack(topic, writer, { only });
    const packPath = join(import.meta.dir, "packs", `${topic.id}.${RECALL_ARM}.json`);
    let out = pack;
    if (only && (await Bun.file(packPath).exists())) {
      const existing = RecallPackSchema.parse(await Bun.file(packPath).json());
      const byId = new Map(existing.sections.map((s) => [s.id, s]));
      for (const s of pack.sections) byId.set(s.id, s);
      const secNo = (id: string) => Number(id.replace("sec", ""));
      out = {
        ...existing,
        writtenAt: pack.writtenAt,
        sections: [...byId.values()].sort((a, b) => secNo(a.id) - secNo(b.id)),
      };
    }
    if (out.sections.length > 0) {
      RecallPackSchema.parse(out);
      await writeFile(packPath, `${JSON.stringify(out, null, 2)}\n`);
      console.log(`wrote ${packPath}`);
    }
    await writeFile(
      join(outDir, only ? "report-only.json" : "report.json"),
      JSON.stringify({ ...report, durationMs: Date.now() - started }, null, 2),
    );
    console.log(
      `status complete ${report.status.complete}${report.status.incomplete.length ? `: ${report.status.incomplete.join("; ")}` : ""}; ${report.facts} facts`,
    );
  } finally {
    // Flushed even when a call is refused or throws, so the spend is never lost.
    await writeFile(join(outDir, ledgerName), JSON.stringify(ledger.toJSON(), null, 2));
    console.log(`\n${ledger.markdown()}`);
  }
  process.exit(0);
}

if (import.meta.main) {
  const exp = loadExperiment();
  const topicId = arg("topic");
  if (arg("mode") === "recall") {
    const recallTopic = exp.topics.find((t) => t.id === topicId);
    if (!recallTopic) {
      console.error(
        `usage: pack-author.ts --mode recall --topic <${exp.topics.map((t) => t.id).join("|")}> [--only sec1,…] [--dry-run] [--cap usd]`,
      );
      process.exit(2);
    }
    await runRecall(exp, recallTopic);
  }
  const arm = arg("arm") as AuthoringArm | undefined;
  const topic = exp.topics.find((t) => t.id === topicId);
  if (!topic || !arm || !exp.authoringArms.includes(arm)) {
    console.error(
      `usage: pack-author.ts --topic <${exp.topics.map((t) => t.id).join("|")}> --arm <${exp.authoringArms.join("|")}> [--dry-run] [--cap usd]`,
    );
    process.exit(2);
  }
  const writerId = arm === "luna-rewrite" ? exp.models.writerLuna : exp.models.writerSol;
  const t = exp.estimates.tokens;
  const price = (id: string | undefined, name: string, n: number) => {
    const p = id ? PRICES[id] : undefined;
    const tk = t[name];
    return p && tk ? (n * (tk.in * p.inputPerMTok + tk.out * p.outputPerMTok)) / 1e6 : Number.NaN;
  };
  const sections = topic.sections.length;
  const plan: [string, string | undefined, number, number][] =
    arm === "sol-knowledge"
      ? [
          ["pack-knowledge", exp.models.writerSol, sections, MAX_OUTPUT_TOKENS_PACK.knowledge],
          ["pack-link", exp.models.linker, sections, MAX_OUTPUT_TOKENS_PACK.link],
        ]
      : [["pack-rewrite", writerId, sections, MAX_OUTPUT_TOKENS_PACK.write]];
  if (!flag("no-check"))
    plan.push(
      ["pack-check", exp.models.checkerLuna, sections, MAX_OUTPUT_TOKENS_PACK.check],
      ["pack-check", exp.models.checkerSol, sections, MAX_OUTPUT_TOKENS_PACK.check],
    );
  const est = plan.reduce((s, [name, id, n]) => s + price(id, name, n), 0);
  console.log(
    `pack ${topic.id} by ${arm}: ${sections} sections, window ≤ ${exp.windowMaxSentences} sentences`,
  );
  console.log("| call | model | n | out cap | est. USD |", "\n|---|---|---:|---:|---:|");
  for (const [name, id, n, cap] of plan)
    console.log(`| ${name} | ${id} | ${n} | ${cap} | $${price(id, name, n).toFixed(4)} |`);
  console.log(`expected spend $${est.toFixed(4)}`);
  if (flag("dry-run")) {
    const sources = await defaultLoadSources(topic);
    for (const [i, s] of topic.sections.entries())
      console.log(
        `sec${i + 1}: ${windowFor(sources, s.headings, exp.windowMaxSentences).length} sentences — ${s.outcome}`,
      );
    process.exit(0);
  }
  // Only the prompts this arm will call: a stub the arm never runs must not refuse the run.
  assertNoStubs(
    arm === "sol-knowledge"
      ? [packKnowledgePrompt, packLinkPrompt, packCheckPrompt]
      : [packRewritePrompt, packCheckPrompt],
  );
  const env = EnvSchema.parse(process.env);
  const outDir = arg("out") ?? join(import.meta.dir, "results", "packs", `${topic.id}.${arm}`);
  await mkdir(outDir, { recursive: true });
  const record = join(outDir, "calls.jsonl");
  const ledger = createLedger({ run: `pack-${topic.id}-${arm}` });
  const budget = createBudget({ capUsd: Number(arg("cap") ?? 0.1), capTokens: 2_000_000 });
  const signal = new AbortController().signal;
  const deps: AuthorDeps = {
    writer: depsFor(routedAi(env, writerId ?? "", ledger, record), budget, signal),
    linker: depsFor(routedAi(env, exp.models.linker ?? "", ledger, record), budget, signal),
    checkerLuna: depsFor(
      routedAi(env, exp.models.checkerLuna ?? "", ledger, record),
      budget,
      signal,
    ),
    checkerSol: depsFor(routedAi(env, exp.models.checkerSol ?? "", ledger, record), budget, signal),
  };
  const started = Date.now();
  const only = arg("only")?.split(",");
  const written = await authorPack(exp, topic, arm, deps, { check: !flag("no-check"), only });
  let { pack, report } = written;
  const packPath = join(import.meta.dir, "packs", `${topic.id}.${arm}.json`);
  const reportPath = join(outDir, "report.json");
  // `--only` on an arm with no pack yet is a partial first run: written as it is, complete false.
  if (only && (await Bun.file(packPath).exists())) {
    // A retry of named sections: merge into the pack and report on disk (the earlier run's report
    // is kept as report.run1.json, its ledger untouched; this run's ledger is ledger-retry*.json).
    const existing = PackSchema.parse(await Bun.file(packPath).json());
    const prior = (await Bun.file(reportPath).json()) as AuthorReport;
    const run1 = join(outDir, "report.run1.json");
    if (!(await Bun.file(run1).exists())) await copyFile(reportPath, run1);
    const secNo = (id: string) => Number(id.replace("sec", ""));
    const packById = new Map(existing.sections.map((s) => [s.id, s]));
    for (const s of pack.sections) packById.set(s.id, s);
    pack = {
      ...existing,
      writtenAt: pack.writtenAt,
      sections: [...packById.values()].sort((a, b) => secNo(a.id) - secNo(b.id)),
    };
    const reportById = new Map(prior.sections.map((r) => [r.id, r]));
    for (const r of report.sections) reportById.set(r.id, r);
    const sections = [...reportById.values()].sort((a, b) => secNo(a.id) - secNo(b.id));
    for (const r of sections) r.issues = [];
    const issues = checkPack(pack);
    for (const issue of issues) {
      const m = issue.path.match(/^sections\[(\d+)\]/);
      const r = m ? sections[Number(m[1])] : undefined;
      if (r) r.issues.push(issue);
    }
    const incomplete = [
      ...prior.status.incomplete.filter((m) => !only.some((id) => m.startsWith(`${id}:`))),
      ...report.status.incomplete,
    ];
    report = {
      ...prior,
      sections,
      flagged: sections.reduce((n, r) => n + r.overlap.filter((o) => o.overlap.flagged).length, 0),
      facts: sections.reduce((n, r) => n + r.factOrder.length, 0),
      issues: issues.length,
      status: {
        executed: true,
        complete: incomplete.length === 0 && sections.length === topic.sections.length,
        incomplete,
      },
    };
  }
  PackSchema.parse(pack);
  await writeFile(packPath, `${JSON.stringify(pack, null, 2)}\n`);
  await writeFile(
    reportPath,
    JSON.stringify(
      only
        ? { ...report, retryDurationMs: Date.now() - started, retried: only }
        : { ...report, durationMs: Date.now() - started },
      null,
      2,
    ),
  );
  let ledgerName = only ? "ledger-retry.json" : "ledger.json";
  for (let n = 2; await Bun.file(join(outDir, ledgerName)).exists(); n++)
    ledgerName = `ledger-retry-${n}.json`;
  await writeFile(join(outDir, ledgerName), JSON.stringify(ledger.toJSON(), null, 2));
  console.log(
    `status executed ${report.status.executed}, complete ${report.status.complete}${report.status.incomplete.length ? `: ${report.status.incomplete.join("; ")}` : ""}`,
  );
  console.log(
    `${report.facts} facts, ${report.flagged} flagged for overlap ≥ 8 words, ${report.issues} structural issues`,
  );
  console.log(`\n${ledger.markdown()}`);
  process.exit(report.status.executed ? 0 : 1);
}
