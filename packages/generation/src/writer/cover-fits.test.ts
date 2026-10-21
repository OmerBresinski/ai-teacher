import { describe, expect, test } from "bun:test";
import CAPACITY from "@tj/slides/templates/cover-capacity.json" with { type: "json" };
import { charsOver, fitTable } from "./fixes";

// Ruling 21 A (TEACH-215 part e): the writer's cover caps are the renderer's measured table.
describe("cover fit: the gold's three title lines and two question lines", () => {
  const cap = CAPACITY.KS2.picture;
  test("the fit table's cover row is cover-capacity.json", () => {
    const v = fitTable().KS2?.layouts.title?.variants.find((x) => x.figure);
    expect(v?.chars).toBe(cap.question);
    expect(v?.heading).toBe(cap.title);
  });
  const slide = (heading: string, lead: string) => ({
    template: "title",
    heading,
    lead,
    picture: { shows: "a pond" },
  });
  test("a question past its two lines is over; one at the cap is not", () => {
    expect(charsOver(slide("Ponds", "x".repeat(cap.question)), "KS2")).toEqual([]);
    expect(charsOver(slide("Ponds", "x".repeat(cap.question + 1)), "KS2")[0]).toMatch(/^lead: /);
  });
  test("a title past its three lines is over", () => {
    expect(charsOver(slide("x".repeat(cap.title + 1), "Why?"), "KS2")[0]).toMatch(/^heading: /);
  });
});
