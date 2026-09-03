import { z } from "zod";

/**
 * Universal state vocabulary (F18-R07, glossary "Draft / Reviewed / Stale / Taught / Needs
 * attention"). The same chips are rendered everywhere; feature PRDs reference these enums rather
 * than redefining strings.
 */

/** Review lifecycle of an Artefact. `stale` = a Reviewed artefact whose inputs changed (Flow 10). */
export const ArtefactState = z.enum(["draft", "reviewed", "stale"]);
export type ArtefactState = z.infer<typeof ArtefactState>;

/** Whether a Lesson has been delivered. */
export const LessonTaughtState = z.enum(["planned", "taught"]);
export type LessonTaughtState = z.infer<typeof LessonTaughtState>;

/**
 * Attention marker shown as the "Needs attention" chip. Modelled as a two-value enum rather than
 * a boolean so it serialises like the other states, can grow (e.g. a reason code) without a
 * type change, and reads unambiguously in JSON (`"needs_attention"` vs `true`).
 */
export const AttentionFlag = z.enum(["none", "needs_attention"]);
export type AttentionFlag = z.infer<typeof AttentionFlag>;
