import { describe, expect, it } from "bun:test";
import {
  type RichDoc,
  type RichNode,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type SlideKind,
  slideStepCount,
} from "@tj/domain/documents";
import { SAFE, TRIM } from "./grid";
import {
  compositionOf,
  derange,
  LAYOUT_CATALOGUE,
  layoutSlide,
  SLIDE_KIND_DESCRIPTIONS,
  SLIDE_KIND_LABELS,
  SLIDE_KIND_ORDER,
  variantName,
  variantsFor,
} from "./layouts";
import { fontFloor, THEMES } from "./themes";

/*
 * TeachDeck `lib/model/__tests__/layouts.test.ts` restated (TEACH-102 row 15). A local plain-text
 * walker keeps this file free of the Tiptap runtime.
 */

function docToPlainText(doc: RichDoc | RichNode): string {
  const out: string[] = [];
  const walk = (n: RichNode) => {
    if (n.text) out.push(n.text);
    n.content?.forEach(walk);
    if (n.type === "paragraph" || n.type === "listItem") out.push("\n");
  };
  walk(doc as RichNode);
  return out.join("");
}

const KINDS = Object.keys(SLIDE_KIND_LABELS) as SlideKind[];

const flatten = (els: SlideElement[]): SlideElement[] =>
  els.flatMap((el) => (el.type === "group" ? [el, ...flatten(el.children)] : [el]));

describe("layoutSlide", () => {
  it("describes every SlideKind for the picker", () => {
    expect(new Set(Object.keys(SLIDE_KIND_DESCRIPTIONS))).toEqual(new Set(KINDS));
    for (const kind of KINDS) expect(SLIDE_KIND_DESCRIPTIONS[kind].length, kind).toBeGreaterThan(0);
  });

  it("covers every SlideKind with a label and a picker position", () => {
    expect(new Set(SLIDE_KIND_ORDER)).toEqual(new Set(KINDS));
    expect(SLIDE_KIND_ORDER).toHaveLength(KINDS.length);
  });

  for (const theme of THEMES) {
    for (const kind of KINDS) {
      it(`${kind} on ${theme.id}: elements sit inside the slide`, () => {
        const { elements } = layoutSlide(kind, theme.id);
        if (kind === "blank") {
          expect(elements).toHaveLength(0);
          return;
        }
        expect(elements.length).toBeGreaterThan(0);
        for (const el of elements) {
          expect(el.w, `${kind}/${el.type} width`).toBeGreaterThan(0);
          expect(el.h, `${kind}/${el.type} height`).toBeGreaterThan(0);
          expect(el.x, `${kind}/${el.type} left`).toBeGreaterThanOrEqual(0);
          expect(el.y, `${kind}/${el.type} top`).toBeGreaterThanOrEqual(0);
          expect(el.x + el.w, `${kind}/${el.type} right`).toBeLessThanOrEqual(SLIDE_W);
          expect(el.y + el.h, `${kind}/${el.type} bottom`).toBeLessThanOrEqual(SLIDE_H);
        }
      });
    }
  }

  it("gives every element a unique id", () => {
    for (const kind of KINDS) {
      const ids = flatten(layoutSlide(kind, "chalk").elements).map((e) => e.id);
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
  });

  it("points question data at elements that exist on the slide", () => {
    for (const kind of KINDS) {
      const { elements, question } = layoutSlide(kind, "chalk");
      if (!question) continue;
      const ids = new Set(elements.map((e) => e.id));
      if (question.type === "multiple-choice") {
        expect(question.options.length).toBe(4);
        expect(question.options.filter((o) => o.correct)).toHaveLength(1);
        for (const o of question.options) expect(ids.has(o.id), `${kind} option`).toBe(true);
      }
      if (question.type === "matching") {
        expect(question.pairs.length).toBe(3);
        for (const p of question.pairs) {
          expect(ids.has(p.leftElementId), `${kind} left`).toBe(true);
          expect(ids.has(p.rightElementId), `${kind} right`).toBe(true);
        }
      }
      if (question.type === "sort") {
        expect(question.order.length).toBe(4);
        for (const id of question.order) expect(ids.has(id), `${kind} order`).toBe(true);
      }
      if (question.type === "fill-gap") {
        const gapText = elements.find((e) => e.type === "gap-text");
        expect(gapText).toBeDefined();
        const text = gapText && gapText.type === "gap-text" ? docToPlainText(gapText.doc) : "";
        expect(question.gaps.length).toBe(2);
        for (const gap of question.gaps) {
          expect(text).toContain(`[[gap:${gap.id}]]`);
          expect(gap.answer.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("creates the option elements each question kind promises", () => {
    const tf = layoutSlide("true-false", "chalk");
    const options = tf.elements.filter((e) => e.type === "option");
    expect(options.map((o) => (o.type === "option" ? o.label : null))).toEqual(["True", "False"]);
    expect(tf.question).toEqual({ type: "true-false", correct: true });

    const mcq = layoutSlide("multiple-choice", "chalk");
    const labels = mcq.elements
      .filter((e) => e.type === "option")
      .map((o) => (o.type === "option" ? o.label : null));
    expect(labels).toEqual(["A", "B", "C", "D"]);
  });

  for (const theme of THEMES) {
    it(`image-match on ${theme.id}: pictures and words stay inside the safe area`, () => {
      const { elements } = layoutSlide("image-match", theme.id);
      const boxes = elements.filter((e) => e.type === "image" || e.type === "text");
      for (const el of boxes) {
        expect(el.x, `${el.type} left`).toBeGreaterThanOrEqual(SAFE.x);
        expect(el.y, `${el.type} top`).toBeGreaterThanOrEqual(SAFE.y);
        expect(el.x + el.w, `${el.type} right`).toBeLessThanOrEqual(SAFE.x + SAFE.w);
        expect(el.y + el.h, `${el.type} bottom`).toBeLessThanOrEqual(SAFE.y + SAFE.h);
      }
    });
  }

  it("shuffles the image-match words so none starts under its own picture", () => {
    const { elements, question } = layoutSlide("image-match", "chalk");
    if (question?.type !== "image-match") throw new Error("expected an image-match question");
    const images = elements.filter((e) => e.type === "image");
    const words = elements.filter((e) => e.type === "text").slice(1);
    expect(images).toHaveLength(3);
    expect(words).toHaveLength(3);
    expect(question.pairs).toHaveLength(3);

    const ids = new Set(elements.map((e) => e.id));
    for (const pair of question.pairs) {
      expect(ids.has(pair.imageId)).toBe(true);
      expect(ids.has(pair.labelId)).toBe(true);
    }
    expect(new Set(question.pairs.map((p) => p.imageId)).size).toBe(3);
    expect(new Set(question.pairs.map((p) => p.labelId)).size).toBe(3);
    for (const pair of question.pairs) {
      const image = images.find((i) => i.id === pair.imageId);
      const word = words.find((w) => w.id === pair.labelId);
      expect(word?.x, "the right word starts under a different picture").not.toBe(image?.x);
    }
  });

  it("gives open-response a question so its model answer is reachable", () => {
    expect(layoutSlide("open-response", "chalk").question).toEqual({ type: "open-response" });
  });

  it("spends no reveal step on an open response until it has a model answer", () => {
    const slide: Slide = {
      id: "s1",
      kind: "open-response",
      ...layoutSlide("open-response", "chalk"),
    };
    expect(slideStepCount(slide), "a blank model answer reveals nothing").toBe(0);
    const written: Slide = {
      ...slide,
      question: { type: "open-response", modelAnswer: "Water vapour cools." },
    };
    expect(slideStepCount(written)).toBe(1);
    expect(
      slideStepCount({ ...slide, question: { type: "open-response", modelAnswer: "   " } }),
    ).toBe(0);
  });

  it("deranges: no index keeps its own slot", () => {
    for (const n of [2, 3, 4]) {
      const order = derange(n);
      expect(order, `n=${n}`).toHaveLength(n);
      expect(new Set(order).size, `n=${n} is a permutation`).toBe(n);
      for (const [from, to] of order.entries()) expect(to, `n=${n}, index ${from}`).not.toBe(from);
    }
  });

  it("writes teacher-voice placeholder copy, never lorem ipsum or emoji", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const kind of KINDS) {
      for (const el of flatten(layoutSlide(kind, "chalk").elements)) {
        const doc = "doc" in el ? el.doc : undefined;
        if (!doc) continue;
        const text = docToPlainText(doc);
        expect(text.toLowerCase(), kind).not.toContain("lorem");
        expect(emoji.test(text), `${kind}: ${text}`).toBe(false);
      }
    }
  });

  /* ---- TEACH-214: the layout catalogue ------------------------------ */

  it("offers every kind a default variant first, and lists variants by name", () => {
    for (const kind of KINDS) {
      const names = variantsFor(kind);
      expect(names.length, kind).toBeGreaterThan(0);
      expect(new Set(names).size, `${kind} names are unique`).toBe(names.length);
      expect(variantName(kind), kind).toBe(names[0] ?? "");
      expect(variantName(kind, 99), `${kind} index past the list`).toBe(names[0] ?? "");
      expect(variantName(kind, "photo-band-x"), `${kind} unknown name`).toBe(names[0] ?? "");
      for (const v of LAYOUT_CATALOGUE[kind]) expect(v.description.length).toBeGreaterThan(0);
    }
    expect(variantsFor("title")).toEqual(["stack", "photo-band", "split"]);
    expect(variantsFor("content")).toEqual(["headed", "statement", "two-column"]);
    for (const kind of ["objectives", "starter", "instructions", "exit-ticket", "plenary"] as const)
      expect(variantsFor(kind), kind).toEqual(["numbered", "cards", "stepped"]);
    expect(compositionOf("content", "headed")).toBe(compositionOf("starter", "numbered"));
  });

  const stripIds = (els: SlideElement[]) =>
    JSON.parse(
      JSON.stringify(els)
        .replace(/"id":"[^"]+"/g, '"id":"_"')
        .replace(/\[\[gap:[^\]]+\]\]/g, "[[gap:_]]"),
    );

  it("lays out the default composition when the variant is left out, by index or by name", () => {
    for (const kind of KINDS) {
      const plain = stripIds(layoutSlide(kind, "chalk").elements);
      expect(stripIds(layoutSlide(kind, "chalk", 0).elements), kind).toEqual(plain);
      expect(stripIds(layoutSlide(kind, "chalk", variantsFor(kind)[0]).elements), kind).toEqual(
        plain,
      );
    }
  });

  for (const theme of THEMES) {
    for (const kind of KINDS) {
      for (const [index, variant] of variantsFor(kind).entries()) {
        if (index === 0) continue;
        it(`${kind}/${variant} on ${theme.id}: text inside the safe area, shapes inside the trim, floors held`, () => {
          const byName = layoutSlide(kind, theme.id, variant);
          const byIndex = layoutSlide(kind, theme.id, index);
          expect(stripIds(byIndex.elements)).toEqual(stripIds(byName.elements));
          const els = flatten(byName.elements);
          expect(els.length).toBeGreaterThan(0);
          expect(new Set(els.map((e) => e.id)).size, "unique ids").toBe(els.length);
          const emoji = /\p{Extended_Pictographic}/u;
          for (const el of els) {
            const tag = `${kind}/${variant}/${el.type}${el.name ? ` "${el.name}"` : ""}`;
            expect(el.w, `${tag} width`).toBeGreaterThan(0);
            expect(el.h, `${tag} height`).toBeGreaterThan(0);
            expect(el.x, `${tag} left`).toBeGreaterThanOrEqual(0);
            expect(el.y, `${tag} top`).toBeGreaterThanOrEqual(0);
            expect(el.x + el.w, `${tag} right`).toBeLessThanOrEqual(SLIDE_W);
            expect(el.y + el.h, `${tag} bottom`).toBeLessThanOrEqual(SLIDE_H);
            if (el.type === "text") {
              expect(el.x, `${tag} safe left`).toBeGreaterThanOrEqual(SAFE.x);
              expect(el.y, `${tag} safe top`).toBeGreaterThanOrEqual(SAFE.y);
              expect(el.x + el.w, `${tag} safe right`).toBeLessThanOrEqual(SAFE.x + SAFE.w);
              expect(el.y + el.h, `${tag} safe bottom`).toBeLessThanOrEqual(SAFE.y + SAFE.h);
              if (el.style.fontSize !== undefined)
                expect(el.style.fontSize, `${tag} floor`).toBeGreaterThanOrEqual(
                  fontFloor(el.style.preset),
                );
            }
            if (el.type === "shape") {
              expect(el.x, `${tag} trim left`).toBeGreaterThanOrEqual(TRIM);
              expect(el.y, `${tag} trim top`).toBeGreaterThanOrEqual(TRIM);
              expect(el.x + el.w, `${tag} trim right`).toBeLessThanOrEqual(SLIDE_W - TRIM);
              expect(el.y + el.h, `${tag} trim bottom`).toBeLessThanOrEqual(SLIDE_H - TRIM);
              if (el.textStyle?.fontSize !== undefined)
                expect(el.textStyle.fontSize, `${tag} label floor`).toBeGreaterThanOrEqual(
                  fontFloor(el.textStyle.preset ?? "body"),
                );
            }
            const doc = "doc" in el ? el.doc : undefined;
            if (!doc) continue;
            const text = docToPlainText(doc);
            expect(text.toLowerCase(), tag).not.toContain("lorem");
            expect(emoji.test(text), `${tag}: ${text}`).toBe(false);
          }
        });
      }
    }
  }

  it("names the slots a variant's filler finds, and the default recipes name none", () => {
    const names = (kind: SlideKind, variant: string) =>
      layoutSlide(kind, "chalk", variant)
        .elements.filter((e) => e.type === "text")
        .map((e) => e.name);
    expect(names("title", "photo-band")).toEqual(["Title", "Subtitle"]);
    expect(names("content", "statement")).toEqual(["Eyebrow", "Statement"]);
    expect(names("content", "two-column")).toEqual([undefined, "Body left", "Body right"]);
    expect(names("instructions", "cards")).toEqual([
      undefined,
      "Item 1",
      "Item 2",
      "Item 3",
      "Item 4",
      undefined,
    ]);
    expect(names("objectives", "stepped")).toEqual([undefined, "Item 1", "Item 2", "Item 3"]);
    for (const kind of KINDS)
      for (const el of layoutSlide(kind, "chalk").elements)
        if (el.type === "text") expect(el.name, kind).toBeUndefined();
  });

  it("draws the photo-band title as a bleed photograph under an inset ink band", () => {
    for (const theme of THEMES) {
      const { elements } = layoutSlide("title", theme.id, "photo-band");
      const [photo, band, title, sub] = elements;
      expect(photo?.type).toBe("image");
      expect([photo?.x, photo?.y, photo?.w, photo?.h]).toEqual([0, 0, SLIDE_W, SLIDE_H]);
      expect(band?.type).toBe("shape");
      if (band?.type !== "shape") throw new Error("no band");
      expect(band.fill).toBe(theme.colors.ink);
      expect(band.opacity).toBe(0.88);
      expect(band.y, theme.id).toBeLessThanOrEqual(340);
      expect(band.y + band.h).toBe(SLIDE_H - TRIM);
      for (const el of [title, sub]) {
        if (el?.type !== "text") throw new Error("no text");
        expect(el.y, `${theme.id} ${el.name} inside the band`).toBeGreaterThanOrEqual(band.y);
        expect(el.style.color).toBe(theme.colors.onAccent);
      }
    }
  });

  it("puts each stepped item beside a numeral block, in order, without overlap", () => {
    for (const theme of THEMES) {
      const { elements } = layoutSlide("instructions", theme.id, "stepped");
      const blocks = elements.filter((e) => e.type === "shape" && e.name?.startsWith("Step"));
      const items = elements.filter((e) => e.type === "text" && e.name?.startsWith("Item"));
      expect(blocks).toHaveLength(4);
      expect(items).toHaveLength(4);
      blocks.forEach((block, i) => {
        if (block.type !== "shape") throw new Error("no block");
        expect(block.doc && docToPlainText(block.doc).trim()).toBe(`${i + 1}`);
        expect(block.fill).toBe(theme.colors.accent);
        const item = items[i];
        if (!item) throw new Error("no item");
        expect(item.x).toBeGreaterThanOrEqual(block.x + block.w);
        const next = items[i + 1];
        if (next)
          expect(next.y, `${theme.id} item ${i + 1}`).toBeGreaterThanOrEqual(item.y + item.h);
      });
    }
  });

  it("lays cards three across for three items and two by two for four", () => {
    const three = layoutSlide("objectives", "chalk", "cards").elements.filter(
      (e) => e.type === "shape" && e.name?.startsWith("Card"),
    );
    expect(three).toHaveLength(3);
    expect(new Set(three.map((c) => c.y)).size).toBe(1);
    const four = layoutSlide("instructions", "chalk", "cards").elements.filter(
      (e) => e.type === "shape" && e.name?.startsWith("Card"),
    );
    expect(four).toHaveLength(4);
    expect(new Set(four.map((c) => c.y)).size).toBe(2);
    expect(new Set(four.map((c) => c.x)).size).toBe(2);
  });
});
