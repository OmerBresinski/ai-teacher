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

/** What `plainTextOf` reads: any element or block, typed by the fields it may carry. */
export type ProvenanceTarget = Provenance & {
  type: string;
  doc?: RichDoc;
  alt?: string;
};

/**
 * The words of an element or block, for the before/after comparison and for `originalText`:
 * anything with a `doc` (`text`, `gap-text`, `option`, a labelled shape; rich worksheet blocks)
 * is its rich text flattened; an `image` is its `alt` (which may be `undefined`); anything else
 * has no text and yields `undefined`, never `""`, so no empty `originalText` is written on a shape.
 */
export function plainTextOf(target: ProvenanceTarget): string | undefined {
  if (target.doc) return richDocToPlainText(target.doc);
  if (target.type === "image") return target.alt;
  return undefined;
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
