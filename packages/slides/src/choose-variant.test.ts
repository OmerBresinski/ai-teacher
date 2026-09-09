import { describe, expect, it } from "bun:test";
import { richDocToPlainText, type SlideKind } from "@tj/domain/documents";
import { chooseVariant, wordCount } from "./choose-variant";
import { DEMO_LESSON_SPECS, demoLessonSlides } from "./demo-lesson";
import { compositionOf, LAYOUT_CATALOGUE, variantsFor } from "./layouts";
import { THEMES } from "./themes";

const KINDS = Object.keys(LAYOUT_CATALOGUE) as SlideKind[];
const LIST_KINDS: SlideKind[] = ["objectives", "starter", "instructions", "exit-ticket", "plenary"];
const short = "Water is never lost. It goes round and round.";
const long = Array.from({ length: 45 }, (_, i) => (i === 20 ? "vapour." : "word")).join(" ");

describe("chooseVariant", () => {
  it("counts words the way the rules do", () => {
    expect(wordCount(short)).toBe(9);
    expect(wordCount("  one   two ")).toBe(2);
    expect(wordCount("")).toBe(0);
  });

  it("keeps every kind with one composition on it", () => {
    for (const kind of KINDS) {
      if (variantsFor(kind).length > 1) continue;
      const only = variantsFor(kind)[0];
      if (!only) throw new Error(`${kind} offers no variant`);
      for (const previousVariant of [null, "headed", only]) {
        expect(chooseVariant(kind, { index: 5, total: 10, previousVariant }), kind).toBe(only);
      }
    }
  });

  it("always sets the exit ticket numbered, whatever came before", () => {
    for (const previousVariant of ["numbered", "cards", "stepped", null]) {
      for (const personality of ["calm", "bold", "playful", undefined] as const) {
        expect(
          chooseVariant("exit-ticket", {
            index: 9,
            total: 10,
            previousVariant,
            previousKind: "instructions",
            personality,
            hasImage: true,
          }),
        ).toBe("numbered");
      }
    }
  });

  it("sets a short content body as a statement, unless it is the first idea or follows the objectives", () => {
    const ctx = { index: 4, total: 10, textLength: wordCount(short) };
    expect(chooseVariant("content", { ...ctx, previousKind: "vocabulary" })).toBe("statement");
    expect(chooseVariant("content", { ...ctx, index: 2, previousKind: "objectives" })).toBe(
      "headed",
    );
    // The deck's first content slide, with a starter and the vocabulary between it and the
    // objectives, still keeps its heading.
    expect(
      chooseVariant("content", { ...ctx, previousKind: "vocabulary", firstContent: true }),
    ).toBe("headed");
    expect(
      chooseVariant("content", { ...ctx, previousKind: "vocabulary", firstContent: false }),
    ).toBe("statement");
  });

  it("splits a body over forty words into two columns and keeps the middle headed", () => {
    expect(chooseVariant("content", { index: 4, total: 10, textLength: wordCount(long) })).toBe(
      "two-column",
    );
    expect(chooseVariant("content", { index: 4, total: 10, textLength: 30 })).toBe("headed");
  });

  it("never gives two adjacent headed-list slides the same variant", () => {
    for (const first of LIST_KINDS) {
      for (const second of LIST_KINDS.filter((k) => k !== "exit-ticket")) {
        for (const personality of ["calm", "bold", "playful", undefined] as const) {
          const a = chooseVariant(first, { index: 1, total: 10, personality });
          const b = chooseVariant(second, {
            index: 2,
            total: 10,
            personality,
            previousVariant: a,
            previousKind: first,
          });
          expect(b, `${first}/${a} then ${second}`).not.toBe(a);
        }
      }
    }
  });

  it("treats a headed paragraph and a numbered list as one composition", () => {
    expect(compositionOf("content", "headed")).toBe(compositionOf("objectives", "numbered"));
    const after = chooseVariant("content", {
      index: 2,
      total: 10,
      textLength: 30,
      previousVariant: "numbered",
      previousKind: "objectives",
    });
    expect(after).toBe("two-column");
    // Without the previous kind the name is still found across the catalogue.
    expect(
      chooseVariant("content", {
        index: 2,
        total: 10,
        textLength: 30,
        previousVariant: "numbered",
      }),
    ).toBe("two-column");
  });

  it("gives a title a photograph only when it has one", () => {
    expect(chooseVariant("title", { index: 0, total: 10 })).toBe("stack");
    expect(chooseVariant("title", { index: 0, total: 10, hasImage: true, textLength: 3 })).toBe(
      "split",
    );
    expect(chooseVariant("title", { index: 0, total: 10, hasImage: true, textLength: 7 })).toBe(
      "photo-band",
    );
  });

  it("ranks lists by personality and keeps long lists off cards", () => {
    expect(chooseVariant("objectives", { index: 1, total: 10, personality: "playful" })).toBe(
      "cards",
    );
    expect(chooseVariant("objectives", { index: 1, total: 10, personality: "bold" })).toBe(
      "stepped",
    );
    expect(chooseVariant("objectives", { index: 1, total: 10, personality: "calm" })).toBe(
      "numbered",
    );
    expect(
      chooseVariant("objectives", { index: 1, total: 10, personality: "playful", textLength: 80 }),
    ).toBe("stepped");
  });

  it("is deterministic: the same context gives the same variant every time", () => {
    for (const kind of KINDS) {
      const ctx = { index: 3, total: 10, textLength: 15, previousVariant: "headed" as const };
      const first = chooseVariant(kind, ctx);
      for (let i = 0; i < 5; i++) expect(chooseVariant(kind, ctx), kind).toBe(first);
    }
  });

  it("falls back to an offered variant when the name is not one the kind has", () => {
    const offered: string[] = variantsFor("title");
    expect(offered).toContain(chooseVariant("title", { index: 0, total: 1 }));
    expect(compositionOf("title", "nonsense")).toBe("stack");
    expect(compositionOf("title", 99)).toBe("stack");
  });
});

describe("the demo lesson through chooseVariant", () => {
  for (const theme of THEMES) {
    it(`on ${theme.id}: at least eight compositions, no two adjacent alike, every slot filled`, () => {
      const { slides, variants } = demoLessonSlides(theme.id);
      expect(slides).toHaveLength(10);
      const compositions = slides.map((s, i) => compositionOf(s.kind, variants[i] ?? 0));
      expect(new Set(compositions).size).toBeGreaterThanOrEqual(8);
      for (let i = 1; i < compositions.length; i++) {
        expect(compositions[i], `slides ${i} and ${i + 1}`).not.toBe(compositions[i - 1]);
      }
      expect(variants[variants.length - 1]).toBe("numbered");
      // Every line of every spec is on its slide, and no placeholder survives.
      slides.forEach((slide, i) => {
        const text = slide.elements
          .map((el) => ("doc" in el && el.doc ? richDocToPlainText(el.doc) : ""))
          .join("\n");
        const spec = DEMO_LESSON_SPECS[i];
        if (!spec) throw new Error("missing spec");
        // Objectives are lower-cased to follow their stem (TEACH-198): compare case-folded.
        for (const line of specLines(spec))
          expect(text.toLowerCase(), `${spec.kind} ${i}`).toContain(line.toLowerCase());
        expect(text).not.toContain("Learning objective one");
        expect(text).not.toContain("Lesson title");
        expect(text).not.toContain("One idea in a sentence");
      });
    });
  }

  it("runs the same way twice", () => {
    const ids = () => "x";
    expect(demoLessonSlides("chalk", { ids })).toEqual(demoLessonSlides("chalk", { ids }));
  });

  it("shows the playful ranking and the photo title when asked", () => {
    const { variants } = demoLessonSlides("playground", {
      personality: "playful",
      titleImage: true,
    });
    expect(variants[0]).toBe("split");
    expect(variants[1]).toBe("cards");
    expect(variants[2]).toBe("stepped");
  });
});

function specLines(spec: (typeof DEMO_LESSON_SPECS)[number]): string[] {
  switch (spec.kind) {
    case "title":
      return [spec.title, spec.subtitle];
    case "objectives":
    case "starter":
    case "exit-ticket":
      return spec.items;
    case "vocabulary":
      return spec.entries.flatMap((e) => [e.term, e.definition]);
    case "content":
      // Every sentence of the body, so a two-column split that lost text would show.
      return [spec.heading, ...spec.body.split(/(?<=\.)\s+/)];
    case "image-text":
      return [spec.heading, spec.body];
    case "worked-example":
      return [spec.question, ...spec.steps];
    case "true-false":
      return [spec.statement];
    default:
      return [];
  }
}
