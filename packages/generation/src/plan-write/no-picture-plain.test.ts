import { describe, expect, test } from "bun:test";
import { materialiseSlide } from "@tj/slides";
import { renderWritten } from "./fit";
import { t3Fit } from "./simple";

/**
 * FIX1 (FULL-RUN y1 s4, s5): the writer chose a photo; every picture was refused, and the
 * no-picture fallback set the first line as a big "KEY IDEA" card beside two short bullets. A slide
 * standing in for a missing picture sets its words alone, in their own style.
 */
const out = {
  heading: "Dog and puppy",
  body: [
    "A young dog is a puppy.",
    "Both have ears, paws and a tail.",
    "The puppy grows into a bigger dog.",
  ],
  notes: "Say 'dog' and 'puppy' together.",
};
const meta = { promptVersion: "t", model: "code", at: "1970-01-01T00:00:00.000Z" };
const draw = (noPanel: boolean) => {
  const q = t3Fit("explain", "default", out);
  const r = renderWritten(q.form, q.layout, q.out);
  const structure = noPanel ? { ...r.structure, noPanel: true } : r.structure;
  return materialiseSlide(r.spec, "splash", meta, undefined, r.variant, structure);
};
const said = (s: ReturnType<typeof draw>) => JSON.stringify(s.elements);

describe("a picture slide whose picture never came", () => {
  test("keeps every line, with no key-idea card or side panel made up", () => {
    const plain = draw(true);
    expect(plain.elements.some((e) => e.name?.startsWith("Side panel"))).toBe(false);
    expect(said(plain)).not.toMatch(/KEY IDEA|Key idea/);
    for (const line of out.body)
      expect(said(plain)).toContain(line.replace(/'/g, "’").slice(0, 12));
  });
  test("the explain slide written as such still may take its key-idea panel", () => {
    expect(draw(false).elements.some((e) => e.name?.startsWith("Side panel"))).toBe(true);
  });
});
