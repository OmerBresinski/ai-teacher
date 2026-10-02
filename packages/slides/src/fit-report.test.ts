import { describe, expect, test } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { estimatePagesOnOpen, fitReport } from "./fit-report";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { FIT_VERSION, THEMES } from "./themes";

const META = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };
let n = 0;
const make = (spec: SlideSpec): Slide => materialiseSlide(spec, "chalk", META, () => `e${++n}`);

const content = (heading: string, body: string): SlideSpec => ({
  kind: "content",
  factRefs: ["k1"],
  heading,
  body,
});

const long = Array.from(
  { length: 14 },
  () => "Water moves up the stem to the leaves, where the plant uses it to make food.",
).join(" ");

function lesson(slides: Slide[], extra: Partial<Lesson> = {}): Lesson {
  return {
    version: 1,
    id: "l1",
    title: "Plants",
    themeId: "chalk",
    slides,
    createdAt: META.at,
    updatedAt: META.at,
    fitVersion: 0,
    ...extra,
  } as Lesson;
}

describe("fitReport", () => {
  test("counts slides asked for, delivered (continuations excluded) and stored", () => {
    const report = fitReport(
      lesson(
        [
          make(content("Roots", "Roots take in water.")),
          make(content("Roots (continued)", "They hold the plant in the soil.")),
          make(content("Leaves", "Leaves make food.")),
        ],
        { brief: { slideCount: 3 } } as unknown as Partial<Lesson>,
      ),
    );
    expect(report.slides).toEqual({ requested: 3, delivered: 2, stored: 3 });
    expect(Object.keys(report.overflowing)).toEqual(THEMES.map((t) => t.id));
    expect(report.overflowing.chalk).toBe(0);
    expect(report.clashing.chalk).toBe(0);
    expect(report.pagesOnOpen).toBe(0);
  });

  test("callouts: planned on teaching entries of the outline, placed on teaching slides", () => {
    const report = fitReport(
      lesson([make(content("Roots", "Roots take in water."))], {
        facts: {
          outline: [
            { kind: "content", callout: { kind: "misconception", ref: "m1" } },
            { kind: "true-false", callout: { kind: "misconception", ref: "m1" } },
          ],
        },
      } as unknown as Partial<Lesson>),
    );
    expect(report.callouts).toEqual({ planned: 1, placed: 0 });
  });

  test("a slide past the safe area counts on every theme and adds a page on a stale open", () => {
    const over = make(content("Too much", long));
    const report = fitReport(lesson([over]));
    expect(Object.values(report.overflowing).every((count) => count === 1)).toBe(true);
    const edited = {
      ...over,
      elements: over.elements.map((e, i) =>
        i === 0 ? { ...e, authoredBy: "teacher" as const } : e,
      ),
    };
    expect(estimatePagesOnOpen(lesson([edited]))).toBeGreaterThanOrEqual(1);
    // Stamped current, the first open reads one number and adds nothing.
    expect(estimatePagesOnOpen(lesson([edited], { fitVersion: FIT_VERSION }))).toBe(0);
  });

  test("the scorer's own count of pages can be injected", () => {
    const report = fitReport(lesson([make(content("Roots", "Roots take in water."))]), {
      pagesOnOpen: () => 4,
    });
    expect(report.pagesOnOpen).toBe(4);
  });
});
