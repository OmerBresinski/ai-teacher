import type { Brief, LessonFacts } from "@tj/domain/documents";

/*
 * Wording every stage prompt shares (ADR 0025 §17). Pure string builders: nothing here reads the
 * environment or logs. Changing any text here changes every prompt's hash, so every `version`
 * must be bumped together — `prompts.test.ts` enforces it.
 */

/** Rules stated in every system prompt (ADR 0024 §2: no learner names; F06: British English). */
export const HOUSE_RULES = [
  "Write in British English spelling and conventions.",
  "Never invent or include the name of any pupil, student or member of staff.",
  "Pitch the language at the reading level and year group given; explain any word a pupil at that level would not know.",
  "Every fact id you are given is stable: echo the exact ids in `factRefs`, never invent new ones.",
  "Answer with the requested JSON only, no prose before or after it.",
].join("\n");

/** What the pipeline knows about the class, as one block the prompts embed. */
export type Audience = {
  subject?: string | undefined;
  yearGroup?: string | undefined;
  ageBand?: string | undefined;
  readingLevel?: string | undefined;
  language?: string | undefined;
  classContext?: Brief["classContext"] | undefined;
};

export function audienceBlock(a: Audience): string {
  const lines = [
    `Subject: ${a.subject ?? "not given"}`,
    `Year group: ${a.yearGroup ?? "not given"}${a.ageBand ? ` (${a.ageBand})` : ""}`,
    `Reading level: ${a.readingLevel ?? a.yearGroup ?? "the year group"}`,
    `Language: ${a.language ?? "en-GB"}`,
  ];
  const cc = a.classContext;
  if (cc?.sizeBand) lines.push(`Class size: ${cc.sizeBand}`);
  if (cc?.needs && Object.keys(cc.needs).length > 0) {
    const needs = Object.entries(cc.needs)
      .map(([k, n]) => `${k}: ${n}`)
      .join(", ");
    lines.push(`Additional needs (counts): ${needs}`);
  }
  if (cc?.priorKnowledge) lines.push(`Prior knowledge: ${cc.priorKnowledge}`);
  if (cc?.notes) lines.push(`Teacher notes: ${cc.notes}`);
  return lines.join("\n");
}

/** The facts with their ids, in the compact form the Generate/Evaluate/Repair prompts embed. */
export function factsBlock(facts: LessonFacts): string {
  const out: string[] = [];
  out.push("Objectives:");
  for (const o of facts.objectives) out.push(`  ${o.id}: ${o.text}`);
  if (facts.vocabulary.length > 0) {
    out.push("Vocabulary:");
    for (const v of facts.vocabulary) out.push(`  ${v.id}: ${v.term} — ${v.definition}`);
  }
  if (facts.workedExamples.length > 0) {
    out.push("Worked examples:");
    for (const x of facts.workedExamples) {
      out.push(`  ${x.id}: ${x.problem}`);
      x.steps.forEach((s, i) => {
        out.push(`    ${i + 1}. ${s}`);
      });
      out.push(`    Answer: ${x.answer}`);
    }
  }
  if (facts.questions.length > 0) {
    out.push("Questions:");
    for (const q of facts.questions) {
      out.push(`  ${q.id}: ${q.stem}`);
      out.push(`    Answer: ${q.answer} (${q.reasoning})`);
    }
  }
  out.push(`Lesson length: ${facts.durationMin} minutes.`);
  return out.join("\n");
}

/** One JSON example, pretty-printed, for a prompt to show the exact shape wanted. */
export function example(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
