/*
 * Verify probe (designer prompts round 2): does verify-facts v7 catch the three knowledge errors
 * the round-1 judges found, at effort low (the pipeline's setting) and medium? Each set carries
 * the planted error as the round-1 deck stated it, plus one correct control fact, so a false
 * positive shows too. Six calls, gpt-6-luna, OpenAI direct.
 *
 *   bun eval/verify-probe.ts --out <dir> --spend <file.json> --cap 0.02
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import type { LessonFacts } from "@tj/domain/documents";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createOpenAI } from "../../ai/node_modules/@ai-sdk/openai";
import { verifyFactsPrompt } from "../src/prompts/verify-facts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = flag("--out") ?? "runs/verify-probe";
const spendFile = flag("--spend") ?? `${out}/spend.json`;
const cap = Number(flag("--cap") ?? "0.02");
mkdirSync(out, { recursive: true });
const openai = createOpenAI({
  apiKey: readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim(),
});
const model = openai("gpt-6-luna");
const PRICE = { in: 0.1e-6, cached: 0.01e-6, out: 0.5e-6 };
const readSpend = (): number => {
  try {
    return JSON.parse(readFileSync(spendFile, "utf8")).total_usd as number;
  } catch {
    return 0;
  }
};
const addSpend = (usd: number) =>
  writeFileSync(spendFile, JSON.stringify({ cap_usd: cap, total_usd: readSpend() + usd }, null, 1));

const Out = z.object({
  corrections: z.array(
    z.object({
      factId: z.string(),
      field: z.string(),
      index: z.number().optional(),
      value: z.unknown(),
      reason: z.string(),
    }),
  ),
});

const base = { misconceptions: [], vocabulary: [], workedExamples: [], outline: [] };
const k = (id: string, statement: string, explanation: string, example: string) => ({
  id,
  statement,
  explanation,
  example,
  objectiveRefs: ["o1"],
});
const q = (id: string, stem: string, answer: string, distractors?: string[]) => ({
  id,
  stem,
  answer,
  reasoning: "As taught on the slide.",
  objectiveRefs: ["o1"],
  ...(distractors ? { distractors: distractors.map((text) => ({ text })) } : {}),
});

const SETS: {
  id: string;
  audience: { subject: string; yearGroup: string };
  topic: string;
  facts: unknown;
  planted: string;
}[] = [
  {
    id: "electrolysis",
    audience: { subject: "Chemistry", yearGroup: "Year 10" },
    topic: "Electrolysis of aqueous solutions: predicting the products at each electrode",
    planted: "k2/q2: dilute sodium bromide said to give oxygen at the anode (bromine forms)",
    facts: {
      ...base,
      objectives: [
        {
          id: "o1",
          text: "Explain how halide concentration affects the anode product in aqueous electrolysis",
        },
      ],
      keyIdeas: [
        k(
          "k1",
          "Less reactive metal ions are discharged instead of hydrogen ions",
          "At the cathode, positive ions gain electrons; metal ions less reactive than hydrogen are discharged to form the metal.",
          "Copper sulfate solution gives copper at the cathode.",
        ),
        k(
          "k2",
          "Concentrated halide solutions form halogens at the anode",
          "When a halide solution is dilute, oxygen is usually formed instead. The concentration affects which negative ions are discharged at the anode.",
          "Concentrated sodium chloride solution gives chlorine.",
        ),
      ],
      questions: [
        q("q1", "Aqueous sodium chloride is electrolysed. What forms at the cathode?", "Hydrogen", [
          "Sodium",
          "Chlorine",
          "Oxygen",
        ]),
        q(
          "q2",
          "What is usually formed at the anode when a dilute aqueous sodium bromide solution is electrolysed?",
          "Oxygen",
          ["Bromine", "Sodium", "Hydrogen"],
        ),
      ],
    },
  },
  {
    id: "rivers",
    audience: { subject: "Geography", yearGroup: "Year 5" },
    topic: "Rivers: the journey of a river from source to mouth",
    planted: "k1/q1: the steep upper course makes the river fast (velocity rises downstream)",
    facts: {
      ...base,
      objectives: [
        { id: "o1", text: "Explain how steep gradients shape a narrow, fast upper-course river" },
      ],
      keyIdeas: [
        k(
          "k1",
          "A steep slope makes an upper-course river fast",
          "Near its source, a river flows down a steep slope, called a gradient. Fast-flowing water erodes the bed and banks, helping to make a narrow, steep-sided valley.",
          "A mountain stream in the Lake District.",
        ),
        k(
          "k2",
          "Tributaries help make the middle-course river wider and deeper",
          "Smaller rivers called tributaries join the main river and add more water. The moving water erodes the bed and banks, making the channel wider and deeper.",
          "The River Cherwell joins the Thames at Oxford.",
        ),
      ],
      questions: [
        q(
          "q1",
          "How does a steep slope shape a river near its source?",
          "It makes the river flow quickly in a narrow channel, eroding the bed and banks.",
        ),
      ],
    },
  },
  {
    id: "weimar",
    audience: { subject: "History", yearGroup: "Year 9" },
    topic: "Weimar Germany: the hyperinflation crisis of 1923",
    planted: "k2: passive resistance ended in October 1923 (26 September 1923)",
    facts: {
      ...base,
      objectives: [{ id: "o1", text: "Explain how the government brought prices under control" }],
      keyIdeas: [
        k(
          "k1",
          "Rising prices changed daily life",
          "A person on a fixed income could afford less because their income did not rise. Savings also bought less, while some borrowers could repay debts with money that was worth less.",
          "A loaf of bread cost 200 billion marks in Berlin in November 1923.",
        ),
        k(
          "k2",
          "Ending passive resistance and the Rentenmark helped stabilise prices",
          "In October 1923, the government ended passive resistance in the Ruhr, so work and production could resume. In November, it introduced the Rentenmark, issued in limited amounts and backed by land and industrial assets.",
          "Stresemann's government, autumn 1923.",
        ),
      ],
      questions: [
        q(
          "q1",
          "Name two steps the government took to help stabilise prices in 1923.",
          "It ended passive resistance in the Ruhr and introduced the Rentenmark.",
        ),
      ],
    },
  },
];

const rows: unknown[] = [];
for (const effort of ["low", "medium"] as const) {
  for (const set of SETS) {
    if (readSpend() + 0.004 > cap) {
      console.error(`REFUSED ${set.id} ${effort}: spend ${readSpend().toFixed(4)} near cap ${cap}`);
      continue;
    }
    const t0 = performance.now();
    const r = await generateText({
      model,
      system: verifyFactsPrompt.system,
      prompt: verifyFactsPrompt.user({
        audience: set.audience,
        topic: set.topic,
        facts: set.facts as LessonFacts,
      }),
      output: Output.object({ schema: Out }),
      providerOptions: { openai: { reasoningEffort: effort, strictJsonSchema: false } },
      maxOutputTokens: 3000,
    });
    const u = r.usage as {
      inputTokens?: number;
      outputTokens?: number;
      inputTokenDetails?: { cacheReadTokens?: number };
    };
    const cached = u.inputTokenDetails?.cacheReadTokens ?? 0;
    const usd =
      ((u.inputTokens ?? 0) - cached) * PRICE.in +
      cached * PRICE.cached +
      (u.outputTokens ?? 0) * PRICE.out;
    addSpend(usd);
    let corrections: z.infer<typeof Out>["corrections"] | undefined;
    try {
      corrections = (await r.output).corrections;
    } catch {
      corrections = undefined;
    }
    const ms = Math.round(performance.now() - t0);
    rows.push({
      set: set.id,
      effort,
      planted: set.planted,
      corrections,
      raw: corrections ? undefined : r.text,
      usd,
      ms,
    });
    console.log(`${set.id} @${effort}: ${ms} ms $${usd.toFixed(4)} planted: ${set.planted}`);
    for (const c of corrections ?? [])
      console.log(
        `   -> ${c.factId}.${c.field}${c.index !== undefined ? `[${c.index}]` : ""} (${c.reason}): ${JSON.stringify(c.value).slice(0, 160)}`,
      );
    if (!corrections) console.log(`   (invalid) ${r.text.slice(0, 200)}`);
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(rows, null, 1));
console.log(`spend ${readSpend().toFixed(4)}`);
