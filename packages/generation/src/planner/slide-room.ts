import {
  fitSlide,
  HEADING_NAME,
  isBackdrop,
  isCalloutElement,
  materialiseSlide,
  SAFE_BOTTOM,
  type SlideSpec,
  SPEC_LIMITS,
  THEMES,
} from "@tj/slides";

/*
 * Slot-first packing (fit lab, 29 Sep): the room a teaching slide has, measured with the real
 * layout before the slide is written. The outline fixes the slots first (the brief's slide count
 * is exact), then fills each from its facts in priority order — key ideas, then the callout, then
 * the terms it defines — keeping a piece only while the slide projected from the facts, word for
 * word, still fits on every theme. A piece that does not fit is left off the slide and named in a
 * gap; nothing is shortened to make it fit.
 *
 * The projection is what the writer is asked to present (`generate-slide` v31): the heading is
 * the first key idea's statement, the body each key idea's explanation then its example, then a
 * short definition of each term it hands out; a worked example is its problem and its steps as
 * the facts give them.
 */

export type IdeaText = { statement: string; explanation: string; example: string };
export type TermText = { term: string; definition: string };
export type CalloutText = { kind: "watch-out" | "key-words" | "example"; text: string };

const META = { promptVersion: "room", model: "room", at: "1970-01-01T00:00:00.000Z" };
const FRAME = new Set([HEADING_NAME, "Kind tag", "Accent bar"]);

/** The slide laid out on every theme: nothing overflows, the words end in the safe area, and a callout asked for is on it. */
function fitsEveryTheme(spec: SlideSpec): boolean {
  const wantsCallout = "callout" in spec && spec.callout !== undefined;
  return THEMES.every((theme) => {
    const laid = materialiseSlide(spec, theme.id, META);
    const fitted = fitSlide(laid, theme);
    if (fitted.overflow.length > 0) return false;
    if (wantsCallout && !fitted.slide.elements.some(isCalloutElement)) return false;
    const foot = Math.max(
      0,
      ...fitted.slide.elements
        .filter((e) => !FRAME.has(e.name ?? "") && !isBackdrop(e) && !(e.revealStep ?? 0))
        .map((e) => e.y + e.h),
    );
    return foot <= SAFE_BOTTOM;
  });
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** A content slide's body as the writer presents the facts: one paragraph per key idea, then the terms. */
export function contentBody(ideas: readonly IdeaText[], terms: readonly TermText[] = []): string {
  const paragraphs = ideas.map((k) => `${k.explanation} ${k.example}`.trim());
  const defined = terms.map((t) => `${t.term}: ${t.definition}`).join(" ");
  return [...paragraphs, ...(defined ? [defined] : [])].join("\n\n");
}

/**
 * Whether a content slide with these key ideas (the first gives the heading), terms and callout
 * fits. Two or more key ideas must also keep the body within the writer's body cap.
 */
export function contentFits(
  ideas: readonly IdeaText[],
  terms: readonly TermText[] = [],
  callout?: CalloutText,
): boolean {
  const first = ideas[0];
  if (!first) return true;
  const body = contentBody(ideas, terms);
  if (ideas.length > 1 && body.length > SPEC_LIMITS.body) return false;
  const spec: SlideSpec = {
    kind: "content",
    factRefs: [],
    heading: first.statement,
    body,
    ...(callout
      ? { callout: { kind: callout.kind, text: clip(callout.text, SPEC_LIMITS.callout) } }
      : {}),
  };
  return fitsEveryTheme(spec);
}

/**
 * Whether a worked example fits one slide as the writer shows it: the problem, then each step and
 * the answer as its last line (at most four lines).
 */
export function workedExampleFits(
  problem: string,
  steps: readonly string[],
  answer: string,
): boolean {
  const lines = answer.trim() ? [...steps, answer] : [...steps];
  if (lines.length === 0 || lines.length > 4) return false;
  // The writer adds a heading of about one line: the problem's opening stands in for it.
  const heading = problem.slice(0, SPEC_LIMITS.heading - 20);
  return fitsEveryTheme({
    kind: "worked-example",
    factRefs: [],
    heading,
    question: problem,
    steps: lines,
  });
}
