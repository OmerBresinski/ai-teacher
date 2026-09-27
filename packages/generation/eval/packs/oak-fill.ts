import { z } from "zod";
import type { StructuredPrompt } from "../../src/call";

/*
 * pack-oak-fill.v1 (28 Sept 2026, PE; gpt-6-sol, medium; lab l6kp2, oak-packs/NEEDS-PROMPT.md).
 * One call per Oak-seeded pack section. Oak gives the section its key learning points, keywords
 * and misconceptions; what it lacks (EXPERT-SUBJECT "Missing essentials") is the citable specific:
 * a quotation with its place, a date, a figure, a named case, a worked example. This call writes
 * only those kinds, and only the ones code names for the section, so the fill share stays small
 * and no Oak fact is rewritten.
 *
 * Design, against the minimalism rubric and the pack-recall findings:
 * - Code chooses the kinds per section (the runner's topic table) and the packet names them: a
 *   concreteness rule left to the model invents its evidence on thin topics (CORE 2026-09-19).
 * - The existing facts are shown as context so nothing is restated, and the rule is one clause.
 * - `confidence` is categorical and comes last in the fact, after the claim and its locator, so it
 *   is judged on what was written (CORE 2026-07-29 on a citation declared before its label; never
 *   a numeric score). The code keeps `certain` facts only; `unsure` ones go to the report. The
 *   certainty rule of pack-recall.v1 ("a date, number, name or attribution only when certain")
 *   becomes the whole call's rule, since every fact here is one of those.
 * - No misconceptions, vocabulary or questions: the schema has no slot for them, so no prose says
 *   so (a slot outranks a rule about leaving it empty, and no slot needs no rule).
 * - `source: "model"`, `from` and the edition-corrected locator are code's: the model never writes
 *   a constant, and every quotation is re-located by the Q0 matcher against the stored text.
 * - Counts in prose once (the gateway's non-strict route ignores maxItems).
 */

export const OAK_FILL_KINDS = [
  "quotation",
  "date",
  "figure",
  "namedSpecific",
  "workedExample",
] as const;
export type OakFillKind = (typeof OAK_FILL_KINDS)[number];

const line = z.string().trim().min(1);

/**
 * One fact. Field order is the order the model writes: the claim, its place, then how sure it is.
 * The per-kind field pairing is prose in the system text and a refinement here, so a miss is
 * retried with its issues rather than stored.
 */
export const OakFillFactSchema = z
  .strictObject({
    kind: z.enum(OAK_FILL_KINDS),
    statement: line.max(240).optional(),
    quote: line.max(200).optional(),
    locator: line.max(120).optional(),
    problem: line.max(400).optional(),
    steps: z.array(line.max(200)).optional(),
    answer: line.max(200).optional(),
    confidence: z.enum(["certain", "unsure"]),
  })
  .superRefine((f, ctx) => {
    const need = (field: keyof typeof f, ok: boolean) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [field], message: `${f.kind} needs ${field}` });
    };
    if (f.kind === "quotation") {
      need("quote", !!f.quote);
      need("locator", !!f.locator);
      need("statement", !!f.statement);
    } else if (f.kind === "workedExample") {
      need("problem", !!f.problem);
      need("steps", (f.steps?.length ?? 0) > 0);
      need("answer", !!f.answer);
    } else {
      need("statement", !!f.statement);
      need("locator", !!f.locator);
    }
  });
export type OakFillFact = z.infer<typeof OakFillFactSchema>;

export const PackOakFillOutputSchema = z.strictObject({
  facts: z.array(OakFillFactSchema).max(8),
});
export type PackOakFillOutput = z.infer<typeof PackOakFillOutputSchema>;

export interface PackOakFillInput {
  subject: string;
  /** "Year 10"; the key stage is derived here. */
  yearGroup: string;
  brief: string;
  section: { title: string; outcome: string };
  /** The facts the section already holds, one line each (`oakFactLines`). */
  existing: readonly string[];
  /** The kinds code wants for this section, in the order shown. */
  kinds: readonly OakFillKind[];
  /** Literature only: the set text and the edition the pack quotes. */
  text?: { name: string; edition: string } | undefined;
}

/** As pack-checklist.v1: the key stage in England from the year group, supplied by code. */
export function keyStageOf(yearGroup: string): string {
  const year = Number(/^Year (\d{1,2})$/.exec(yearGroup.trim())?.[1]);
  if (!(year >= 1 && year <= 13)) return "";
  const stage = year <= 2 ? 1 : year <= 6 ? 2 : year <= 9 ? 3 : year <= 11 ? 4 : 5;
  return ` (Key Stage ${stage})`;
}

export const packOakFillPrompt: StructuredPrompt<PackOakFillInput> = {
  version: "pack-oak-fill.v1",
  system: [
    "You add facts to one section of a UK school topic pack, in British English, from your own knowledge. You are given the subject, the year group with its key stage in England, the lesson brief, the section's outcome, the facts it already holds, and the kinds of fact it lacks.",
    "",
    "Write only facts of the kinds asked for that the section lacks: none restates or reworks a fact shown. Each is one self-contained claim, at the depth this year group is taught.",
    "",
    "Kinds and their fields:",
    "- quotation: quote, the words exactly as the set text prints them, without quotation marks; locator, act.scene and speaker, or stanza and line; statement, what the words show, in one claim.",
    "- date, figure, namedSpecific (a person, place, case study or named source): statement, with the date, number or name in it; locator, the source you would cite for it.",
    "- workedExample: problem, steps and answer, the method taken to its finished form.",
    "",
    "confidence: certain when you would state it to an examiner without checking; unsure when you would check first. Leave out what you cannot recall in full. At most eight facts, fewer when the section lacks fewer; none is fine.",
  ].join("\n"),
  user: (i) =>
    [
      `Subject: ${i.subject}; Year group: ${i.yearGroup}${keyStageOf(i.yearGroup)}`,
      `Brief: ${i.brief}`,
      ...(i.text ? [`Set text: ${i.text.name}, ${i.text.edition}`] : []),
      `Section: ${i.section.title}`,
      `Outcome: ${i.section.outcome}`,
      "Facts already in the section:",
      ...i.existing.map((f) => `- ${f}`),
      `Kinds this section lacks: ${i.kinds.join(", ")}`,
    ].join("\n"),
};

/** A pack section's facts as the context lines of the call, in the pack's list order. */
export function oakFactLines(facts: {
  keyIdeas?: { statement: string }[];
  vocabulary?: { term: string; definition: string }[];
  misconceptions?: { belief: string; correction: string }[];
  workedExamples?: { problem: string; answer: string }[];
}): string[] {
  return [
    ...(facts.keyIdeas ?? []).map((k) => k.statement),
    ...(facts.vocabulary ?? []).map((v) => `term: ${v.term}: ${v.definition}`),
    ...(facts.misconceptions ?? []).map(
      (m) => `misconception: ${m.belief} Response: ${m.correction}`,
    ),
    ...(facts.workedExamples ?? []).map((x) => `worked example: ${x.problem} ${x.answer}`),
  ];
}

/** The fill's pack-side fields, added by code so the model never writes a constant. */
export const FILL_SOURCE = {
  source: "model",
  from: `${packOakFillPrompt.version} (gpt-6-sol)`,
} as const;
