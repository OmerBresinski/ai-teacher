import { describe, expect, test } from "bun:test";
import { captionAddsInformation } from "../diagrams";
import { getTheme } from "../themes";
import { layoutTemplate, type TemplateInput } from "./index";

/*
 * TEACH-247 part bj (v4.18 test, Y8 photosynthesis s4): a three-step flow across the slide drew as
 * an L (the zoom search took the largest zoom that drew cleanly, a zone so narrow the chain bent
 * into a two-row snake), and the caption under it repeated its boxes word for word
 * ("Carbon dioxide + water → glucose + oxygen" under "Carbon dioxide + water", "Photosynthesis",
 * "Glucose + oxygen").
 */

const spec = {
  alt: "Carbon dioxide and water enter photosynthesis; glucose and oxygen are produced.",
  kind: "flow",
  steps: [
    { label: "Carbon dioxide + water" },
    { label: "Photosynthesis" },
    { label: "Glucose + oxygen" },
  ],
  layout: "chain",
};
const input = (lead: string): TemplateInput =>
  ({
    template: "big-diagram",
    heading: "Making glucose",
    lead,
    points: [
      "Light provides energy for this reaction in green plants.",
      "Chlorophyll is a green substance that absorbs light.",
    ],
    figure: { diagram: spec },
  }) as unknown as TemplateInput;

type El = { name?: string; src?: string; doc?: unknown };
const lay = (lead: string) =>
  layoutTemplate(input(lead), getTheme("studio"), "ks3").slide.elements as El[];

describe("a caption that repeats its flow (TEACH-247 bj)", () => {
  test("a three-step flow draws as one row, not an L", () => {
    const d = lay("Carbon dioxide + water → glucose + oxygen").find((e) => e.name === "Diagram");
    const svg = decodeURIComponent((d?.src ?? "").slice((d?.src ?? "").indexOf(",") + 1));
    const tops = new Set([...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)"/g)].map((m) => m[1]));
    expect(tops.size).toBe(1);
  });

  test("a caption that only repeats the boxes is not drawn", () => {
    const els = lay("Carbon dioxide + water → glucose + oxygen");
    expect(els.some((e) => e.name === "Diagram")).toBe(true);
    expect(els.some((e) => e.name === "Caption")).toBe(false);
    // The points still stand as key cards.
    expect(JSON.stringify(els)).toContain("Chlorophyll is a green substance");
  });

  test("a caption that adds a word the boxes lack stays", () => {
    const els = lay("Light energy turns carbon dioxide and water into glucose and oxygen.");
    expect(els.some((e) => e.name === "Caption")).toBe(true);
  });

  test("captionAddsInformation reads the drawing's labels", () => {
    expect(captionAddsInformation(spec, "Carbon dioxide + water → glucose + oxygen")).toBe(false);
    expect(captionAddsInformation(spec, "Plants need light to make glucose")).toBe(true);
    expect(captionAddsInformation(undefined, "Anything")).toBe(true);
  });
});
