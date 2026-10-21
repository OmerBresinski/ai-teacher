import { describe, expect, test } from "bun:test";
import type { ShapeElement, SlideElement, TextElement } from "@tj/domain/documents";
import { coverDropsQuestion } from "../cover-comps";
import { coverStepped } from "../fit-check";
import { coverTypeAt, readingFloorOf } from "../layout-sizes";
import { resolveTextStyle, snapToScale } from "../text-style";
import { atKeyStage, getTheme, THEMES, typeScale } from "../themes";
import { COVER_GROUPS, type CoverGroup, coverCapacityBinds, coverCapInput } from "./cover-capacity";
import CAPACITY from "./cover-capacity.json" with { type: "json" };
import { hingeCapInput } from "./hinge-capacity";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { WORKED_CASES } from "./worked-fixtures";

/*
 * UX ruling 21 A (17 Oct 2026): the cover, the worked example and the hinge take the approved
 * golds' own type and box sizes, the same in every theme and set by age only. Sizes here are the
 * gold's px at 1440 wide x 2/3 (slide points).
 */
const px = (v: number) => (v * 2) / 3;
const sizeOf = (e: SlideElement) =>
  (e.type === "text" ? e.style : (e as ShapeElement).textStyle)?.fontSize as number;
/** The elements of that name; never none, so no loop over them passes empty. */
const named = (els: SlideElement[], name: string) => {
  const out = els.filter((e) => e.name === name);
  expect(out.length).toBeGreaterThan(0);
  return out;
};
const y8 = WORKED_CASES["y8-panel"]?.input as TemplateInput;
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

describe("fixed sizes are drawn as stored", () => {
  const t = atKeyStage(getTheme("paper"), "ks2");
  test("a fixed size between the stage's steps is not snapped", () => {
    close(
      resolveTextStyle({ preset: "body", fontSize: 26.67, fixedSize: true }, t).fontSize,
      26.67,
    );
    // Without the flag the same size snaps to a step (KS2 body 29 or bodySmall 25).
    expect([25, 29]).toContain(resolveTextStyle({ preset: "body", fontSize: 26.67 }, t).fontSize);
  });
  test("snapToScale leaves a fixed size alone", () => {
    const el = {
      type: "text",
      style: { preset: "body", fontSize: 26.67, fixedSize: true },
    } as unknown as TextElement;
    expect(snapToScale({ elements: [el] }, t).elements[0]).toBe(el);
  });
});

describe("cover: the gold's title and question, by age", () => {
  test("coverTypeAt: 82 px title (84 at KS1), 56 px floor, question at the gold's t-body", () => {
    close(coverTypeAt("ks2").title, px(82));
    close(coverTypeAt("ks3").title, px(82));
    close(coverTypeAt("ks1").title, px(84));
    for (const ks of ["ks1", "ks2", "ks3"] as const) {
      close(coverTypeAt(ks).titleFloor, px(56));
      // The gold's t-body (34 / 33 / 31 px), under ruling 162's floor: ruling 162 amended by
      // Greg 18 Oct (item 26 n): gold sizes on cover question and worked steps.
      close(coverTypeAt(ks).question, px({ ks1: 34, ks2: 33, ks3: 31 }[ks]));
    }
  });
  const input = {
    template: "title",
    heading: "How did the Vikings travel so far?",
    lead: "Why did their longships let them cross wide and stormy seas?",
  } as TemplateInput;
  for (const theme of THEMES)
    test(`${theme.id}: the title and question take the cover sizes, not the theme's`, () => {
      const r = layoutTemplate(input, theme, "ks2");
      const title = named(r.slide.elements, "Title")[0] as TextElement;
      const q = named(r.slide.elements, "Subtitle")[0] as TextElement;
      close(title.style.fontSize as number, px(82));
      expect(title.style.fixedSize).toBe(true);
      expect(title.style.lineHeight).toBe(1.04);
      close(q.style.fontSize as number, px(33));
      expect(q.style.fixedSize).toBe(true);
    });
});

describe("hinge: the gold's cards, ladders and keys", () => {
  const stages: [Stage, "early" | "primary" | "secondary"][] = [
    ["ks1", "early"],
    ["ks2", "primary"],
    ["ks3", "secondary"],
  ];
  const short: TemplateInput = {
    template: "hinge",
    heading: "Which is a mammal?",
    options: ["A whale", "A shark", "A trout", "An eel"],
    correct: 1,
  };
  test("KS2 grid: 170 px cards with the 50 px top of the ladder (the gold's y4 case)", () => {
    const r = layoutTemplate(short, getTheme("paper"), "ks2");
    const cards = named(r.slide.elements, "Option");
    expect(cards.map((c) => c.h)).toEqual([113, 113, 113, 113]);
    for (const e of named(r.slide.elements, "Option text")) close(sizeOf(e), px(50));
  });
  test("the letter is the key's size x 0.52 (hinge.html .key), not a stage step", () => {
    for (const [ks] of stages)
      for (const theme of THEMES) {
        const r = layoutTemplate(short, theme, ks);
        for (const k of named(r.slide.elements, "Hinge key") as ShapeElement[]) {
          close(sizeOf(k), k.w * 0.52);
          expect(k.textStyle?.fixedSize).toBe(true);
        }
      }
  });
  for (const [ks, age] of stages)
    test(`${ks}: option type never under the stage's reading floor, at most the gold's top`, () => {
      for (const words of [2, 5, 9])
        for (const theme of THEMES) {
          const floor = typeScale(atKeyStage(theme, ks))?.bodySmall as number;
          const r = layoutTemplate(hingeCapInput(age, words), theme, ks);
          for (const e of named(r.slide.elements, "Option text")) {
            expect(sizeOf(e)).toBeGreaterThanOrEqual(floor - 0.01);
            expect(sizeOf(e)).toBeLessThanOrEqual(
              px({ early: 56, primary: 50, secondary: 46 }[age]) + 0.01,
            );
          }
        }
    });
});

describe("worked: the gold's equations and moves", () => {
  test("KS3 beside the panel: equations 70 px x 0.92, moves from 36 px (the gold's y8 model)", () => {
    const r = layoutTemplate(y8, getTheme("paper"), "ks3");
    for (const e of named(r.slide.elements, "Eq left")) close(sizeOf(e), px(70 * 0.92));
    // Moves start at 36 px and step 1 px only while one would take a third line in the theme's
    // face (Paper's is wider than the gold's Lexend), never under the gold's 28 px (item 26 n).
    for (const e of named(r.slide.elements, "Move")) {
      expect(sizeOf(e)).toBeLessThanOrEqual(px(36) + 0.01);
      expect(sizeOf(e)).toBeGreaterThanOrEqual(px(28) - 0.01);
    }
    const hall = layoutTemplate(y8, getTheme("exam-hall"), "ks3");
    for (const e of named(hall.slide.elements, "Move")) close(sizeOf(e), px(36));
  });
  test("KS2 without a panel: equations 54 px, moves at the gold's 34 px (item 26 n)", () => {
    const input = { ...y8, barPanel: undefined };
    const r = layoutTemplate(input, getTheme("paper"), "ks2");
    for (const e of named(r.slide.elements, "Eq left")) close(sizeOf(e), px(54));
    for (const e of named(r.slide.elements, "Move")) close(sizeOf(e), px(34));
  });
});

describe("the cover's caps: the gold's three title lines, two question lines", () => {
  // Every theme, stage and word mix at each cap and two characters past it: the generator's own
  // stopping rule at its answer. The full 2-character walk runs in `caps:check`.
  test("renderer = table (cover-capacity.json)", () => {
    expect(coverCapacityBinds(CAPACITY)).toEqual([]);
  }, 60_000);
  // The box less its ink margin (a padded title, TEACH-152 part b), in lines of its size.
  const lines = (t: TextElement) => {
    const pad = typeof t.style.padding === "number" ? t.style.padding : 0;
    return Math.round(
      (t.h - 2 * pad) / ((t.style.fontSize as number) * (t.style.lineHeight as number)),
    );
  };
  for (const group of Object.keys(COVER_GROUPS) as CoverGroup[])
    for (const picture of [true, false])
      test(`${group} ${picture ? "with" : "without"} a picture: at the caps, 3 and 2 lines`, () => {
        const cap = CAPACITY[group][picture ? "picture" : "none"];
        for (const stage of COVER_GROUPS[group])
          for (const theme of THEMES) {
            const at = layoutTemplate(
              coverCapInput(cap.title, cap.question, picture),
              theme,
              stage,
            );
            expect(at.over).toEqual([]);
            const [title] = named(at.slide.elements, "Title") as TextElement[];
            const question = at.slide.elements.find((e) => e.name === "Subtitle") as TextElement;
            expect(lines(title as TextElement)).toBeLessThanOrEqual(3);
            // Greg's call 36 (TEACH-215 part g): photo-right and Beacon picture covers draw none.
            if (picture && coverDropsQuestion(atKeyStage(theme, stage)))
              expect(question).toBeUndefined();
            else expect(lines(question as TextElement)).toBeLessThanOrEqual(2);
          }
      });
  test("a title past three lines at the floor is over (the old six with a picture are not allowed)", () => {
    const long = coverCapInput(CAPACITY.KS2.picture.title * 3, 16, true);
    expect(layoutTemplate(long, getTheme("paper"), "ks2").over).not.toEqual([]);
  });
});

describe("one reading floor", () => {
  test("readingFloorOf is the type scale's bodySmall (what hinge and worked read as c.s.small)", () => {
    for (const ks of ["ks1", "ks2", "ks3", "ks4", "ks5"] as const)
      expect(readingFloorOf(ks)).toBe(
        typeScale(atKeyStage(getTheme("paper"), ks))?.bodySmall ?? -1,
      );
  });
});

describe("a stepped fixed cover title is reported, not lost", () => {
  test("coverStepped names a title under the gold's size", () => {
    const theme = atKeyStage(getTheme("paper"), "ks2");
    const at = layoutTemplate(coverCapInput(3, 6, false), theme, "ks2");
    expect(coverStepped({ elements: at.slide.elements } as never, theme)).toEqual([]);
    const small = at.slide.elements.map((e) =>
      e.name === "Title" && e.type === "text"
        ? { ...e, style: { ...e.style, fontSize: px(56) } }
        : e,
    );
    expect(coverStepped({ elements: small } as never, theme)).toEqual(["Title 82→56px"]);
  });
});
