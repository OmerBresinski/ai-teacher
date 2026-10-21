import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { WA_NAMES } from "./practice";

/*
 * TEACH-230 part b, common acceptance row 5 (ruling 239), the half that does not need the mirror
 * pass: Arabic and Hebrew tasks lay out on every theme with nothing over, nothing off-canvas and no
 * two tasks overlapping. The mirror rows (mirror twice = original, directional marks flipped) wait
 * for the mirror pass (TEACH-75 part z), which is not on master yet.
 */
const AR: TemplateInput = {
  template: "practice",
  heading: "دورة الماء",
  questions: [
    "ما الذي يحدث للماء عندما يسخن؟",
    "سمِّ مرحلتين من دورة الماء.",
    "لماذا تجف البرك في الأيام الحارة؟",
    "اشرح كيف يعود الماء إلى البحر.",
  ],
};
const HE: TemplateInput = {
  template: "exit-ticket",
  heading: "לפני שיוצאים",
  questions: ["מה צריך צמח כדי לגדול?", "איפה הצמח סופג מים?", "כתבו משפט אחד על השורשים."],
};
const overlap = (a: SlideElement, b: SlideElement) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("right-to-left tasks (Arabic, Hebrew)", () => {
  for (const [name, input] of [
    ["Arabic practice", AR],
    ["Hebrew exit ticket", HE],
  ] as const)
    test(`${name}: fits on every theme, on the canvas, no tasks overlap`, () => {
      for (const t of THEMES)
        for (const stage of ["ks1", "ks2", "ks3"] as Stage[]) {
          const r = layoutTemplate(input, t, stage);
          expect(r.over).toEqual([]);
          const tasks = r.slide.elements.filter((e) => e.name === WA_NAMES.task);
          expect(tasks).toHaveLength(input.questions?.length ?? 0);
          for (const e of tasks) {
            expect(e.x).toBeGreaterThanOrEqual(0);
            expect(e.x + e.w).toBeLessThanOrEqual(960);
            expect(e.y + e.h).toBeLessThanOrEqual(540);
          }
          for (const [i, a] of tasks.entries())
            for (const b of tasks.slice(i + 1)) expect(overlap(a, b)).toBe(false);
        }
    });
});
