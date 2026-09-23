/*
 * The prompt bake-off's two fixed output schemas, exactly as `BRIEF.md` states them, and the
 * placeholder set each task's templates may use. Contestants cannot change these; the runner
 * enforces them with zod on every answer (`callStructured`'s one retry applies).
 */

import { z } from "zod";

export const BAKEOFF_MODEL = "openai/gpt-5.6-luna";
export const BAKEOFF_EFFORT = "medium" as const;

export const TASKS = ["rewrite", "select"] as const;
export type Task = (typeof TASKS)[number];
export const SETS = ["dev", "test"] as const;
export type SetName = (typeof SETS)[number];

/** Placeholders a task's templates may use (each at most once, per the brief). */
export const PLACEHOLDERS: Record<Task, readonly string[]> = {
  rewrite: ["subject", "band", "outcome", "sentences"],
  select: ["subject", "band", "objective", "cards"],
};

const S = z.string().max(300);
const sentenceId = z.string().regex(/^s\d+$/, "a sentence id like s12");
const evidence = z.array(sentenceId).min(1);

export const RewriteOutputSchema = z.object({
  keyIdeas: z
    .array(z.object({ statement: S, example: S.optional(), evidence }))
    .min(2)
    .max(6),
  misconceptions: z.array(z.object({ wrong: S, right: S, evidence })).max(3),
  vocabulary: z
    .array(z.object({ term: S, definition: S, evidence }))
    .min(2)
    .max(8),
  workedExamples: z
    .array(z.object({ problem: S, steps: z.array(S).min(1), answer: S, evidence }))
    .max(2),
  questions: z
    .array(
      z.object({
        stem: S,
        answer: S,
        distractors: z
          .array(S)
          .refine((d) => d.length === 0 || d.length === 3, "distractors: 0 or 3"),
        demand: z.enum(["recall", "apply", "judgement"]),
        forms: z.array(z.enum(["multiple-choice", "true-false", "open-response"])).min(1),
        evidence,
      }),
    )
    .min(3)
    .max(6),
});
export type RewriteOutput = z.infer<typeof RewriteOutputSchema>;

export const SelectOutputSchema = z
  .object({
    cardId: z.enum(["c1", "c2", "c3"]).nullable(),
    covers: z.enum(["full", "partial", "none"]),
    missing: z.array(z.string().max(80)).max(5),
  })
  .refine((o) => (o.cardId === null) === (o.covers === "none"), {
    message: "cardId is null exactly when covers is none",
  })
  .refine((o) => o.covers === "partial" || o.missing.length === 0, {
    message: "missing is empty when covers is full or none",
  });
export type SelectOutput = z.infer<typeof SelectOutputSchema>;

export const OUTPUT_SCHEMAS = {
  rewrite: RewriteOutputSchema,
  select: SelectOutputSchema,
} as const;

/** One contestant prompt file: `prompts/<id>-<task>.json`. */
export const PromptFileSchema = z.object({ system: z.string().min(1), user: z.string().min(1) });
export type PromptFile = z.infer<typeof PromptFileSchema>;

/** A rewrite section input file (`dev/rewrite-*.json`, `test/rewrite-*.json`). */
export const RewriteItemSchema = z.object({
  id: z.string(),
  subject: z.string(),
  band: z.string(),
  outcome: z.string(),
  sentences: z.string(),
  sources: z.array(
    z.object({ url: z.string(), title: z.string(), revision: z.number(), licence: z.string() }),
  ),
});
export type RewriteItem = z.infer<typeof RewriteItemSchema>;

/** One select item (`<set>/select.json` is an array of these; labels live elsewhere). */
export const SelectItemSchema = z.object({
  id: z.string(),
  subject: z.string(),
  band: z.string(),
  objective: z.string(),
  cards: z.string(),
});
export type SelectItem = z.infer<typeof SelectItemSchema>;

/** The sentence ids present in a rendered `{{sentences}}` block. */
export function sentenceIdsOf(sentences: string): Set<string> {
  const ids = new Set<string>();
  for (const m of sentences.matchAll(/^\[(s\d+)\]/gm)) ids.add(m[1] as string);
  return ids;
}

/** Output caps: the largest valid answer plus room for Luna's reasoning at medium effort. */
export const MAX_OUTPUT_TOKENS: Record<Task, number> = { rewrite: 8000, select: 1500 };

/** What a dry run assumes one answer will cost in output tokens (reasoning included). */
export const EXPECTED_OUTPUT_TOKENS: Record<Task, number> = { rewrite: 3200, select: 400 };

/*
 * The two model-based scorers' output shapes (`support-checker.ts`, `rubric-judge.ts`). Both put
 * the reason before the score so the score follows it. Word caps live in the prompt text: the
 * gateway's non-strict route ignores every bound but `enum` and `required`, and a `refine`
 * never reaches the JSON schema at all.
 */

export const SUPPORT_MODEL = "openai/gpt-5.6-luna";
export const SUPPORT_EFFORT = "medium" as const;
export const SUPPORT_VERDICTS = ["supported", "partly", "unsupported", "contradicted"] as const;
export type SupportVerdict = (typeof SUPPORT_VERDICTS)[number];

export const SupportCheckSchema = z.object({
  reason: z.string().max(200),
  verdict: z.enum(SUPPORT_VERDICTS),
});
export type SupportCheck = z.infer<typeof SupportCheckSchema>;

/** The judge's default; `--model` overrides it. Listed by the gateway on 2026-09-23, priced in `PRICES`. */
export const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-5";
export const JUDGE_EFFORT = "medium" as const;

const Score = z.number().int().min(1).max(5);

/**
 * The judge's answer for one output set: a usefulness score per item, keyed by the refs the
 * packet lists (an enum, so no ref can be invented; the refine makes every ref appear once), and
 * one pitch score for the set.
 */
export function judgeOutputSchema(refs: readonly string[]) {
  if (refs.length === 0) throw new Error("a judge packet needs at least one item");
  const ref = z.enum(refs as [string, ...string[]]);
  return z
    .object({
      items: z.array(z.object({ ref, reason: z.string().max(200), useful: Score })),
      pitch: z.object({ reason: z.string().max(200), score: Score }),
    })
    .refine(
      (o) =>
        new Set(o.items.map((i) => i.ref)).size === refs.length && o.items.length === refs.length,
      { message: `items: one entry per ref, each of ${refs.join(", ")} exactly once` },
    );
}
export type JudgeOutput = z.infer<ReturnType<typeof judgeOutputSchema>>;
