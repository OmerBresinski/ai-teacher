import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { G, layoutTemplate, type TemplateInput } from "./index";

/* Ruling 198 (TEACH-75 part b): a two-line title moves the body down; it shrinks only without room. */

const LH_HEADING = 1.12;
const lay = (heading: string, questions: string[]) => {
  const r = layoutTemplate(
    { template: "question-set", heading, questions } as TemplateInput,
    getTheme("studio", "ks3" as never),
    "ks3",
  );
  const els = r.slide.elements;
  const head = els.find((e) => e.name === "Heading");
  if (head?.type !== "text") throw new Error("no heading");
  const size = Number(head.style?.fontSize);
  const body = els.filter((e) => e !== head);
  return {
    r,
    head,
    size,
    gap: Math.min(...body.map((e) => e.y)) - (head.y + head.h),
    // the template's gap under a one-line heading at this size
    oneLineGap: G.band.y - (G.headY + Math.ceil(size * LH_HEADING)),
    foot: Math.max(...body.map((e) => e.y + e.h)),
  };
};
const long = "Why does the heart beat faster when we run, swim or climb the stairs at school?";
const qs = (n: number, extra = "") =>
  Array.from({ length: n }, (_, i) => `Question ${i + 1}: why does the pulse rise${extra}?`);

describe("body top from the measured heading (ruling 198)", () => {
  test("a two-line heading with room moves the body down by the extra line, at full size", () => {
    const one = lay("Quick check", qs(5));
    const two = lay(long, qs(5));
    expect(two.size).toBe(one.size);
    expect(two.head.h).toBeGreaterThan(one.head.h * 1.5);
    expect(two.gap).toBe(two.oneLineGap);
    expect(two.r.over.filter((o) => o.startsWith("heading"))).toEqual([]);
  });
  test("a body already lower than the gap stays where it is", () => {
    const one = lay("Quick check", qs(2));
    const two = lay(long, qs(2));
    expect(two.gap).toBeGreaterThan(two.oneLineGap);
    expect(two.foot).toBe(one.foot);
  });
  test("a body that already overruns the slide is left to fit, not moved further", () => {
    const many = qs(7, " during exercise, and what happens to the breathing rate as well");
    const one = lay("Quick check", many);
    const two = lay(long, many);
    expect(one.foot).toBeGreaterThan(540);
    expect(two.size).toBe(one.size);
    expect(two.foot).toBe(one.foot);
  });
  // The heading stepping down when the band is full is the d52 T5 y6 s7 register proof
  // (packages/generation/src/register-proofs/g-layout.test.ts).
});
