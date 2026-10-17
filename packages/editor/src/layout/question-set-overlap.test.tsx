import { describe, expect, test } from "bun:test";
import { type Slide, type SlideElement, slideStepCount, type Theme } from "@tj/domain/documents";
import { layoutTemplate, type Stage, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, THEMES } from "@tj/slides/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideView } from "../slide/SlideView";
import { answerLineLayout } from "./explanation";

/*
 * The quick check (question-set) reveals its own answers, one per click, in its sand field. No
 * surface may draw a second copy of them: the editor's answer preview, the print and PDF with
 * answers and Present all hand `SlideView` `revealAnswer`, and its plain answer line
 * (`answerLineLayout`) under the lowest element used to land on the last question (saved y8-rivers
 * slide 2: "1. Its source 2. Its mouth 3. Gravity" over "What pulls river water downhill?").
 *
 * Pinned: at every stage, theme and question count, at every reveal step, with the answer state
 * on or off, no visible text box meets another.
 */

/** The template's element names (`QUICK_NAMES` in `@tj/slides`' question-set template). */
const WAIT = "Answer to come";
const COVER = "Answer cover";

const RIVERS: [string, string][] = [
  ["Where does a river begin?", "Its source"],
  ["Where does a river end?", "Its mouth"],
  ["What pulls river water downhill?", "Gravity"],
  ["Where does a river meet the sea?", "The estuary"],
  ["What is a river's load?", "Carried material"],
  ["What is the land a river drains?", "Its basin"],
];
const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
const MAX: Record<Stage, number> = { ks1: 4, ks2: 6, ks3: 6, ks4: 6, ks5: 6 };

type Rect = { x: number; y: number; w: number; h: number };
type Box = Rect & { what: string };
const meets = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const hasText = (e: SlideElement): boolean =>
  e.type === "text" ||
  (e.type === "shape" &&
    typeof (e as { text?: unknown }).text === "string" &&
    !!(e as { text?: string }).text?.trim());

/** The answer line SlideView draws at `step` (its text), or null when it draws none. */
function drawnAnswerLine(slide: Slide, theme: Theme, step: number, reveal: boolean) {
  const html = renderToStaticMarkup(
    <SlideView slide={slide} theme={theme} mode="capture" step={step} revealAnswer={reveal} />,
  );
  const m = html.match(/data-answer-line=""[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
  return m ? (m[1] as string) : null;
}

/** The text boxes the pupil sees at `step`, with the answer state on or off. */
function visibleText(slide: Slide, theme: Theme, step: number, reveal: boolean) {
  const shown = (e: SlideElement) => (e.revealStep ?? 0) <= step;
  const covers = slide.elements.filter((e) => e.name === COVER && shown(e));
  const boxes: Box[] = slide.elements
    .filter((e) => shown(e) && hasText(e))
    // A "?" chip under its cover is hidden.
    .filter((e) => !(e.name === WAIT && covers.some((c) => meets(c, e))))
    .map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h, what: `${e.name ?? e.type}` }));
  // What the renderer really draws: SlideView's answer line, read from its markup (not from the
  // function that decides it), placed at the box the component lays it out at.
  const text = drawnAnswerLine(slide, theme, step, reveal);
  if (text !== null) {
    const line = answerLineLayout({ slide, theme, text });
    boxes.push({ x: line.x, y: line.y, w: line.w, h: line.h, what: "answer line" });
  }
  return boxes;
}

describe("question-set: no text box meets another, at any step, theme or count", () => {
  for (const stage of STAGES)
    for (let n = 3; n <= MAX[stage]; n++)
      test(`${stage}, ${n} questions`, () => {
        const items = RIVERS.slice(0, n);
        const input: TemplateInput = {
          template: "question-set",
          heading: "Recall river vocabulary",
          questions: items.map((i) => i[0]),
          answers: items.map((i) => i[1]),
        };
        const clashes: string[] = [];
        for (const base of THEMES) {
          const r = layoutTemplate(input, base, stage);
          const slide = { id: "s", ...r.slide } as Slide;
          const theme = atKeyStage(base, stage);
          const steps = slideStepCount(slide);
          for (let step = 0; step <= steps; step++)
            for (const reveal of [false, true]) {
              const boxes = visibleText(slide, theme, step, reveal);
              boxes.forEach((a, i) => {
                for (const b of boxes.slice(i + 1))
                  if (meets(a, b))
                    clashes.push(`${base.id} step ${step} reveal ${reveal}: ${a.what} / ${b.what}`);
              });
            }
        }
        expect(clashes).toEqual([]);
      });
});
