import { describe, expect, it } from "bun:test";
import type { ImageElement, Slide, SlideElement, TextElement } from "@tj/domain/documents";
import { asFigureFull, figureFullCaptionLines } from "./figure-full";
import { SAFE } from "./grid";
import { boxH, PLACEHOLDER_IMAGE, text } from "./layouts";
import { countLines } from "./text-measure";
import { THEMES } from "./themes";

/** A picture slide as the photo form draws it: heading, kicker + body pairs, the empty zone. */
const pictureSlide = (pairs: [string, string][]): Slide => {
  const els: SlideElement[] = [
    text("heading", "How does Prospero secure obedience?", { x: 58, y: 43, w: 844, h: 45 }),
  ];
  pairs.forEach(([k, b], i) => {
    if (k) els.push(text("caption", k, { x: 459, y: 154 + 100 * i, w: 443, h: 23 }));
    els.push(text("body", b, { x: 459, y: 182 + 100 * i, w: 443, h: 34 }));
  });
  els.push({
    id: "img",
    type: "image",
    x: 58,
    y: 119,
    w: 363,
    h: 378,
    src: PLACEHOLDER_IMAGE,
  } as ImageElement);
  return { id: "s", kind: "content", elements: els } as unknown as Slide;
};
const plain = (e: TextElement) =>
  (e.doc?.content ?? [])
    .map((p) =>
      ((p as { content?: { text?: string }[] }).content ?? []).map((x) => x.text ?? "").join(""),
    )
    .join(" ");
const meets = (a: SlideElement, b: SlideElement) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const PROSPERO: [string, string][] = [
  ["Miranda", "paternal care becomes command."],
  ["Ariel", "freedom depends on further service."],
  ["Caliban", "threats enforce magical control."],
];
const SHORT: [string, string][] = [["", "Prospero rules by care, promise and threat."]];

describe("big diagram step-up: the caption fits its box and clears the drawing (LAYOUT-TEST Z y10 s3)", () => {
  for (const t of THEMES) {
    it(`${t.id}: heading, drawing and caption stay apart and inside the safe area`, () => {
      for (const pairs of [PROSPERO, SHORT]) {
        const big = asFigureFull(pictureSlide(pairs), t);
        const words = pairs.map(([k, b]) => (k ? `${k}: ${b}` : b)).join(" ");
        if (!big) {
          // Refused only when the words would run past the caption's lines.
          expect(
            figureFullCaptionLines(
              t,
              pairs.map(([k, b]) => (k ? `${k}: ${b}` : b)),
            ),
          ).toBeGreaterThan(4);
          continue;
        }
        const els = big.elements as SlideElement[];
        for (const e of els) {
          expect(e.x).toBeGreaterThanOrEqual(SAFE.x - 0.5);
          expect(e.y).toBeGreaterThanOrEqual(SAFE.y - 0.5);
          expect(e.x + e.w).toBeLessThanOrEqual(SAFE.x + SAFE.w + 0.5);
          expect(e.y + e.h).toBeLessThanOrEqual(SAFE.y + SAFE.h + 0.5);
        }
        for (const a of els) for (const b of els) if (a !== b) expect(meets(a, b)).toBe(false);
        const cap = els.find(
          (e): e is TextElement => e.type === "text" && e.style?.preset === "body",
        );
        expect(cap).toBeDefined();
        const c = cap as TextElement;
        expect(plain(c)).toBe(words);
        // The caption's words fit the box it was given: no overflow for a refit to move.
        const paras = (c.doc?.content ?? []).map((p) =>
          ((p as { content?: { text?: string }[] }).content ?? [])
            .map((x) => x.text ?? "")
            .join(""),
        );
        const lines = paras.reduce((n, p) => n + countLines(p, "body", t, c.w), 0);
        expect(boxH(t, "body", lines)).toBeLessThanOrEqual(c.h + 0.5);
      }
    });
  }

  it("keeps each kicker with its line", () => {
    const big = asFigureFull(
      pictureSlide(SHORT.concat([["Ariel", "serves."]])),
      THEMES[0] as never,
    );
    const cap = big?.elements.find(
      (e) => e.type === "text" && (e as TextElement).style?.preset === "body",
    );
    expect(plain(cap as TextElement)).toBe(
      "Prospero rules by care, promise and threat. Ariel: serves.",
    );
  });
});
