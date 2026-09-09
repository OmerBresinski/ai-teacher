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

/**
 * The facts with their ids, in the compact form the Generate/Evaluate/Repair prompts embed. A
 * fact's own links are shown in brackets after it (`[o1, o2]`, `[heads off m1]`) so the model can
 * follow them; lists a lesson does not have are left out.
 */
export function factsBlock(facts: LessonFacts): string {
  const out: string[] = [];
  const refs = (ids: string[] | undefined) => (ids && ids.length > 0 ? ` [${ids.join(", ")}]` : "");
  const headsOff = (id: string | undefined) => (id ? ` [heads off ${id}]` : "");
  out.push("Objectives:");
  for (const o of facts.objectives) out.push(`  ${o.id}: ${o.text}`);
  if (facts.keyIdeas && facts.keyIdeas.length > 0) {
    out.push("Key ideas:");
    for (const k of facts.keyIdeas) {
      out.push(`  ${k.id}: ${k.statement} — ${k.explanation}${refs(k.objectiveRefs)}`);
      out.push(`    Example: ${k.example}`);
      if (k.analogy) out.push(`    Analogy: ${k.analogy}`);
    }
  }
  if (facts.misconceptions.length > 0) {
    out.push("Misconceptions:");
    for (const m of facts.misconceptions) {
      out.push(`  ${m.id}: believes ${m.belief}; correct: ${m.correction}${refs(m.objectiveRefs)}`);
    }
  }
  if (facts.vocabulary.length > 0) {
    out.push("Vocabulary:");
    for (const v of facts.vocabulary) {
      out.push(`  ${v.id}: ${v.term} — ${v.definition}${refs(v.objectiveRefs)}`);
    }
  }
  if (facts.workedExamples.length > 0) {
    out.push("Worked examples:");
    for (const x of facts.workedExamples) {
      out.push(`  ${x.id}: ${x.problem}${headsOff(x.misconceptionRef)}`);
      x.steps.forEach((s, i) => {
        out.push(`    ${i + 1}. ${s}`);
      });
      out.push(`    Answer: ${x.answer}`);
    }
  }
  if (facts.questions.length > 0) {
    out.push("Questions:");
    for (const q of facts.questions) {
      const tags = [q.tier, q.use ? `use: ${q.use}` : undefined].filter(Boolean).join(", ");
      out.push(`  ${q.id}: ${q.stem}${tags ? ` (${tags})` : ""}${refs(q.objectiveRefs)}`);
      out.push(`    Answer: ${q.answer} (${q.reasoning})`);
      if (q.distractors && q.distractors.length > 0) {
        out.push(
          `    Distractors: ${q.distractors
            .map((d) => `${d.text}${headsOff(d.misconceptionRef)}`)
            .join("; ")}`,
        );
      }
    }
  }
  if (facts.pitch) {
    const avoid = facts.pitch.avoid.length > 0 ? `; avoid: ${facts.pitch.avoid.join(", ")}` : "";
    out.push(
      `Pitch: reading age ${facts.pitch.readingAgeTarget}, sentences of at most ${facts.pitch.sentenceLengthMax} words${avoid}.`,
    );
  }
  out.push(`Lesson length: ${facts.durationMin} minutes.`);
  return out.join("\n");
}

/**
 * The character caps `SlideSpecSchema` / `BlockSpecSchema` enforce, stated so the model does not
 * learn them from a validation retry. Kept in step with `SPEC_LIMITS` by `prompts.test.ts`.
 */
export function limitsBlock(limits: Record<string, number>): string {
  return `Length limits (characters): ${Object.entries(limits)
    .map(([k, v]) => `${k} ≤ ${v}`)
    .join(", ")}. Stay well under them.`;
}

/** One JSON example, pretty-printed, for a prompt to show the exact shape wanted. */
export function example(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
