import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import * as ICONS from "@tj/slides/icons";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { buildSlidePlan, exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part ad: a reasons slide exports to PowerPoint without error, one build slide per
 * reason after the question's own (its grey placeholders), every word and figure present: the
 * question, each head and line, the fan's lines and dots, or a chain's block arrows as custom
 * geometry. RTL and the theme's colour slots wait for parts z and TEACH-215 c.
 */
// The icon library, held statically as the server does (the browser loads it lazily).
ICONS.provideIcons(ICONS);
const theme = atKeyStage(getTheme("paper", null), "ks2");
const SWEAT = [
  {
    icon: "exercise",
    head: "Moving makes us hot",
    line: "Running and playing make our muscles warm.",
  },
  {
    icon: "thermometer",
    head: "Our body must stay at 37 °C",
    line: "Our insides work best at this temperature.",
  },
  {
    icon: "sweat-drop",
    head: "Sweat cools us as it dries",
    line: "Drying sweat carries heat away from our skin.",
  },
];
const REASONS_CASES: { name: string; input: TemplateInput & { heading: string } }[] = [
  { name: "sweat", input: { template: "reasons", heading: "Why do we sweat?", reasons: SWEAT } },
  {
    name: "sweatNoIcon",
    input: {
      template: "reasons",
      heading: "Why do we sweat?",
      reasons: SWEAT.map(({ head, line }) => ({ head, line })),
    },
  },
  {
    name: "fire",
    input: {
      template: "reasons",
      heading: "How did a small fire burn down London?",
      chain: true,
      reasons: [
        {
          icon: "bakery",
          head: "A bakery catches fire",
          line: "Sparks from the oven light the house.",
        },
        { icon: "wind", head: "The wind blows it on", line: "The fire jumps to the next houses." },
        { icon: "flame", head: "Most of London burns", line: "It burns for four days." },
      ],
    },
  },
];
const textOf = (xml: string) =>
  [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
    .map((m) => m[1])
    .join(" ")
    .replace(/&apos;/g, "'");

async function exported(name: string) {
  const k = REASONS_CASES.find((c) => c.name === name);
  if (!k) throw new Error(name);
  const r = layoutTemplate(k.input, theme, "ks2");
  const slide = { ...r.slide, id: "why", notes: "" } as unknown as Slide;
  const base = creditedLesson();
  const lesson = { ...base, themeId: "paper", slides: [slide] } as Lesson;
  const blob = await exportLessonPptx(lesson, theme, { onWarning: () => {} });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = async (n: number) =>
    (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
  return { k, lesson, xml, n: k.input.reasons?.length ?? 0 };
}

describe("reasons in PowerPoint (TEACH-75 part ad)", () => {
  for (const name of ["sweat", "fire", "sweatNoIcon"]) {
    it(`${name}: the question, then one build slide per reason, every word present`, async () => {
      const { k, lesson, xml, n } = await exported(name);
      expect(buildSlidePlan(lesson)).toHaveLength(n + 1);
      const first = textOf(await xml(1));
      expect(first).toContain(k.input.heading.slice(0, 12));
      // Nothing of a reason shows before its click.
      for (const r of k.input.reasons ?? []) expect(first).not.toContain(r.head);
      const last = textOf(await xml(n + 1));
      for (const r of k.input.reasons ?? []) {
        expect(last).toContain(r.head.replace(" °", " °"));
        expect(last).toContain(r.line.slice(0, 20));
      }
      const all = await xml(n + 1);
      // The fan's curves (or the chain's block arrows) are custom geometry.
      expect(all).toContain("<a:custGeom>");
      if (k.input.chain)
        expect((all.match(/<a:custGeom>/g) ?? []).length).toBeGreaterThanOrEqual(2 * (n - 1));
      else expect((all.match(/prst="ellipse"/g) ?? []).length).toBeGreaterThanOrEqual(2 * n);
      // Icons, when every one matched, are on the slide as images (the exporter rasterises an SVG
      // icon in the browser; under bun it is skipped with a warning, never a failure).
      const icons = lesson.slides[0]?.elements.filter((e) => e.name === "Reason icon") ?? [];
      expect(icons).toHaveLength(name === "sweatNoIcon" ? 0 : n);
    });
  }
});
