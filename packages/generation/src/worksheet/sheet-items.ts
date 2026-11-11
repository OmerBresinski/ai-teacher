import { hasLeakedPupilPhrase, isOneOf, normaliseText } from "@tj/domain/documents";
import { editorialIssue } from "@tj/slides";
import { isEarlyYears, isSpokenTask, type LessonDigest } from "@tj/slides/worksheet/digest";
import { z } from "zod";
import { numericMismatches } from "../numeric-check";
import { checkKey } from "../writer/answer-key";
import { isNonAnswer } from "./gate";

/*
 * Practice and Exam practice (worksheets plan v2 T7): the schemas the model fills (schemas.md, the
 * prompt engineer's) and the item rules code checks. Shape rules (S) fail the call after its one
 * retry; item rules (E) go into the schema as editorial issues, so a first miss sends the reason
 * back once, and run again after the call in `practiceFaults` / `examFaults`, which drop the item.
 */

const SPEC = { body: 600, point: 160 } as const;

const itemShape = {
  slides: z.array(z.number().int()).min(1).max(4),
  builds: z.enum(["same-skill-new-numbers", "new-context", "combine", "explain"]),
  question: z.string().min(1).max(SPEC.body),
  working: z.string().max(SPEC.body).nullable(),
  answer: z.string().min(1).max(SPEC.body),
};
const PracticeItem = z.object(itemShape);
export type PracticeItem = z.infer<typeof PracticeItem>;

const COMMANDS = [
  "State",
  "Give",
  "Name",
  "Describe",
  "Explain",
  "Suggest",
  "Calculate",
  "Work out",
  "Show that",
  "Compare",
  "Evaluate",
] as const;

const ExamItem = z.object({
  slides: z.array(z.number().int()).min(1).max(4),
  command: z.enum(COMMANDS),
  marks: z.number().int().min(1).max(6),
  question: z.string().min(1).max(SPEC.body),
  working: z.string().max(SPEC.body).nullable(),
  markScheme: z.array(z.string().min(1).max(SPEC.point)).min(1).max(6),
});
export type ExamItem = z.infer<typeof ExamItem>;

export type PracticeOutput = {
  warmUp: PracticeItem[];
  core: PracticeItem[];
  challenge: PracticeItem;
};
export type ExamOutput = { items: ExamItem[] };

/** Never mention the lesson in pupil text (schemas.md, new rule; bare "notes" is music). */
const LESSON_REFERENCE =
  /\b(slides?|the lesson|lesson notes|teacher's notes|as you (have )?(learned|learnt)|you learned|digest|the brief)\b/i;

/** A gap to fill ("from _____ to _____"): the sheet has no gap-fill block, so it would print above ruled lines. */
const GAP = /_{3,}/;

const CALC_QUESTION = /^\W*(calculate|work out|find)\b|\d\s*[+\-−×÷/=]\s*\d/i;
const numbersIn = (text: string): string[] => text.match(/\d+(?:\.\d+)?/g) ?? [];
const words = (text: string) => new Set(normaliseText(text).split(/\s+/).filter(Boolean));

/** A slide question copied: the same words, or 80 % word overlap with the same numbers (D10). */
export function copiesAsked(question: string, asked: readonly string[]): boolean {
  if (isOneOf(question, asked)) return true;
  const mine = words(question);
  const nums = numbersIn(question).join(",");
  return asked.some((other) => {
    const theirs = words(other);
    const shared = [...mine].filter((w) => theirs.has(w)).length;
    const overlap = shared / Math.max(1, Math.min(mine.size, theirs.size));
    return overlap >= 0.8 && numbersIn(other).join(",") === nums;
  });
}

/**
 * The working ends "= v [unit]" and the result `v` must be where the key starts: the first number
 * in `key` equals v at the precision v's digits show. Also no wrong sum in either text.
 */
export function workingFault(question: string, working: string | null, key: string): string | null {
  if (!working?.trim()) return null;
  const m = /=\s*(−?-?\d+(?:\.\d+)?)[^=]*$/.exec(working);
  if (!m) return "the working does not end in = and its result";
  const v = m[1]?.replace("−", "-") as string;
  const first = /(−?-?\d+(?:\.\d+)?)/.exec(key)?.[1]?.replace("−", "-");
  if (first === undefined) return "the answer does not give the working's result";
  const places = v.split(".")[1]?.length ?? 0;
  if (Number(first).toFixed(places) !== Number(v).toFixed(places)) {
    return `the answer ${first} does not match the working's result ${v}`;
  }
  if (checkKey(question, key, working).length > 0) return "the key or working has a wrong sum";
  if (numericMismatches(`${working} ${key}`).length > 0)
    return "a sum in the working does not hold";
  return null;
}

type Context = { digest: LessonDigest };
const askedQuestions = (digest: LessonDigest) => digest.asked.map((a) => a.question);
const taughtSlides = (digest: LessonDigest) => new Set(digest.taught.map((t) => t.slide));

/** What every model item must hold, whatever its type. */
function commonFaults(
  item: { question: string; slides: number[]; working: string | null },
  { digest }: Context,
): string[] {
  const out: string[] = [];
  const real = taughtSlides(digest);
  if (item.slides.some((n) => !real.has(n))) out.push("cites a slide the brief does not teach");
  if (LESSON_REFERENCE.test(item.question)) out.push("mentions the lesson or its slides");
  if (hasLeakedPupilPhrase(item.question)) out.push("carries model text");
  if (copiesAsked(item.question, askedQuestions(digest)))
    out.push("copies an already-asked question");
  if (isEarlyYears(digest.lesson.yearGroup) && isSpokenTask(item.question))
    out.push("is a spoken task");
  return out;
}

/** Why a Practice item may not ship (empty when it may). */
export function practiceFaults(item: PracticeItem, ctx: Context): string[] {
  const out = commonFaults(item, ctx);
  if (isNonAnswer(item.answer)) out.push("has no answer");
  if (GAP.test(item.question)) out.push("leaves a gap to fill in the question");
  const early = isEarlyYears(ctx.digest.lesson.yearGroup);
  if (!early && CALC_QUESTION.test(item.question) && !item.working?.trim()) {
    out.push("calculates but gives no working");
  }
  const w = workingFault(item.question, item.working, item.answer);
  if (w) out.push(w);
  return out;
}

/** Why an Exam item may not ship, given the mark it was planned at. */
export function examFaults(
  item: ExamItem,
  plannedMarks: number | undefined,
  ctx: Context,
): string[] {
  const out = commonFaults(item, ctx);
  if (plannedMarks !== undefined && item.marks !== plannedMarks) {
    out.push(`is worth ${item.marks} marks, not the planned ${plannedMarks}`);
  }
  if (item.markScheme.length !== item.marks)
    out.push("does not give one mark-scheme point per mark");
  if (item.markScheme.some((p) => isNonAnswer(p))) out.push("has an empty mark-scheme point");
  if (!normaliseText(item.question).startsWith(normaliseText(item.command))) {
    out.push(`does not open with its command word ${item.command}`);
  }
  const calc =
    ["Calculate", "Work out", "Show that"].includes(item.command) ||
    CALC_QUESTION.test(item.question);
  if (calc && !item.working?.trim()) out.push("calculates but gives no working");
  const last = item.markScheme[item.markScheme.length - 1] ?? "";
  const w = workingFault(item.question, item.working, last);
  if (w) out.push(w);
  return out;
}

/** `allDistinct` by question, as indices of the later repeats. */
export function repeatedQuestions(questions: readonly string[]): Set<number> {
  const seen = new Set<string>();
  const out = new Set<number>();
  questions.forEach((q, i) => {
    const key = normaliseText(q);
    if (seen.has(key)) out.add(i);
    seen.add(key);
  });
  return out;
}

/** The result a calculation's working ends on ("= v"), or null when it has no working. */
export function workingResult(working: string | null): number | null {
  const v = working ? /=\s*(−?-?\d+(?:\.\d+)?)[^=]*$/.exec(working)?.[1] : undefined;
  return v === undefined ? null : Number(v.replace("−", "-"));
}

/** Indices of items whose calculation result an earlier item already has (v2: retry-only). */
export function repeatedResults(items: readonly { working: string | null }[]): Set<number> {
  const seen = new Set<number>();
  const out = new Set<number>();
  items.forEach((it, i) => {
    const v = workingResult(it.working);
    if (v === null) return;
    if (seen.has(v)) out.add(i);
    seen.add(v);
  });
  return out;
}

/**
 * The Practice schema: exactly 2 warm-ups, core 1..7 (shape; the SHEET line's exact count is an
 * editorial rule), one challenge. With `soft`, the item rules are left out.
 */
export function practiceSchemaFor(
  ctx: Context & { core: number },
  options: { soft?: boolean } = {},
): z.ZodType<PracticeOutput> {
  return z
    .object({
      warmUp: z.array(PracticeItem).length(2),
      core: z.array(PracticeItem).min(1).max(7),
      challenge: PracticeItem,
    })
    .superRefine((out, issues) => {
      if (options.soft) return;
      const all: [string, number | null, PracticeItem][] = [
        ...out.warmUp.map((it, i) => ["warmUp", i, it] as [string, number, PracticeItem]),
        ...out.core.map((it, i) => ["core", i, it] as [string, number, PracticeItem]),
        ["challenge", null, out.challenge],
      ];
      if (out.core.length !== ctx.core) {
        issues.addIssue(
          editorialIssue(`Write exactly ${ctx.core} core items, not ${out.core.length}.`, ["core"]),
        );
      }
      const repeats = repeatedQuestions(all.map(([, , it]) => it.question));
      const sameResult = repeatedResults(all.map(([, , it]) => it));
      all.forEach(([key, i, it], n) => {
        const path = i === null ? [key] : [key, i];
        const label = i === null ? "The challenge" : `${key} item ${i + 1}`;
        for (const fault of practiceFaults(it, ctx))
          issues.addIssue(editorialIssue(`${label} ${fault}.`, path));
        if (repeats.has(n)) issues.addIssue(editorialIssue(`${label} repeats another item.`, path));
        if (sameResult.has(n))
          issues.addIssue(
            editorialIssue(`${label} has the same calculation result as another item.`, path),
          );
      });
    }) as z.ZodType<PracticeOutput>;
}

export function examSchemaFor(
  ctx: Context & { marks: number[] },
  options: { soft?: boolean } = {},
): z.ZodType<ExamOutput> {
  return z.object({ items: z.array(ExamItem).min(3).max(10) }).superRefine((out, issues) => {
    if (options.soft) return;
    if (out.items.length !== ctx.marks.length) {
      issues.addIssue(
        editorialIssue(`Write exactly ${ctx.marks.length} questions, not ${out.items.length}.`, [
          "items",
        ]),
      );
    }
    const repeats = repeatedQuestions(out.items.map((it) => it.question));
    out.items.forEach((it, i) => {
      for (const fault of examFaults(it, ctx.marks[i], ctx)) {
        issues.addIssue(editorialIssue(`Question ${i + 1} ${fault}.`, ["items", i]));
      }
      if (repeats.has(i))
        issues.addIssue(editorialIssue(`Question ${i + 1} repeats another.`, ["items", i]));
    });
  }) as z.ZodType<ExamOutput>;
}
