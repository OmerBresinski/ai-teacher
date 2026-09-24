import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import {
  CALLOUT_NAMES,
  ceilingOf,
  isCalloutElement,
  materialiseSlide,
  type SlideSpec,
  SPEC_LIMITS,
  THEMES,
} from "@tj/slides";
import { lintSlide } from "./lint";
import { reflowSlide } from "./reflow";
import { rulerFor } from "./test-ruler";

/*
 * The callout through the fit engine (TEACH-75, UX ruling 84): the card's text box has to hold
 * what the schema allows, and the card must never end up on the body. Run over every theme with
 * the fake ruler, as `demo-lint.test.ts` does; the browser measurement is the screenshot spec's.
 *
 * What is asserted is overflow and overlap, the two defects. A step down is the engine doing its
 * job: a twenty-word body over a three-line card on Playground's 31pt body is more than the safe
 * height holds at full size, with or without a card, and the engine takes the body one stop down
 * as it does today for a forty-word body.
 */

const meta = { promptVersion: "test", model: "test", at: "2026-09-23T09:00:00.000Z" };
const chars = (n: number) => {
  let s = "";
  while (s.length < n) s += "the sun warms the puddle ";
  return s.slice(0, n).trim();
};
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => ["water", "vapour", "cloud", "rises"][i % 4]).join(" ");
const ceiling = chars(ceilingOf(SPEC_LIMITS.callout));

/** Reflow, then lint the reflowed slide: what the editor's badge would show. */
function fit(spec: SlideSpec, themeId: string, variant?: string) {
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) throw new Error(themeId);
  const ruler = rulerFor(theme);
  const slide = materialiseSlide(spec, themeId, meta, undefined, variant ?? 0);
  const out = reflowSlide(slide, theme, ruler);
  const reflowed: Slide = { ...slide, elements: out.elements };
  const lint = lintSlide(reflowed, ruler, theme);
  const name = (id: string) => slide.elements.find((el) => el.id === id)?.name ?? id;
  return {
    // The image-text picture is full-bleed and the engine counts it past the safe edge (a
    // pre-existing report on every image-text slide, callout or not); the lint exempts bleeds.
    overflow: out.overflow.map(name).filter((n) => n !== "Image"),
    lintOverflow: lint.overflow.map(name),
    overlaps: lint.overlaps.map(([a, b]) => `${name(a)} × ${name(b)}`),
    stepped: out.stepped.map(name),
    slide,
  };
}

describe("a callout on a content slide", () => {
  for (const theme of THEMES) {
    for (const variant of ["headed", "two-column"] as const) {
      const body = variant === "headed" ? words(20) : `${words(12)}. ${words(13)}`;
      test(`${theme.id}/${variant}: the ceiling and a long body fit with no overflow and no overlap`, () => {
        const out = fit(
          {
            kind: "content",
            factRefs: [],
            heading: "The sun powers the cycle",
            body,
            callout: { kind: "watch-out", text: ceiling },
          },
          theme.id,
          variant,
        );
        expect(out.overflow).toEqual([]);
        expect(out.lintOverflow).toEqual([]);
        expect(out.overlaps).toEqual([]);
      });

      test(`${theme.id}/${variant}: a hundred characters and a fifteen-word body fit at full size`, () => {
        const out = fit(
          {
            kind: "content",
            factRefs: [],
            heading: "The sun powers the cycle",
            body: variant === "headed" ? words(15) : `${words(7)}. ${words(8)}`,
            callout: { kind: "example", text: chars(100) },
          },
          theme.id,
          variant,
        );
        expect(out.overflow).toEqual([]);
        expect(out.lintOverflow).toEqual([]);
        expect(out.overlaps).toEqual([]);
        expect(out.stepped).toEqual([]);
      });
    }
  }
});

describe("a callout in the image-text column", () => {
  for (const theme of THEMES) {
    test(`${theme.id}: seventy-eight characters and a short body fit with no overflow and no overlap`, () => {
      const out = fit(
        {
          kind: "image-text",
          factRefs: [],
          heading: "Clouds over the sea",
          body: words(8),
          callout: { kind: "key-words", text: chars(78) },
        },
        theme.id,
      );
      expect(out.overflow).toEqual([]);
      expect(out.lintOverflow).toEqual([]);
      expect(out.overlaps).toEqual([]);
    });

    test(`${theme.id}: the ceiling runs past the column card and is reported, not hidden`, () => {
      // The column has three lines to give (`CALLOUT_LINES.column`); the badge names the text.
      const out = fit(
        {
          kind: "image-text",
          factRefs: [],
          heading: "Clouds over the sea",
          body: words(8),
          callout: { kind: "key-words", text: ceiling },
        },
        theme.id,
      );
      expect(out.overflow).toContain(CALLOUT_NAMES.text);
      expect(out.slide.elements.filter(isCalloutElement)).toHaveLength(4);
    });
  }
});
