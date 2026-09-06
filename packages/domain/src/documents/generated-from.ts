import { z } from "zod";

/*
 * Provenance of an AI-generated element or block (ADR 0025 §2; F07's names, declared now).
 * `generatedFrom` says which facts the content was derived from and which prompt and model
 * produced it; `authoredBy` is `"ai"` on everything F06 writes and flips to `"teacher"` on the
 * first manual edit (F07's behaviour). Both are optional so a TeachDeck file parses unchanged.
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
};

export type AuthoredBy = "ai" | "teacher";

export const GeneratedFromSchema = z.strictObject({
  factRefs: z.array(z.string()),
  promptVersion: z.string(),
  model: z.string(),
  at: z.iso.datetime(),
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
