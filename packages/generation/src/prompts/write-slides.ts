import type { PlanSlide } from "./plan-lesson";
import type { Audience } from "./shared";

/*
 * STUB (spike/plan-write). The prompt-engineer agent owns this file and replaces the prompt text.
 * The code depends on: `WRITE_SLIDES_VERSION` (must start "write-slides."), `WriteSlidesInput`
 * and `writeSlidesPrompt(input) → { system, user }`. The output schema is built in code
 * (`writerSchema` per slide, keyed `slide<n>`); its counts are enforced there.
 */

export const WRITE_SLIDES_VERSION = "write-slides.v0";

/** One slide this call writes: its row number, form, layout and contract. */
export type WriteSlideTarget = {
  /** 1-based slide number; the output key is `slide<number>`. */
  number: number;
  form: string;
  layout: string;
  /** `contractText(form, layout)` (or the question set's contract). */
  contract: string;
};

export type WriteSlidesInput = {
  topic: string;
  audience: Audience;
  objectives: string[];
  runningExample: string;
  misconception: string;
  /** The WHOLE checked slide table, slide 1 (the title) first. */
  table: PlanSlide[];
  /** The slides this call writes (2–3). */
  slides: WriteSlideTarget[];
  /**
   * A re-write of one field of one slide that failed the fit check. The output is then just
   * `{ [field]: … }`. `failure` says what the slide showed (e.g. "the heading sits on 2 lines on 4
   * of 10 themes"); never a word or character limit.
   */
  rewrite?: {
    slide: WriteSlideTarget;
    field: string;
    failure: string;
    current: Record<string, unknown>;
  };
};

export function writeSlidesPrompt(input: WriteSlidesInput): { system: string; user: string } {
  return {
    system: "STUB: write the slides you are given to their contracts.",
    user: JSON.stringify(input),
  };
}
