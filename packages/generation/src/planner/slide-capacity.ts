import {
  fitSlide,
  getTheme,
  isCalloutElement,
  materialiseSlide,
  type SlideSpec,
  THEMES,
} from "@tj/slides";

/*
 * Fit first (29 Sep): the outline measures a teaching slide while it is planned, on the real
 * layout, instead of counting what goes on it. A planned slide is projected from the facts it
 * will show, word for word (`contentProjection`, `workedExampleProjection`), materialised on every
 * theme and fitted with the editor's engine and the headless ruler, the pattern `fitsExitTicket`
 * set. It fits when nothing is left past the safe area at the floor and, when it plans one, the
 * callout is placed. Every theme, because a teacher can change the look after the lesson is
 * written. Pure and deterministic; about a millisecond per theme.
 */

const META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };

/** The facts a content slide shows: each key idea's statement and explanation. */
export type IdeaText = { statement: string; explanation: string };
export type CalloutText = { kind: "watch-out" | "key-words" | "example"; text: string };

/**
 * A content slide as the writer builds it: a heading the length of the first idea's statement,
 * then one paragraph per idea, its explanation. The writer's body runs to about the explanations'
 * length (lab decks, 29 Sep: 350 characters written for 302 of explanation), the example woven in.
 */
export function contentProjection(ideas: readonly IdeaText[], callout?: CalloutText): SlideSpec {
  const heading = ideas[0]?.statement.trim() ?? "";
  const body = ideas.map((k) => k.explanation.trim()).join("\n\n");
  return {
    kind: "content",
    factRefs: [],
    heading,
    body,
    ...(callout ? { callout } : {}),
  } as SlideSpec;
}

/** A worked example as its slide shows it: the problem, then one line per step. */
export function workedExampleProjection(problem: string, steps: readonly string[]): SlideSpec {
  return {
    kind: "worked-example",
    factRefs: [],
    heading: "Worked example",
    question: problem.trim(),
    steps: steps.map((s) => s.trim()),
  } as SlideSpec;
}

/** The spec fits one slide on every theme: no overflow at the floor, the callout placed. */
export function fitsPlanned(spec: SlideSpec): boolean {
  if (spec.kind === "worked-example" && spec.steps.length > 4) return false;
  const wantsCallout = "callout" in spec && spec.callout !== undefined;
  return THEMES.every((theme) => {
    const slide = materialiseSlide(spec, theme.id, META);
    if (wantsCallout && !slide.elements.some(isCalloutElement)) return false;
    return fitSlide(slide, getTheme(theme.id)).overflow.length === 0;
  });
}
