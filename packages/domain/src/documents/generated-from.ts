import { z } from "zod";
import { type RichDoc, richDocToPlainText } from "./rich-text";

/*
 * Provenance of an AI-generated element or block (ADR 0025 §2; F07's names, declared now).
 * `generatedFrom` says which facts the content was derived from and which prompt and model
 * produced it; `authoredBy` is `"ai"` on everything F06 writes and flips to `"teacher"` on the
 * first text edit (`flipToTeacher`, applied by the editor's patch reducers — TEACH-74), keeping
 * the AI's words as `originalText` so the before/after can be diffed later (topic graph PRD
 * §5.6, TG-12). Both are optional so a TeachDeck file parses unchanged.
 */

export type GeneratedFrom = {
  /** `LessonFacts` ids (`o1`, `v3`, …) this content was derived from. */
  factRefs: string[];
  /** The prompt module version, e.g. `generate.v1` (ADR 0025 §17). */
  promptVersion: string;
  /** The Bedrock model id that produced it. */
  model: string;
  /** ISO 8601 UTC time of the model call. */
  at: string;
  /**
   * The plain text the AI wrote, captured on the teacher's first text edit (never at generation,
   * so untouched content carries nothing). May be empty when the AI text was empty.
   */
  originalText?: string;
};

export type AuthoredBy = "ai" | "teacher";

export const GeneratedFromSchema = z.strictObject({
  factRefs: z.array(z.string()),
  promptVersion: z.string(),
  model: z.string(),
  at: z.iso.datetime(),
  originalText: z.string().optional(),
});

export const AuthoredBySchema = z.enum(["ai", "teacher"]);

/** Spread into every element and block schema; the same two optional keys everywhere. */
export const provenanceFields = {
  generatedFrom: GeneratedFromSchema.optional(),
  authoredBy: AuthoredBySchema.optional(),
};

/** The type-level twin of `provenanceFields`. */
export type Provenance = {
  generatedFrom?: GeneratedFrom;
  authoredBy?: AuthoredBy;
};

/**
 * What `plainTextOf` reads: any element or block, typed by the word-carrying fields it may have.
 * Structural on purpose, so both `SlideElement` and `WorksheetBlock` fit without a per-type switch:
 * `doc` (text, gap-text, option, a labelled shape; heading, paragraph, instructions, question,
 * multiple-choice, fill-gap), `answer` (a question's model answer), `options[].text`
 * (multiple-choice), `gaps[].answer` (fill-gap), `pairs` (matching), `words` (word-bank,
 * word-search), `rows` (a table), `label` (an option card, an answer box), `alt` and `caption`
 * (an image).
 */
export type ProvenanceTarget = Provenance & {
  type: string;
  doc?: RichDoc;
  answer?: string;
  options?: readonly { text?: string }[];
  gaps?: readonly { answer: string }[];
  pairs?: readonly { left: string; right: string }[];
  words?: readonly string[];
  rows?: readonly (readonly string[])[];
  label?: string;
  alt?: string;
  caption?: string;
};

/**
 * The teacher-visible words of an element or block, for the before/after comparison and for
 * `originalText`: every word-carrying field, in a fixed order, one line per item (a rich `doc`
 * flattened first; then the model answer, each option, each gap answer, each pair as
 * `left → right`, each word, each table row as its cells joined by ` | `, the label, the alt, the
 * caption). Deterministic plain text, so a later diff (TEACH-97) reads it line by line. A target
 * with no words at all yields `undefined`, never `""`, so no empty `originalText` is written on a
 * shape or a divider.
 */
export function plainTextOf(target: ProvenanceTarget): string | undefined {
  const lines: string[] = [];
  if (target.doc) lines.push(richDocToPlainText(target.doc));
  if (target.answer !== undefined) lines.push(target.answer);
  for (const option of target.options ?? []) if (option.text !== undefined) lines.push(option.text);
  for (const gap of target.gaps ?? []) lines.push(gap.answer);
  for (const pair of target.pairs ?? []) lines.push(`${pair.left} → ${pair.right}`);
  for (const word of target.words ?? []) lines.push(word);
  for (const row of target.rows ?? []) lines.push(row.join(" | "));
  if (target.label !== undefined) lines.push(target.label);
  if (target.alt !== undefined) lines.push(target.alt);
  if (target.caption !== undefined) lines.push(target.caption);
  return lines.length === 0 ? undefined : lines.join("\n");
}

/**
 * Run a teacher's edit over an element or block and, if it changed the words, flip it to the
 * teacher's (`flipToTeacher`). The one place the "snapshot the text, apply, compare, flip" step
 * lives; the lesson's `applyPatch` and the worksheet's `updateBlock` both call it. Plain text is
 * compared, never object identity: Tiptap rebuilds a `doc` on every keystroke, and a re-mark, a
 * move, a restyle or a `correct` toggle is not a text edit. Safe on an immer draft.
 */
export function applyProvenancePatch<T extends ProvenanceTarget>(
  target: T,
  apply: (target: T) => void,
): void {
  const wasAi = target.authoredBy === "ai";
  const before = wasAi ? plainTextOf(target) : undefined;
  apply(target);
  if (wasAi && plainTextOf(target) !== before) flipToTeacher(target, before);
}

/**
 * The first teacher edit of a target the caller read as `"ai"` before the edit: `authoredBy`
 * becomes `"teacher"` and, when the target carries `generatedFrom`, the text it had `before` is
 * kept as `originalText` (once; a later call never overwrites it). The helper does not re-read
 * `authoredBy`, because the edit itself may have spelt the flip out (the image replace patches
 * `authoredBy: "teacher"` with the new picture) and the AI's alt must still be kept. A target
 * without `authoredBy` at all is a teacher-inserted element (ADR 0025 §18) and is left alone.
 * Safe on an immer draft.
 */
export function flipToTeacher(target: Provenance, before: string | undefined): void {
  if (target.authoredBy === undefined) return;
  target.authoredBy = "teacher";
  const from = target.generatedFrom;
  if (from && from.originalText === undefined && before !== undefined) from.originalText = before;
}
