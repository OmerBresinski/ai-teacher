import type { Brief, LessonFacts } from "@tj/domain/documents";
import type { LessonShape, ObjectiveVerb, PriorConfidence } from "../shapes";

/*
 * Wording every stage prompt shares (ADR 0025 §17). Pure string builders: nothing here reads the
 * environment or logs. Changing any text here changes every prompt's hash, so every `version`
 * must be bumped together — `prompts.test.ts` enforces it.
 */

/** The two shape fields the writers and the reviewer are told (TEACH-230); Plan sees the whole shape. */
export type WritingShape = Pick<LessonShape, "verb" | "confidence">;

/**
 * What each slide kind and the worksheet are for under each objective verb (project "Lesson shape
 * by objective verb", TEACH-230). One paragraph per verb, read by Generate (slide and worksheet),
 * Evaluate (its `verb-fit` check) and Repair, so a slide rewritten after a `verb-fit` finding is
 * written to the same rule. Plan's Shape block (`prompts/shape.ts`) decides *which* kinds the
 * outline has; this decides what the text on them says. Exit-ticket sentences read per item
 * (TEACH-262): the recipe fixes the item count, so "one thing" was a `verb-fit` finding waiting to
 * happen.
 */
export const VERB_WRITING: Record<ObjectiveVerb, string> = {
  Recall:
    "This is a Recall lesson: pupils must remember and state. A `content` slide gives the definition and two or three examples, in the words pupils will be asked to reproduce. A `worked-example` shows how to tell an example from a non-example. Questions and worksheet blocks ask for the term, the definition, the example or the sorting — never for a judgement or an explanation of why. An `exit-ticket` asks for three things pupils should now be able to state from memory.",
  Explain:
    "This is an Explain lesson: pupils must say how and why. A `content` slide is a mechanism — how it happens, then why — with the example showing the mechanism at work; a list of facts is not an explanation. A `worked-example` walks through one explanation step by step. An `open-response` asks pupils to explain a case in their own words, and its model answer gives the how and the why. Questions and worksheet blocks ask how and why, and confront the misconception. Each `exit-ticket` item asks pupils to explain, not to name.",
  Apply:
    "This is an Apply lesson: pupils must use a method. A `content` slide is the method — the steps in order, then when to use it — not background. A `worked-example` does one problem with the method, one step a line, the answer last. Questions and worksheet blocks are problems to work with the method, varied on the surface and rising in difficulty; an `open-response` sets a problem to solve, not a reflection. An `exit-ticket` gives three short problems.",
  Evaluate:
    "This is an Evaluate lesson: pupils must make a judgement and defend it. A `content` slide teaches the criteria the judgement uses. A `worked-example` applies the criteria to one case and reaches a verdict. An `open-response` asks which — and why — a judgement with reasons, never a recall question. Questions and worksheet blocks set cases against the criteria. Each `exit-ticket` item asks for a judgement and its reason.",
};

/**
 * How the class's prior confidence changes the writing, one line each. Revisiting is verb-aware:
 * "no definitions, straight to the mechanism" is what Explain, Apply and Evaluate need, but a
 * Recall lesson *is* the definitions — for a revisiting class it stops re-teaching them and makes
 * the retrieval harder instead.
 */
const CONFIDENCE_WRITING: Record<PriorConfidence, (verb: ObjectiveVerb) => string> = {
  "New to it": () =>
    "The class is new to the topic: define a word before you use it and keep every example concrete.",
  "Some prior knowledge": () =>
    "The class has some prior knowledge: remind in a line, then move on; do not re-teach what a reminder covers.",
  Revisiting: (verb) =>
    verb === "Recall"
      ? "The class is revisiting the topic and has met the definitions: do not re-teach them — a content slide recaps in one line and spends the rest on examples and near misses; pitch the retrieval at the harder end (sort, classify, odd one out, tell an example from a near miss)."
      : "The class is revisiting the topic: no definitions; go straight to the mechanism, method or judgement and pitch the questions at the harder end.",
};

/** The verb block a writer or reviewer embeds: the verb's paragraph, then the confidence line. */
export function verbBlock(shape: WritingShape): string {
  return `Objective verb: ${shape.verb}. ${VERB_WRITING[shape.verb]}\n${CONFIDENCE_WRITING[shape.confidence](shape.verb)}`;
}

/**
 * Rules stated in every system prompt (ADR 0024 §2: no learner names; F06: British English). The
 * "JSON only, no prose" line went on 23 Sept 2026 (minimalism rubric 5): every call runs through
 * `call.ts`, which repairs the text (`repair-json.ts`) and validates it against the schema, so the
 * rule restated what code enforces. Since the 24 Sept 2026 audit a step takes only the rules it
 * uses, by name (`houseRules`): a reviewer or fact patcher writes no pupil text and no `factRefs`,
 * and a rule it cannot use only invites restyling (verify, CROSS-STEP c2).
 */
const RULES = {
  british: "Write in British English spelling and conventions.",
  names: "Never invent or include the name of any pupil, student or member of staff.",
  pitch:
    "Pitch the language at the reading level and year group given; explain any word a pupil at that level would not know.",
  factRefs:
    "Every fact id you are given is stable: echo the exact ids in `factRefs`, never invent new ones.",
} as const;
export type HouseRule = keyof typeof RULES;

/** The named house rules, in their fixed order. */
export function houseRules(...keys: HouseRule[]): string {
  return (Object.keys(RULES) as HouseRule[])
    .filter((k) => keys.includes(k))
    .map((k) => RULES[k])
    .join("\n");
}

/** All four, for the steps that write pupil text and echo fact ids. */
export const HOUSE_RULES = houseRules("british", "names", "pitch", "factRefs");

/** The starter's retrieval questions (lab, C1): earlier learning the lesson opens with. */
export type Retrieval = { question: string; answer: string }[];

/** The starter block a step embeds after its facts; nothing when there is no starter. */
export function retrievalBlock(retrieval: Retrieval | undefined): string[] {
  if (!retrieval || retrieval.length === 0) return [];
  return [
    "",
    "Starter (earlier learning, not this lesson):",
    ...retrieval.map((r) => `  - ${r.question} — ${r.answer}`),
  ];
}

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
      out.push(`    Answer: ${q.answer}`, `    Reasoning: ${q.reasoning}`);
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
  // No lesson length: minutes size nothing a writer or reviewer does (UX ruling 82, 23 Sept 2026).
  return out.join("\n");
}

/**
 * The character caps `SlideSpecSchema` / `BlockSpecSchema` enforce, stated so the model does not
 * learn them from a validation retry. Kept in step with `SPEC_LIMITS` by `prompts.test.ts`.
 */
export function limitsBlock(limits: Record<string, number>): string {
  return `Length limits (characters): ${Object.entries(limits)
    .map(([k, v]) => `${k} ≤ ${v}`)
    .join(
      ", ",
    )}. They are what fits on one line; a little over is accepted, one and a half times is not.`;
}

/** One JSON example, pretty-printed, for a prompt to show the exact shape wanted. */
export function example(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
