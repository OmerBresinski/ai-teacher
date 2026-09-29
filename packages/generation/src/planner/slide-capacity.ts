import {
  fitSlide,
  getTheme,
  isCalloutElement,
  materialiseSlide,
  measureHeadless,
  type SlideSpec,
  THEMES,
} from "@tj/slides";
// Lab only: the editor's own lint, the ruler first open uses to decide what Tidy splits.
import { renderedHeights } from "../../../editor/src/layout/fit-plan";
import { lintSlide } from "../../../editor/src/layout/lint";

/*
 * Narrative then cut (fit-lab approach 9, 29 Sep 2026). The teach call writes each objective as
 * the teacher's spoken walkthrough, already cut at its natural breaks into key ideas, each with
 * the lines the slide shows (`statement`, `explanation`, `example`) beside what the teacher says
 * (`say`, which goes to notes). The outline then decides where the slide breaks fall by measuring:
 * two stretches share a slide, and a callout joins one, only when the slide as it will be shown
 * fits the real layout. Projection and measure after `fitsExitTicket`, ported from the
 * planner-measures arm: materialised on every theme, fitted with the editor's engine and the
 * headless ruler; fits when nothing is left past the safe area and a planned callout is placed.
 */

const META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };

export type IdeaText = { statement: string; explanation: string; example?: string };
export type CalloutText = { kind: "watch-out" | "key-words" | "example"; text: string };

/** A content slide as shown: the first statement as heading, one paragraph per stretch. */
export function contentProjection(ideas: readonly IdeaText[], callout?: CalloutText): SlideSpec {
  const heading = ideas[0]?.statement.trim() ?? "";
  const body = ideas
    .map((k) => [k.explanation.trim(), k.example?.trim() ?? ""].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n\n");
  return {
    kind: "content",
    factRefs: [],
    heading,
    body,
    ...(callout ? { callout } : {}),
  } as SlideSpec;
}

const WORKED_EXAMPLE_HEADING = "Working out the method on one problem, step by step";

/** A worked example as its slide shows it: the problem, one line per step, the answer last. */
export function workedExampleProjection(
  problem: string,
  steps: readonly string[],
  answer?: string,
  callout?: CalloutText,
): SlideSpec {
  return {
    kind: "worked-example",
    factRefs: [],
    // The writer titles the method (fit-lab r3: 24-52 characters, often two lines), so the
    // projection carries a heading of that length rather than a short label.
    heading: WORKED_EXAMPLE_HEADING,
    question: problem.trim(),
    steps: [...steps, ...(answer ? [answer] : [])].map((s) => s.trim()),
    ...(callout ? { callout } : {}),
  } as SlideSpec;
}

/** Fits one slide on every theme: no overflow at the floor, the callout placed, and the editor's lint clean. */
export function fitsPlanned(spec: SlideSpec): boolean {
  const wantsCallout = "callout" in spec && spec.callout !== undefined;
  return THEMES.every((theme) => {
    const slide = materialiseSlide(spec, theme.id, META);
    if (wantsCallout && !slide.elements.some(isCalloutElement)) return false;
    const fitted = fitSlide(slide, getTheme(theme.id));
    if (fitted.overflow.length > 0) return false;
    const measure = measureHeadless(theme);
    return lintSlide(renderedHeights(fitted.slide, measure), measure, theme).ok;
  });
}
