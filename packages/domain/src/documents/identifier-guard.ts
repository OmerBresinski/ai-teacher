/*
 * Identifier guard (ADR 0024 §2; F15-R03; principle P6). A pure, deterministic scan of free text
 * for things that are unambiguously a learner's identity: an email address, a long digit run
 * (UPN, admission number) or a phrase that introduces a named pupil ("a pupil called …"). It is a
 * structural guarantee, not a classifier: every hit is shown to the teacher as a request to
 * reword, so only patterns with no innocent reading are here. A "Firstname Surname" heuristic was
 * tried and removed: topics are routinely Title Case ("How Lego Bricks Are Made", "Ancient Greek
 * Gods") and it refused them; bare names are the `check-input` model step's job, the pipeline's
 * first stage (`@tj/generation` `stages/check-input.ts`, TEACH-137).
 *
 * Applied as a Zod refinement (`guarded`) to every free-text field of `Brief` and `ClassContext`,
 * so the client form and the API reject with the same `GUARD_MESSAGE`. Never applied to the lesson
 * body or title: that is the teacher's content, not class context.
 */
import type { z } from "zod";

export type NamePatternKind = "email" | "id-number" | "pupil-phrase";

export type NamePattern = {
  kind: NamePatternKind;
  /** The offending text exactly as it appears in the input. */
  match: string;
  /** Offset of `match` in the input. */
  index: number;
};

export const GUARD_MESSAGE = "Remove pupil names or identifiers before saving.";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ID_NUMBER = /\d{6,}/g;
const PUPIL_PHRASE = /\b(?:pupil|student|child|learner|boy|girl)\s+(?:called|named)\b/gi;

function collect(text: string, pattern: RegExp, kind: NamePatternKind): NamePattern[] {
  const out: NamePattern[] = [];
  for (const m of text.matchAll(pattern)) out.push({ kind, match: m[0], index: m.index });
  return out;
}

/** Every identifier-like pattern in `text`, in order of appearance. `[]` means the text is clean. */
export function findNamePatterns(text: string): NamePattern[] {
  return [
    ...collect(text, EMAIL, "email"),
    ...collect(text, ID_NUMBER, "id-number"),
    ...collect(text, PUPIL_PHRASE, "pupil-phrase"),
  ].sort((a, b) => a.index - b.index);
}

/** Refine a string schema with the Identifier guard. */
export function guarded(schema: z.ZodString): z.ZodString {
  return schema.refine((s) => findNamePatterns(s).length === 0, { message: GUARD_MESSAGE });
}
