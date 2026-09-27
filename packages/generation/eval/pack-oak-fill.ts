#!/usr/bin/env bun
// bun packages/generation/eval/pack-oak-fill.ts --topic <id> [--only sec1,sec3] [--dry-run] [--cap 0.10]
//   [--render <file.md>] [--kinds quotation,date] [--packs-dir <dir>] [--model openai/gpt-6-sol]
//
// Lab l6kp2 (28 Sept 2026): the paid gap-fill for an Oak-seeded pack (quality-prd/lab/oak-packs).
// One pack-oak-fill.v1 call per section on gpt-6-sol, medium effort, writing only the fact kinds
// code names for the topic (TOPICS below, or --kinds). Writes
// `<packs-dir>/fill/<topic>.pack-oak-fill.v1.json`: per section the `certain` facts in the pack's
// fact schema (kind, locator, source: model) and the `unsure` ones kept apart for the record.
// Merging into the pack and the Q0 quotation check stay in oak-packs/build.py.
// `--render <file>` appends the request(s) as markdown and makes no call. `--dry-run` prints the
// plan and the worst-case spend. A live run needs OPENAI_API_KEY (openai/ ids) or
// AI_GATEWAY_API_KEY, and refuses to start above `--cap` (default $0.10).

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { createAi, createBudget, PRICES } from "@tj/ai";
import pino from "pino";
import { z } from "zod";
import { callStructured } from "../src/call";
import type { PipelineDeps } from "../src/types";
import {
  FILL_SOURCE,
  OAK_FILL_KINDS,
  type OakFillFact,
  type OakFillKind,
  oakFactLines,
  type PackOakFillInput,
  PackOakFillOutputSchema,
  packOakFillPrompt,
} from "./packs/oak-fill";

// pack-recall.v1 on Sol at medium used 1,847 output tokens (reasoning included) for a whole
// section; eight one-line facts need less. Headroom so truncation is not why a section fails.
export const MAX_OUTPUT_TOKENS_FILL = 2500;
const DEFAULT_MODEL = "openai/gpt-6-sol";

/** What each lab topic lacks (oak-packs/NEEDS-PROMPT.md) and, for literature, the text quoted. */
export const TOPICS: Record<
  string,
  { kinds: readonly OakFillKind[]; text?: { name: string; edition: string } }
> = {
  "y10-tempest": {
    kinds: ["quotation"],
    text: { name: "The Tempest (Shakespeare)", edition: "Project Gutenberg #1540" },
  },
  "y11-exposure": {
    kinds: ["quotation", "date"],
    text: { name: "Exposure (Wilfred Owen)", edition: "the AQA anthology reading" },
  },
  "y6-evacuation": { kinds: ["date", "figure", "namedSpecific"] },
  "y9-coasts": { kinds: ["figure", "namedSpecific"] },
  "y7-ratio": { kinds: ["workedExample"] },
};

/** Subjects outside the table: the kinds a closed-book pack most often lacks in that subject. */
const KINDS_BY_SUBJECT: Record<string, readonly OakFillKind[]> = {
  History: ["date", "figure", "namedSpecific"],
  Geography: ["figure", "namedSpecific"],
  Maths: ["workedExample"],
  Science: ["figure", "namedSpecific"],
};

const PackFileSchema = z.object({
  id: z.string(),
  topic: z.string(),
  subject: z.string(),
  yearGroup: z.string(),
  brief: z.string(),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      outcome: z.string(),
      facts: z.object({
        keyIdeas: z
          .array(
            z.object({
              statement: z.string(),
              quote: z.string().optional(),
              locator: z.string().optional(),
            }),
          )
          .default([]),
        vocabulary: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
        misconceptions: z
          .array(z.object({ belief: z.string(), correction: z.string() }))
          .default([]),
        workedExamples: z.array(z.object({ problem: z.string(), answer: z.string() })).default([]),
      }),
    }),
  ),
});
type PackFile = z.infer<typeof PackFileSchema>;

export function fillInputs(
  pack: PackFile,
  options: { only?: string[]; kinds?: readonly OakFillKind[] } = {},
): { id: string; input: PackOakFillInput }[] {
  const topic = TOPICS[pack.topic];
  const kinds = options.kinds ?? topic?.kinds ?? KINDS_BY_SUBJECT[pack.subject];
  if (!kinds?.length) throw new Error(`no kinds for ${pack.topic} (${pack.subject}): pass --kinds`);
  if (kinds.includes("quotation") && !topic?.text)
    throw new Error(`${pack.topic}: quotations need a set text in TOPICS`);
  return pack.sections
    .filter((s) => !options.only || options.only.includes(s.id))
    .map((s) => ({
      id: s.id,
      input: {
        subject: pack.subject,
        yearGroup: pack.yearGroup,
        brief: pack.brief,
        section: { title: s.title ?? s.outcome, outcome: s.outcome },
        existing: oakFactLines(s.facts),
        kinds,
        text: topic?.text,
      },
    }));
}

/** A fact as the pack stores it: the model's fields plus code's provenance. */
export function packFact(f: OakFillFact): Record<string, unknown> {
  const { confidence: _confidence, quote, ...rest } = f;
  return {
    ...rest,
    ...(quote ? { quote, statement: f.statement } : {}),
    ...FILL_SOURCE,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function depsFor(ai: PipelineDeps["ai"], budget: PipelineDeps["budget"]): PipelineDeps {
  const silent = new Writable({ write: (_c, _e, cb) => cb() });
  return {
    ai,
    budget,
    signal: new AbortController().signal,
    logger: pino({ level: "warn" }, process.env.PACK_LOG ? pino.destination(2) : silent),
    now: () => new Date(),
    ids: () => "x",
    sources: async () => [],
    persist: async () => ({ updatedAt: new Date().toISOString() }),
    onProgress: async () => {},
    context: { lessonId: "pack", jobId: "pack" },
  };
}

const tokensOf = (text: string) => Math.ceil(text.length / 4);

if (import.meta.main) {
  const topicId = arg("topic");
  if (!topicId) {
    console.error(
      `usage: pack-oak-fill.ts --topic <${Object.keys(TOPICS).join("|")}> [--only sec1,…] [--dry-run] [--cap usd] [--render file.md] [--kinds ${OAK_FILL_KINDS.join(",")}]`,
    );
    process.exit(2);
  }
  const packsDir = resolve(
    arg("packs-dir") ?? join(import.meta.dir, "../../../../quality-prd/lab/oak-packs"),
  );
  const pack = PackFileSchema.parse(await Bun.file(join(packsDir, `${topicId}.json`)).json());
  const only = arg("only")?.split(",");
  const kinds = arg("kinds")
    ?.split(",")
    .map((k) => z.enum(OAK_FILL_KINDS).parse(k));
  const requests = fillInputs(pack, { only, kinds });
  if (requests.length === 0) throw new Error(`no sections match --only ${only?.join(",")}`);
  const modelId = arg("model") ?? DEFAULT_MODEL;
  const price = PRICES[modelId];
  const worst = requests.reduce((usd, r) => {
    const inTok = tokensOf(packOakFillPrompt.system) + tokensOf(packOakFillPrompt.user(r.input));
    return (
      usd +
      (price
        ? (inTok * price.inputPerMTok + MAX_OUTPUT_TOKENS_FILL * price.outputPerMTok) / 1e6
        : Number.NaN)
    );
  }, 0);

  const renderTo = arg("render");
  if (renderTo) {
    const md = requests.map(
      (r) =>
        `## ${pack.topic} ${r.id} (${packOakFillPrompt.version}, ${modelId}, medium)\n\n### system\n\n\`\`\`\n${packOakFillPrompt.system}\n\`\`\`\n\n### user\n\n\`\`\`\n${packOakFillPrompt.user(r.input)}\n\`\`\`\n`,
    );
    await appendFile(renderTo, `${md.join("\n")}\n`);
    console.log(`rendered ${requests.length} request(s) to ${renderTo}; no call made`);
    process.exit(0);
  }

  console.log(`fill ${pack.topic} (${packOakFillPrompt.version}, ${modelId}, medium)`);
  console.log(
    `${requests.length} section(s), kinds ${requests[0]?.input.kinds.join(", ")}; at most $${worst.toFixed(4)} at the output cap`,
  );
  for (const r of requests) console.log(`${r.id}: ${r.input.section.outcome}`);
  if (flag("dry-run")) process.exit(0);

  const cap = Number(arg("cap") ?? 0.1);
  if (worst > cap) {
    console.error(`worst case $${worst.toFixed(4)} exceeds --cap ${cap}; narrow with --only`);
    process.exit(2);
  }
  const env = z
    .object({
      OPENAI_API_KEY: z.string().optional(),
      AI_GATEWAY_API_KEY: z.string().optional(),
      AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),
      AWS_REGION: z.string().optional(),
    })
    .parse(process.env);
  const ai = createAi(env, { route: () => modelId });
  if (ai.kind === "unconfigured") throw new Error("set OPENAI_API_KEY or AI_GATEWAY_API_KEY");
  const budget = createBudget({ capUsd: cap, capTokens: 2_000_000 });
  const deps = depsFor(ai, budget);
  const outDir = join(packsDir, "fill");
  await mkdir(outDir, { recursive: true });
  const out = {
    topic: pack.topic,
    packId: pack.id,
    promptVersion: packOakFillPrompt.version,
    modelId,
    writtenAt: new Date().toISOString(),
    spendUsd: 0,
    sections: [] as Record<string, unknown>[],
    failed: [] as string[],
  };
  try {
    for (const r of requests) {
      const t0 = Date.now();
      try {
        const res = await callStructured({
          deps,
          stage: "plan",
          cls: "standard",
          effort: "medium",
          prompt: packOakFillPrompt,
          input: r.input,
          schema: PackOakFillOutputSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS_FILL,
        });
        const certain = res.output.facts.filter((f) => f.confidence === "certain");
        const unsure = res.output.facts.filter((f) => f.confidence === "unsure");
        const usd = price
          ? ((res.usage.inputTokens ?? 0) * price.inputPerMTok +
              (res.usage.outputTokens ?? 0) * price.outputPerMTok) /
            1e6
          : Number.NaN;
        out.spendUsd += usd;
        out.sections.push({
          id: r.id,
          outcome: r.input.section.outcome,
          kinds: r.input.kinds,
          facts: certain.map(packFact),
          unsure,
          usage: { ...res.usage, usd, ms: Date.now() - t0 },
        });
        console.log(
          `${r.id}: ${certain.length} certain, ${unsure.length} unsure; $${usd.toFixed(4)} in ${Date.now() - t0} ms`,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        out.failed.push(`${r.id}: ${msg}`);
        console.error(`${r.id}: failed: ${msg}`);
      }
    }
  } finally {
    const path = join(outDir, `${pack.topic}.${packOakFillPrompt.version}.json`);
    await writeFile(path, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`wrote ${path}; spend $${out.spendUsd.toFixed(4)}`);
  }
  process.exit(out.failed.length ? 1 : 0);
}
