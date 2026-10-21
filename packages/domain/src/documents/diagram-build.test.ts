import { describe, expect, test } from "bun:test";
import { multipleChoiceSlide, titleSlide, trueFalseSlide } from "./fixtures.test-helpers";
import {
  diagramBuildAt,
  diagramBuildSteps,
  type ImageElement,
  type Slide,
  type SlideElement,
  SlideSchema,
  slideStepCount,
} from "./slide";

/*
 * TEACH-205 part c (W-d4). The first block pins `diagramBuildAt` as it was on master before
 * `buildFrom` existed (acceptance row 1): a diagram without `buildFrom` must behave exactly the same.
 */

const diagram = (over: Partial<ImageElement> = {}): ImageElement => ({
  id: "d1",
  type: "image",
  x: 0,
  y: 0,
  w: 300,
  h: 200,
  src: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
  fit: "contain",
  builds: 3,
  ...over,
});

const row = (id: string, revealStep: number): SlideElement => ({
  id,
  type: "text",
  x: 0,
  y: 40 * revealStep,
  w: 400,
  h: 40,
  revealStep,
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: id }] }] },
  style: { preset: "body" },
});

const withEls = (base: Slide, ...els: SlideElement[]): Slide => ({
  ...base,
  elements: [...base.elements, ...els],
});

describe("diagramBuildAt, pinned before buildFrom (row 1)", () => {
  test("a plain slide: builds start after the last element reveal", () => {
    const s = withEls(titleSlide(), row("r1", 1), row("r2", 2), diagram());
    expect(slideStepCount(s)).toBe(5);
    expect([0, 1, 2, 3, 4, 5, 9].map((k) => diagramBuildAt(s, k))).toEqual([0, 0, 0, 1, 2, 3, 3]);
  });

  test("a multiple-choice slide: builds sit between the reveals and the answer", () => {
    const s = withEls(multipleChoiceSlide(), diagram());
    expect(diagramBuildSteps(s)).toBe(3);
    expect(slideStepCount(s)).toBe(7);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => diagramBuildAt(s, k))).toEqual([
      0, 0, 1, 2, 3, 3, 3, 3,
    ]);
  });

  test("a true-false slide with no reveals: builds play from the first Next", () => {
    const s = withEls(trueFalseSlide(), diagram({ builds: 2 }));
    expect(slideStepCount(s)).toBe(4);
    expect([0, 1, 2, 3, 4].map((k) => diagramBuildAt(s, k))).toEqual([0, 1, 2, 2, 2]);
  });

  test("two diagrams play together; the larger sets the count", () => {
    const s = withEls(titleSlide(), diagram(), diagram({ id: "d2", builds: 5 }));
    expect(diagramBuildSteps(s)).toBe(5);
    expect([0, 1, 5, 6].map((k) => diagramBuildAt(s, k))).toEqual([0, 1, 5, 5]);
  });

  test("a diagram inside a group counts; a slide without builds is always 0", () => {
    const group: SlideElement = {
      id: "g",
      type: "group",
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      children: [diagram({ builds: 2 })],
    };
    const s = withEls(titleSlide(), group);
    expect([0, 1, 2, 3].map((k) => diagramBuildAt(s, k))).toEqual([0, 1, 2, 2]);
    expect(diagramBuildAt(titleSlide(), 3)).toBe(0);
  });
});

describe("buildFrom: a drawn diagram's builds ride slide rows (W-d4)", () => {
  const worked = () =>
    withEls(titleSlide(), row("r1", 1), row("r2", 2), row("r3", 3), diagram({ buildFrom: 1 }));

  test("parses, and build i shows with row i", () => {
    const s = worked();
    expect(SlideSchema.parse(s)).toEqual(s);
    const el = s.elements.at(-1) as ImageElement;
    expect([0, 1, 2, 3, 4].map((k) => diagramBuildAt(s, k, el))).toEqual([0, 1, 2, 3, 3]);
  });

  test("adds no trailing steps; the step count covers the last build", () => {
    expect(slideStepCount(worked())).toBe(3);
    const late = withEls(titleSlide(), row("r1", 1), diagram({ buildFrom: 2, builds: 4 }));
    expect(slideStepCount(late)).toBe(5);
    const el = late.elements.at(-1) as ImageElement;
    expect([0, 1, 2, 5].map((k) => diagramBuildAt(late, k, el))).toEqual([0, 0, 1, 4]);
  });

  test("a row-bound diagram leaves an unbound one's timing unchanged", () => {
    const s = withEls(worked(), diagram({ id: "d2", builds: 2 }));
    const free = s.elements.at(-1) as ImageElement;
    expect(diagramBuildSteps(s)).toBe(2);
    expect(slideStepCount(s)).toBe(5);
    expect([3, 4, 5].map((k) => diagramBuildAt(s, k, free))).toEqual([0, 1, 2]);
    expect([3, 4, 5].map((k) => diagramBuildAt(s, k))).toEqual([0, 1, 2]);
  });

  test("a bad buildFrom is refused", () => {
    expect(() => SlideSchema.parse(withEls(titleSlide(), diagram({ buildFrom: -1 })))).toThrow();
    expect(() => SlideSchema.parse(withEls(titleSlide(), diagram({ buildFrom: 1.5 })))).toThrow();
  });
});
