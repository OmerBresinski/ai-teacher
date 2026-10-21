/**
 * A quick check while the writer streams it (TEACH-101 part g; ADR 0039 live writing). The writer
 * gives a quick check as `items: [{ question, answer }]`, so from its first item a draft knows the
 * slide is a quick check: every row written so far holds its "?" chip (an answer not yet written
 * is held by a placeholder), so the chips never come and go. No answer ever shows on a writing
 * slide: the revealed parts (each answer and its cover) are left off the draft, as the answer data
 * is (`stableDraftIds`); the closed slide brings them.
 */
import type { Slide } from "@tj/domain/documents";

type S = Record<string, unknown>;
type Laid = Pick<Slide, "kind" | "elements" | "background" | "question">;

/** The answer a draft holds for a row whose answer has not arrived yet. */
const PENDING_ANSWER = "…";

/** A streaming quick check's fields with every written row's answer held. */
export function quickCheckDraft(s: S): S {
  if (s.template !== "question-set" || !Array.isArray(s.items)) return s;
  return {
    ...s,
    // An item whose question has not started yet is not a row yet.
    items: s.items
      .filter(
        (i) =>
          typeof (i as S | null)?.question === "string" && !!((i as S).question as string).trim(),
      )
      .map((i) => {
        const it = (i ?? {}) as S;
        const a = typeof it.answer === "string" ? it.answer.trim() : "";
        return { ...it, answer: a || PENDING_ANSWER };
      }),
  };
}

/** A draft without its revealed parts: no answer shows while the slide is written. */
export function withoutReveals(slide: Laid): Laid {
  const els = slide.elements.filter((e) => !e.revealStep);
  return els.length === slide.elements.length ? slide : { ...slide, elements: els };
}
