import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { materialiseSlides, slotSideOf } from "@tj/slides";
import { setSlotSide } from "./slides";

describe("setSlotSide (look/slides-layout, R2)", () => {
  const [slide] = materialiseSlides(
    {
      kind: "content",
      heading: "Roman soldiers",
      body: "Roman soldiers carried a large shield and wore metal armour. Both kept them safe in battle.",
      factRefs: [],
    },
    "chalk",
    { promptVersion: "t", model: "m", at: "2026-09-27T00:00:00.000Z" },
    undefined,
    0,
    { photo: { subject: "Roman legionaries", mustShow: ["shields"] } },
  );
  const lesson = (): Lesson => ({ ...generatedLesson(), slides: slide ? [slide] : [] });

  test("moves the slot to the side asked for and back; the side it is on is no change", () => {
    if (!slide) throw new Error("no slide");
    const start = lesson();
    expect(setSlotSide(start, slide.id, "left")).toBe(start);
    const once = setSlotSide(start, slide.id, "right");
    expect(slotSideOf(once.slides[0] as never)).toBe("right");
    expect(setSlotSide(once, slide.id, "right")).toBe(once);
    const twice = setSlotSide(once, slide.id, "left");
    expect(twice.slides[0]?.elements).toEqual(slide.elements);
  });

  test("a slide without a slot, or an unknown id, leaves the lesson as it is", () => {
    const plain = generatedLesson();
    expect(setSlotSide(plain, plain.slides[1]?.id ?? "", "right")).toBe(plain);
    expect(setSlotSide(plain, "nope", "right")).toBe(plain);
  });
});
