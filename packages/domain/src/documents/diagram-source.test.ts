import { describe, expect, test } from "bun:test";
import { lesson } from "./fixtures.test-helpers";
import { parseLesson } from "./lesson";
import { type ImageElement, type Slide, SlideSchema } from "./slide";

/*
 * TEACH-97 part h: a drawn diagram or a library model keeps what it was drawn from on its image
 * element (`diagram`), so the settings panel (part g) can redraw it. Older lessons have none.
 */
const image = (extra: Partial<ImageElement> = {}): ImageElement => ({
  id: "d1",
  type: "image",
  name: "Diagram",
  x: 40,
  y: 120,
  w: 420,
  h: 300,
  src: "data:image/svg+xml,%3Csvg%2F%3E",
  alt: "The water cycle",
  fit: "contain",
  ...extra,
});
const slideWith = (el: ImageElement): Slide => ({ ...lesson().slides[0], elements: [el] }) as Slide;
const roundTrip = (el: ImageElement) =>
  SlideSchema.parse(JSON.parse(JSON.stringify(slideWith(el)))).elements[0];

describe("ImageElement.diagram (TEACH-97 part h)", () => {
  test("a drawer diagram keeps its spec through save and load", () => {
    const spec = { kind: "cycle", steps: [{ label: "Evaporation" }, { label: "Rain" }] };
    const el = image({ diagram: { kind: "drawer", spec }, builds: 2 });
    expect(roundTrip(el)).toEqual(el);
  });

  test("a library model keeps its model, params, step and type scale", () => {
    const el = image({
      diagram: {
        kind: "library",
        model: "number_line",
        params: { start: 0, end: 20, step: 5, marks: [{ at: 5, label: "five" }] },
        step: 1,
        typeScale: 1.2,
      },
    });
    expect(roundTrip(el)).toEqual(el);
  });

  test("a library model without step or type scale is valid", () => {
    const el = image({ diagram: { kind: "library", model: "clock", params: { time: "7:30" } } });
    expect(roundTrip(el)).toEqual(el);
  });

  test("an image saved before part h loads unchanged, with no diagram key", () => {
    const el = image();
    const back = roundTrip(el);
    expect(back).toEqual(el);
    expect(Object.hasOwn(back ?? {}, "diagram")).toBe(false);
    const old = lesson();
    expect(parseLesson(JSON.parse(JSON.stringify(old)))).toEqual(old);
  });

  test("an unknown kind or a library entry without a model is refused", () => {
    const bad = [
      { kind: "photo", spec: {} },
      { kind: "library", params: {} },
      { kind: "drawer" },
      { kind: "library", model: "clock", params: {}, step: -1 },
    ];
    for (const diagram of bad)
      expect(
        SlideSchema.safeParse(slideWith(image({ diagram } as unknown as Partial<ImageElement>)))
          .success,
      ).toBe(false);
  });
});
