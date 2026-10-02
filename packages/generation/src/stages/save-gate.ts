import { safeError } from "@tj/domain";
import type { Slide } from "@tj/domain/documents";
import { fitsPlanned, type SlideSpec } from "@tj/slides";
import type { PipelineDeps } from "../types";

/**
 * The save gate: each generated slide's spec is checked with `fitsPlanned` at one step down (UX
 * ruling 91's one smaller size, once) on every theme, because a teacher can change the look after
 * the lesson is written. `finish` is what Generate does to the materialised slide before it saves
 * it (a coded question set's answers reveal), so the slide checked is the slide saved. The result
 * is logged, one line per slide and a warning when it does not fit, as counts per theme and never
 * slide text. Nothing is rewritten, and a fault in the check never costs the slide.
 */
export function saveGate(
  spec: SlideSpec,
  index: number,
  deps: Pick<PipelineDeps, "logger">,
  finish?: (slide: Slide, themeId: string) => Slide,
): void {
  try {
    const { ok, failing } = fitsPlanned(spec, { stepDown: 1, finish });
    const failingCounts = failing.map((f) => ({
      theme: f.theme,
      overflow: f.overflow.length,
      overlaps: f.overlaps,
      lane: f.lane.length,
      steps: f.steps,
      answers: f.answers.length,
    }));
    const fields = { stage: "generate", index, kind: spec.kind, fits: ok };
    if (ok) deps.logger.info(fields, "save gate");
    else deps.logger.warn({ ...fields, failing: failingCounts }, "save gate");
  } catch (error) {
    deps.logger.warn({ stage: "generate", index, err: safeError(error) }, "save gate failed");
  }
}
