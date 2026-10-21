import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { SOURCE_NAMES } from "./source";

/*
 * TEACH-75 part ab, common acceptance row 5 (ruling 239), the half that does not need the mirror
 * pass: an Arabic prose source and a Hebrew verse source lay out on every theme with nothing over,
 * nothing off-canvas and no two notes overlapping. The mirror rows wait for the mirror pass
 * (TEACH-75 part z) and RTL row lookup for A7's measurer (`runRects` gives no rects for RTL text,
 * so an RTL anchor's note is dropped in code, never misplaced).
 */
const AR: TemplateInput = {
  template: "source",
  heading: "",
  form: "prose",
  from: "من كتاب كليلة ودمنة، ابن المقفع",
  extract:
    "زعموا أن غديرًا كان فيه ثلاث سمكات: كيسة وأكيس منها وعاجزة. وكان ذلك الغدير بنجوة من الأرض لا يكاد يقربه أحد.",
  notes: [
    { anchor: "ثلاث سمكات", label: "الشخصيات", text: "ثلاث سمكات مختلفة" },
    { anchor: "لا يكاد يقربه أحد", label: "المكان", text: "مكان بعيد وآمن" },
  ],
};
const HE: TemplateInput = {
  template: "source",
  heading: "",
  form: "verse",
  from: "מתוך שיר, רחל",
  extract: "אולי לא היו הדברים מעולם.\nאולי\nמעולם לא השכמתי עם שחר לגן",
  notes: [
    { anchor: "לא היו הדברים", label: "ספק", text: "האם זה קרה?" },
    { anchor: "עם שחר", label: "זמן", text: "בוקר מוקדם" },
  ],
};
const overlap = (a: SlideElement, b: SlideElement) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("right-to-left sources (Arabic, Hebrew)", () => {
  for (const [name, input] of [
    ["Arabic prose", AR],
    ["Hebrew verse", HE],
  ] as const)
    test(`${name}: fits on every theme, on the canvas, no notes overlap`, () => {
      for (const t of THEMES)
        for (const stage of ["ks1", "ks2", "ks3"] as Stage[]) {
          const r = layoutTemplate(input, t, stage);
          expect(r.over).toEqual([]);
          for (const e of r.slide.elements) {
            expect(e.x).toBeGreaterThanOrEqual(0);
            expect(e.y).toBeGreaterThanOrEqual(0);
            expect(e.x + e.w).toBeLessThanOrEqual(960);
            expect(e.y + e.h).toBeLessThanOrEqual(540);
          }
          const notes = r.slide.elements.filter(
            (e) => e.name === SOURCE_NAMES.label || e.name === SOURCE_NAMES.text,
          );
          for (const a of notes)
            for (const b of notes) if (a !== b) expect(overlap(a, b)).toBe(false);
        }
    });
});
