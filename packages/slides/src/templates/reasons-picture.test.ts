import { describe, expect, test } from "bun:test";
import type { ImageElement, SlideElement, TextElement } from "@tj/domain/documents";
import { footStrip } from "../background";
import * as ICONS from "../icons";
import { relayout } from "../relayout";
import { getTheme, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { REASON_NAMES, reasonsCapsFor, reasonsPaths } from "./reasons";
import PICTURE_CAPACITY from "./reasons-picture-capacity.json";

/*
 * TEACH-247 part ba (reasons layout B): the question panel takes one optional picture of the thing,
 * place or event the question asks about, full bleed at its foot. Content: the Great Fire spike.
 */
ICONS.provideIcons(ICONS);
const FIRE = {
  photo: "/files/fire.jpg",
  aspect: 1280 / 745,
  alt: "A painting of the Great Fire of London in 1666, seen from the river",
};
const REASONS = [
  { head: "Wooden houses", line: "Houses were made of wood and built very close together." },
  { head: "A hot, dry summer", line: "No rain for months left the wood dry, so it burned fast." },
  { head: "A strong east wind", line: "The wind blew sparks from roof to roof across the city." },
];
const QUESTION = "Why did the fire spread so quickly?";
const fire = (heading = QUESTION, figure: unknown = FIRE): TemplateInput =>
  ({ template: "reasons", heading, reasons: REASONS, figure }) as TemplateInput;
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const picOf = (els: SlideElement[]) => named(els, REASON_NAMES.picture)[0] as ImageElement;

describe("reasons with a question picture", () => {
  for (const [id, stage] of [
    ["crayon", "ks1"],
    ["treehouse", "ks2"],
  ] as const)
    test(`${id} ${stage}: a large picture at the panel's foot, above the foot strip`, () => {
      const t = getTheme(id, stage);
      const r = layoutTemplate(fire(), t, stage);
      expect(r.over).toEqual([]);
      const els = r.slide.elements;
      const pic = picOf(els);
      const panel = named(els, REASON_NAMES.panel)[0] as SlideElement;
      // Panel width, from the left edge; larger than the spike's 387 x 258 (KS1) / 360 x 240 (KS2).
      expect(pic.x).toBe(0);
      expect(pic.w).toBe(panel.w);
      expect(pic.w * pic.h).toBeGreaterThan(stage === "ks1" ? 387 * 258 * 1.2 : 360 * 240 * 1.2);
      // Its foot sits on the theme's foot strip, never under it.
      const strip = footStrip(t, r.slide);
      expect(pic.y + pic.h).toBe(strip ? strip.y : 540);
      expect(pic.fit).toBe("cover");
      expect(pic.crop).toBeDefined();
      // Shown from the first step: it is what the question is about.
      expect(pic.revealStep ?? 0).toBe(0);
      // The question sits wholly above it.
      const q = named(els, REASON_NAMES.question)[0] as SlideElement;
      expect(q.y + q.h).toBeLessThanOrEqual(pic.y);
      expect(q.y).toBeGreaterThan(0);
    });

  test("every theme and age keeps the picture for the Great Fire question", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
      for (const t0 of THEMES) {
        const r = layoutTemplate(fire(), getTheme(t0.id, stage), stage);
        expect(`${t0.id} ${stage} ${r.over.join()}`).toBe(`${t0.id} ${stage} `);
        expect(picOf(r.slide.elements)).toBeDefined();
      }
  });

  test("a longer question takes a shorter picture before its type steps down", () => {
    const t = getTheme("poster", "ks1");
    const short = picOf(layoutTemplate(fire(), t, "ks1").slide.elements);
    const long = picOf(
      layoutTemplate(fire("Why did the Great Fire of London spread so fast?"), t, "ks1").slide
        .elements,
    );
    expect(long.w).toBe(short.w);
    expect(long.h).toBeLessThan(short.h);
  });

  test("a question too long to sit beside it leaves the picture off, never the question", () => {
    const long =
      "Why did the Great Fire of London in 1666 burn for four whole days and destroy most of the city?";
    for (const [id, stage] of [
      ["crayon", "ks1"],
      ["treehouse", "ks2"],
    ] as const) {
      const r = layoutTemplate(fire(long), getTheme(id, stage), stage);
      expect(picOf(r.slide.elements)).toBeUndefined();
      expect(r.over).toContain("question.picture");
      expect(named(r.slide.elements, REASON_NAMES.question)).toHaveLength(1);
    }
  });

  test("a picture still to come holds its slot uncropped, with its request", () => {
    const r = layoutTemplate(
      fire(QUESTION, { photo: "/placeholder.svg", alt: "", request: "slot:picture" }),
      getTheme("crayon", "ks1"),
      "ks1",
    );
    const pic = picOf(r.slide.elements);
    expect(pic.src).toBe("/placeholder.svg");
    expect(pic.crop).toBeUndefined();
    expect((pic as ImageElement & { request?: string }).request).toBe("slot:picture");
  });

  test("a diagram is never drawn in the picture zone", () => {
    const r = layoutTemplate(fire(QUESTION, { diagram: {} }), getTheme("crayon", "ks1"), "ks1");
    expect(picOf(r.slide.elements)).toBeUndefined();
    expect(r.over).toEqual([]);
  });

  test("with a picture the fields read the picture cells", () => {
    const r = layoutTemplate(fire(), getTheme("crayon", "ks1"), "ks1");
    const heading = r.fields?.find((f) => f.field === "heading");
    expect(reasonsCapsFor("early", false, 3, true)).toEqual(
      PICTURE_CAPACITY.early["reasons-3"] as never,
    );
    expect(heading?.hardMax).toBeGreaterThanOrEqual(
      PICTURE_CAPACITY.early["reasons-3"].question.hardMax,
    );
  });

  test("the editor's reflow keeps the picture and binds only the words", () => {
    const t = getTheme("treehouse", "ks2");
    const ref = {
      template: "reasons",
      input: { heading: QUESTION, reasons: REASONS, figure: FIRE },
    };
    const out = relayout(ref as never, t, "ks2", "g");
    const pic = picOf(out.elements);
    expect(pic).toBeDefined();
    expect(out.paths[pic.id]).toBeUndefined();
    expect(Object.values(out.paths)).toContain("heading");
    expect(reasonsPaths(out.elements).filter(Boolean)).toHaveLength(1 + 2 * REASONS.length);
    // A teacher's longer question re-lays with the shorter picture (or none), never overlapping.
    const longer = relayout(
      {
        ...ref,
        input: { ...ref.input, heading: "Why did the Great Fire of London spread so fast?" },
      } as never,
      t,
      "ks2",
      "g",
    );
    const p2 = picOf(longer.elements);
    const q2 = named(longer.elements, REASON_NAMES.question)[0] as SlideElement;
    if (p2) expect(q2.y + q2.h).toBeLessThanOrEqual(p2.y);
  });
});

describe("reason heads keep their descenders", () => {
  test("a head's box has room below its last line, the words where they were", () => {
    for (const [id, stage] of [
      ["crayon", "ks1"],
      ["treehouse", "ks2"],
    ] as const) {
      const t = getTheme(id, stage);
      const r = layoutTemplate(
        { template: "reasons", heading: QUESTION, reasons: REASONS } as TemplateInput,
        t,
        stage,
      );
      for (const h of named(r.slide.elements, REASON_NAMES.head) as TextElement[]) {
        const pad = h.style.padding ?? 0;
        const size = h.style.fontSize as number;
        // Room for a descender: at least a quarter of the type size past the line box.
        expect(pad).toBeGreaterThanOrEqual(size * 0.25);
        // The content box ends where it did: the reason's line still sits 5 pt under it.
        const els = r.slide.elements;
        const line = els[els.indexOf(h) + 1] as TextElement;
        expect(line.name).toBe(REASON_NAMES.text);
        expect(Math.abs(line.y - (h.y + h.h - pad) - 5)).toBeLessThanOrEqual(1);
        const text = named(r.slide.elements, REASON_NAMES.text);
        expect(text.length).toBe(REASONS.length);
      }
    }
  });
});
