import { QUESTION_TIERS, QUESTION_USES } from "@tj/domain/documents";
import { z } from "zod";
import type { ObjectiveFactsOutput } from "../../src/merge-objective-facts";
import { QUESTION_DEMANDS, QUESTION_FORMS } from "../../src/prompts/plan-facts-objective";

/*
 * A topic pack (lab only; quality PRD np1). Pack → sections → typed facts in the SAME item shapes
 * the per-objective facts call returns (`ObjectiveFactsOutput`, `merge-objective-facts.ts`), so
 * the adapter that feeds a pack into the lesson pipeline is a field copy and nothing is
 * transformed. A pack fact carries, in addition, its `evidence`: which source sentences support
 * it, with a verbatim snippet of at most `SNIPPET_MAX_WORDS` words. Vocabulary carries the PRD's
 * `sense` and `band` (the meaning taught here, the years it is pitched at). The PRD's
 * "misconception {wrong, right}" is generation's `{belief, correction}`; the names are
 * generation's so the adapter is an identity.
 *
 * Every check here is structural (shape, counts, lengths, references, exact equality): a cited
 * sentence exists, a snippet is verbatim inside one cited sentence, a ref is in range. Whether a
 * fact is true, or supported, is a model's declaration (`pack-author.ts` checkers), never code's.
 */

export const SNIPPET_MAX_WORDS = 25;

export const FACT_TYPES = [
  "keyIdeas",
  "misconceptions",
  "vocabulary",
  "workedExamples",
  "questions",
] as const;
export type FactType = (typeof FACT_TYPES)[number];

const line = z.string().trim().min(1);

/** A sentence of a source, numbered within it: `s.<sourceOrdinal>.<seq>` ids are how facts cite. */
export const SentenceSchema = z.strictObject({
  id: z.string().regex(/^s\d+\.\d+$/),
  /** The heading path the sentence sits under, e.g. "Photosynthesis > Light-dependent reactions". */
  heading: z.string(),
  text: line,
});
export type Sentence = z.infer<typeof SentenceSchema>;

export const SourceSchema = z.strictObject({
  id: z.string().regex(/^s\d+$/),
  url: z.string().url(),
  title: z.string().min(1),
  /** Wikipedia: the REST `content-revision-id`; other sources: an ETag or sha256 of the body. */
  revision: z.string().min(1),
  fetchedAt: z.string().datetime(),
  licence: z.enum(["CC-BY-SA-4.0", "CC-BY-4.0", "permission", "public-domain", "OGL-3.0"]),
  sentences: z.array(SentenceSchema),
  /** Set when the source is one Oak National Academy lesson (`oak-import.ts`); `url` is its uri. */
  oak: z
    .strictObject({
      kind: z.literal("oak"),
      lessonSlug: z.string().min(1),
      /** The lesson's page on the Oak website, built from the slug. */
      webUrl: z.string().url(),
      subject: z.string().min(1),
      keyStage: z.string().min(1),
      yearGroups: z.array(z.string()),
      units: z.array(z.strictObject({ uri: z.string().url(), title: z.string().min(1) })),
    })
    .optional(),
});
export type PackSource = z.infer<typeof SourceSchema>;

export const EvidenceSchema = z.strictObject({
  url: z.string().url(),
  sentenceIds: z.array(z.string().regex(/^s\d+\.\d+$/)).min(1),
  snippet: line,
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * Set on a fact copied from Oak (`oak-import.ts`): the Oak item it came from, and which of the
 * fact's required fields Oak has no counterpart for and were filled with a verbatim copy of the
 * item's own text (e.g. a key learning point is a statement only, so `explanation` and `example`
 * repeat it). A later fill step knows exactly which fields are placeholders.
 */
export const OakFactOriginSchema = z.strictObject({
  itemUri: z.string().url(),
  copiedFields: z.array(z.string().min(1)),
});

const withEvidence = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({
    ...shape,
    evidence: z.array(EvidenceSchema).min(1),
    oak: OakFactOriginSchema.optional(),
  });

const MisconceptionOrdinal = z.strictObject({
  type: z.literal("misconception"),
  index: z.number().int().nonnegative(),
});

export const PackKeyIdeaSchema = withEvidence({
  statement: line,
  explanation: line,
  example: line,
  analogy: line.optional(),
});
export const PackMisconceptionSchema = withEvidence({ belief: line, correction: line });
export const PackVocabularySchema = withEvidence({
  term: line,
  /** The meaning taught here (the PRD's word sense), e.g. "in biology, not everyday use". */
  sense: line,
  /** The years the definition is pitched at, e.g. "Y7-9". */
  band: z.string().regex(/^Y\d{1,2}(-\d{1,2})?$/),
  definition: line,
});
export const PackWorkedExampleSchema = withEvidence({
  problem: line,
  steps: z.array(line).min(1).max(6),
  answer: line,
  /** Section-local: the section's objective is index 0. */
  objectiveRefs: z
    .array(z.strictObject({ type: z.literal("objective"), index: z.number().int().nonnegative() }))
    .min(1),
  misconceptionRef: MisconceptionOrdinal.optional(),
});
export const PackQuestionSchema = withEvidence({
  stem: line,
  answer: line,
  reasoning: line,
  tier: z.enum(QUESTION_TIERS),
  use: z.enum(QUESTION_USES),
  demand: z.enum(QUESTION_DEMANDS),
  forms: z.array(z.enum(QUESTION_FORMS)).min(1),
  distractors: z
    .array(z.strictObject({ text: line, misconceptionRef: MisconceptionOrdinal.optional() }))
    .max(3)
    .optional(),
});

export const PackFactsSchema = z.strictObject({
  keyIdeas: z.array(PackKeyIdeaSchema),
  misconceptions: z.array(PackMisconceptionSchema),
  vocabulary: z.array(PackVocabularySchema),
  workedExamples: z.array(PackWorkedExampleSchema),
  questions: z.array(PackQuestionSchema),
});
export type PackFacts = z.infer<typeof PackFactsSchema>;

export const SectionSchema = z.strictObject({
  id: z.string().regex(/^sec\d+$/),
  /** One learning outcome: the objectives call's form (verb first, ≤ 16 words) or, in W7, an Oak pupil outcome ("I can …", up to 160 characters). */
  outcome: z.string().min(8).max(160),
  /** The source sentences this section was written from (the arm's input window). */
  sentenceIds: z.array(z.string().regex(/^s\d+\.\d+$/)).min(1),
  facts: PackFactsSchema,
});
export type PackSection = z.infer<typeof SectionSchema>;

export const PackSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9.-]+$/),
  topic: z.string().min(1),
  subject: z.string().min(1),
  yearGroup: z.string().min(1),
  /** Which authoring arm wrote the facts; a pack is one arm's output, never a mix. */
  arm: z.enum(["luna-rewrite", "sol-rewrite", "sol-knowledge", "hand", "oak-import"]),
  writtenAt: z.string().datetime(),
  /** The prompt versions and model ids the facts were written and linked with. */
  provenance: z.strictObject({
    writer: z.string(),
    writerPrompt: z.string(),
    linker: z.string().optional(),
    linkerPrompt: z.string().optional(),
  }),
  sources: z.array(SourceSchema).min(1),
  sections: z.array(SectionSchema).min(1),
});
export type Pack = z.infer<typeof PackSchema>;

/* ----------------------------------------------------------------------------------------- */
/* Structural checks over a parsed pack.                                                     */
/* ----------------------------------------------------------------------------------------- */

export interface PackIssue {
  path: string;
  issue:
    | "unknown-sentence"
    | "snippet-too-long"
    | "snippet-not-verbatim"
    | "url-not-a-source"
    | "misconception-ref-out-of-range"
    | "objective-ref-out-of-range"
    | "distractor-count-below-declared-form";
  detail: string;
}

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Whitespace-insensitive, case-insensitive containment: a snippet must be inside one cited sentence. */
export const normaliseForMatch = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function sentenceIndex(pack: Pick<Pack, "sources">): Map<string, Sentence> {
  const index = new Map<string, Sentence>();
  for (const source of pack.sources) for (const s of source.sentences) index.set(s.id, s);
  return index;
}

/** Every structural fault a pack carries; empty means the shape is sound (not that it is true). */
export function checkPack(pack: Pack): PackIssue[] {
  const issues: PackIssue[] = [];
  const sentences = sentenceIndex(pack);
  const urls = new Set(pack.sources.map((s) => s.url));
  const evidence = (path: string, list: Evidence[]) => {
    list.forEach((e, ei) => {
      const at = `${path}.evidence[${ei}]`;
      if (!urls.has(e.url)) issues.push({ path: at, issue: "url-not-a-source", detail: e.url });
      if (wordCount(e.snippet) > SNIPPET_MAX_WORDS)
        issues.push({
          path: at,
          issue: "snippet-too-long",
          detail: `${wordCount(e.snippet)} words > ${SNIPPET_MAX_WORDS}`,
        });
      const cited = e.sentenceIds.map((id) => sentences.get(id));
      e.sentenceIds.forEach((id, i) => {
        if (!cited[i]) issues.push({ path: at, issue: "unknown-sentence", detail: id });
      });
      const found = cited.some(
        (s) => s !== undefined && normaliseForMatch(s.text).includes(normaliseForMatch(e.snippet)),
      );
      if (!found && cited.some((s) => s !== undefined))
        issues.push({ path: at, issue: "snippet-not-verbatim", detail: e.snippet.slice(0, 80) });
    });
  };
  pack.sections.forEach((section, si) => {
    const base = `sections[${si}]`;
    section.sentenceIds.forEach((id) => {
      if (!sentences.has(id))
        issues.push({ path: `${base}.sentenceIds`, issue: "unknown-sentence", detail: id });
    });
    const f = section.facts;
    const m = f.misconceptions.length;
    f.keyIdeas.forEach((k, i) => {
      evidence(`${base}.keyIdeas[${i}]`, k.evidence);
    });
    f.misconceptions.forEach((x, i) => {
      evidence(`${base}.misconceptions[${i}]`, x.evidence);
    });
    f.vocabulary.forEach((v, i) => {
      evidence(`${base}.vocabulary[${i}]`, v.evidence);
    });
    f.workedExamples.forEach((x, i) => {
      const at = `${base}.workedExamples[${i}]`;
      evidence(at, x.evidence);
      if (x.misconceptionRef && x.misconceptionRef.index >= m)
        issues.push({
          path: at,
          issue: "misconception-ref-out-of-range",
          detail: `${x.misconceptionRef.index} of ${m}`,
        });
      for (const r of x.objectiveRefs)
        if (r.index !== 0)
          issues.push({
            path: at,
            issue: "objective-ref-out-of-range",
            detail: `${r.index}: a section has one objective, index 0`,
          });
    });
    f.questions.forEach((q, i) => {
      const at = `${base}.questions[${i}]`;
      evidence(at, q.evidence);
      for (const d of q.distractors ?? [])
        if (d.misconceptionRef && d.misconceptionRef.index >= m)
          issues.push({
            path: at,
            issue: "misconception-ref-out-of-range",
            detail: `${d.misconceptionRef.index} of ${m}`,
          });
      if (q.forms.includes("multiple-choice") && (q.distractors?.length ?? 0) < 3)
        issues.push({
          path: at,
          issue: "distractor-count-below-declared-form",
          detail: `multiple-choice declared with ${q.distractors?.length ?? 0} distractors`,
        });
    });
  });
  return issues;
}

/**
 * A section's facts in the shape one per-objective facts call returns: evidence, sense and band
 * dropped, everything else copied field for field. The refs stay section-local (objective 0); the
 * caller re-points them at the lesson objective the section was matched to.
 */
export function sectionToObjectiveFacts(
  section: PackSection,
  types: readonly FactType[] = FACT_TYPES,
): ObjectiveFactsOutput {
  const want = new Set(types);
  const f = section.facts;
  return {
    keyIdeas: want.has("keyIdeas")
      ? f.keyIdeas.map(({ statement, explanation, example, analogy }) => ({
          statement,
          explanation,
          example,
          ...(analogy === undefined ? {} : { analogy }),
        }))
      : [],
    misconceptions: want.has("misconceptions")
      ? f.misconceptions.map(({ belief, correction }) => ({ belief, correction }))
      : [],
    vocabulary: want.has("vocabulary")
      ? f.vocabulary.map(({ term, definition }) => ({ term, definition }))
      : [],
    workedExamples: want.has("workedExamples")
      ? f.workedExamples.map(({ problem, steps, answer, objectiveRefs, misconceptionRef }) => ({
          problem,
          steps: [...steps],
          answer,
          objectiveRefs: objectiveRefs.map((r) => ({ ...r })),
          ...(misconceptionRef === undefined ? {} : { misconceptionRef: { ...misconceptionRef } }),
        }))
      : [],
    questions: want.has("questions")
      ? f.questions.map(({ stem, answer, reasoning, tier, use, demand, forms, distractors }) => ({
          stem,
          answer,
          reasoning,
          tier,
          use,
          demand,
          forms: [...forms],
          ...(distractors === undefined
            ? {}
            : {
                distractors: distractors.map(({ text, misconceptionRef }) => ({
                  text,
                  ...(misconceptionRef === undefined
                    ? {}
                    : { misconceptionRef: { ...misconceptionRef } }),
                })),
              }),
        }))
      : [],
  };
}

/** Which fact types a section holds at least one of. */
export function presentTypes(section: PackSection): FactType[] {
  return FACT_TYPES.filter((t) => section.facts[t].length > 0);
}
