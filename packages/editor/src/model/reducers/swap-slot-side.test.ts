import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { materialiseSlides, slotSideOf } from "@tj/slides";
import { swapSlotSide } from "./slides";

describe("swapSlotSide (look/slides-layout)", () => {
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

  test("moves the slot to the other side and back", () => {
    if (!slide) throw new Error("no slide");
    const once = swapSlotSide(lesson(), slide.id);
    expect(slotSideOf(once.slides[0] as never)).toBe("right");
    const twice = swapSlotSide(once, slide.id);
    expect(twice.slides[0]?.elements).toEqual(slide.elements);
  });

  test("a slide without a slot, or an unknown id, leaves the lesson as it is", () => {
    const plain = generatedLesson();
    expect(swapSlotSide(plain, plain.slides[1]?.id ?? "")).toBe(plain);
    expect(swapSlotSide(plain, "nope")).toBe(plain);
  });
});
