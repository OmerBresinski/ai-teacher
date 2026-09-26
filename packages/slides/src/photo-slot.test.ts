import { describe, expect, test } from "bun:test";
import type { ImageElement, Slide, TextElement } from "@tj/domain/documents";
import { fitSlide } from "./fit-slide";
import { SAFE, SPACE } from "./grid";
import { PLACEHOLDER_IMAGE } from "./layouts";
import {
  COUNTER_NAME,
  DIAGRAM_NAME,
  isOpenPhotoSlot,
  KIND_TAG_NAME,
  PHOTO_NAME,
  photoLabel,
} from "./look";
import {
  materialiseSlide,
  materialiseSlides,
  photoDropped,
  presentedSlide,
  withoutDiagramSlot,
  withSlotsShown,
} from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import type { SlideSpecOf } from "./specs";
import { docLines, ITEM_NAME } from "./structure";
import { readingSize } from "./text-style";
import { getTheme, THEMES } from "./themes";

/*
 * look/image-slot: a teaching slide the plan gives a photograph keeps the right half for it. The
 * words sit beside it at the body size and continue rather than shrink it; an open slot is the
 * editor's placeholder and is laid out away in present and export; the demo view draws every slot.
 */

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
type Content = SlideSpecOf<"content">;
const photo = { subject: "Roman legionaries", mustShow: ["shields", "armour"] };
const why: Content = {
  kind: "content",
  factRefs: [],
  heading: "Why conquer Britain?",
  body: "Rome wanted Britain for its metals, grain and slaves. A victory there also made an emperor look strong at home.",
};
const reasons: Content = {
  ...why,
  body: "The Romans had three reasons to invade.",
  points: ["Wealth: tin and silver.", "Glory for Claudius.", "Safety from Gaul."],
};
const LONG = [
  "Rome wanted Britain for its metals, grain and slaves, which it could send back across the sea.",
  "Tin, lead and silver from the mines paid for soldiers and roads across the empire.",
  "The emperor Claudius also needed a victory, because he had only just come to power in Rome.",
  "Conquering an island that Julius Caesar had failed to hold would make him look strong at home.",
  "Some Britons had also helped the Gauls fight Rome, so the island was a threat as well as a prize.",
].join(" ");

const slot = (s: Slide) => s.elements.find((e) => e.name === PHOTO_NAME) as ImageElement;
const bodyText = (s: Slide) =>
  s.elements.filter(
    (e): e is TextElement => e.type === "text" && e.style.preset === "body" && e.name !== "Heading",
  );
const words = (slides: Slide[]) =>
  slides
    .flatMap((s) => bodyText(s).flatMap((e) => docLines(e.doc)))
    .join(" ")
    .replace(/\s+/g, " ");

describe("a photo brief keeps the right half of an explain or a list", () => {
  for (const t of THEMES) {
    test(`${t.id}: explain, text left at the body size, a rounded cover-cropped slot right`, () => {
      const [s] = materialiseSlides(why, t.id, meta, undefined, 0, { photo });
      const img = slot(s as Slide);
      expect(img.type).toBe("image");
      expect(img.src).toBe(PLACEHOLDER_IMAGE);
      expect(img.alt).toBe("Roman legionaries — shields, armour");
      expect(img.fit).toBe("cover");
      expect(img.radius).toBe(t.radius);
      // About half the width, to the foot of the safe area.
      const half = Math.floor((SAFE.w - SPACE[5]) / 2);
      expect(Math.abs(img.w - (SAFE.w - half - SPACE[5]))).toBeLessThanOrEqual(1);
      expect(img.x + img.w).toBe(SAFE.x + SAFE.w);
      expect(img.y + img.h).toBe(SAFE_BOTTOM);
      for (const e of bodyText(s as Slide)) {
        expect(e.x + e.w).toBeLessThanOrEqual(img.x - SPACE[5] + 1);
        expect(e.style.fontSize ?? readingSize(t)).toBeGreaterThanOrEqual(readingSize(t));
      }
      expect(fitSlide(s as Slide, t).overflow).toHaveLength(0);
    });
  }

  test("a list keeps its points as dots in the left column", () => {
    const [s] = materialiseSlides(reasons, "chalk", meta, undefined, 0, { photo });
    const img = slot(s as Slide);
    const items = (s as Slide).elements.filter((e) => e.name === ITEM_NAME);
    expect(img).toBeDefined();
    expect(items).toHaveLength(3);
    for (const e of items) expect(e.x + e.w).toBeLessThanOrEqual(img.x);
  });

  test("words too long beside the photo continue on the next slide, the photo not shrunk", () => {
    const t = getTheme("chalk");
    const pages = materialiseSlides({ ...why, body: LONG }, "chalk", meta, undefined, 0, {
      photo,
    });
    expect(pages.length).toBeGreaterThan(1);
    const img = slot(pages[0] as Slide);
    const half = Math.floor((SAFE.w - SPACE[5]) / 2);
    expect(img.w).toBeGreaterThanOrEqual(SAFE.w - half - SPACE[5] - 1);
    // The photograph is on the first slide only, every word is said once, at the body size.
    expect(pages.slice(1).every((p) => !slot(p))).toBe(true);
    expect(words(pages)).toBe(LONG);
    for (const p of pages) {
      for (const e of bodyText(p)) {
        expect(e.style.fontSize ?? readingSize(t)).toBeGreaterThanOrEqual(readingSize(t));
      }
    }
  });

  test("a compare or a sequence stays full width and its photo is dropped", () => {
    const compare: Content = {
      ...why,
      body: "Two sides saw the invasion differently.",
      compare: {
        left: { label: "Romans", points: ["A rich prize", "Glory for Claudius"] },
        right: { label: "Britons", points: ["Lost their land", "Paid Roman taxes"] },
      },
    };
    const steps: Content = {
      ...why,
      body: "The invasion came in stages.",
      steps: ["Landing in Kent", "Crossing the Medway", "Taking Colchester"],
    };
    for (const spec of [compare, steps]) {
      const s = materialiseSlide(spec, "chalk", meta, undefined, 0, { photo });
      expect(slot(s)).toBeUndefined();
      expect(photoDropped(spec, { photo })).toBe(spec === compare ? "compare" : "sequence");
    }
    expect(photoDropped(why, { photo })).toBeUndefined();
    expect(photoDropped(why, {})).toBeUndefined();
  });

  test("no brief, no slot", () => {
    expect(slot(materialiseSlide(why, "chalk", meta))).toBeUndefined();
  });
});

describe("no photograph found: present and export never show an empty box", () => {
  const t = getTheme("chalk");
  const stored = () =>
    materialiseSlides(why, "chalk", meta, undefined, 0, {
      photo,
      deck: { yearGroup: "Year 4", subject: "History" },
    })[0] as Slide;

  test("an open slot is laid out away: the words take the full measure", () => {
    const before = stored();
    const shown = withoutDiagramSlot(before, t);
    expect(shown.elements.some(isOpenPhotoSlot)).toBe(false);
    // Every sentence still said (a key idea may move to the panel, as for an undrawn diagram).
    const sorted = (x: string) =>
      x
        .split(/(?<=\.) /)
        .sort()
        .join(" ");
    expect(sorted(words([shown]))).toBe(sorted(words([before])));
    const right = Math.max(...bodyText(shown).map((e) => e.x + e.w));
    expect(right).toBeGreaterThan(SAFE.x + SAFE.w / 2 + SPACE[5]);
    // The top line as it was.
    const named = (s: Slide, n: string) => s.elements.filter((e) => e.name === n);
    expect(named(shown, KIND_TAG_NAME)).toEqual(named(before, KIND_TAG_NAME));
    expect(named(shown, COUNTER_NAME)).toEqual(named(before, COUNTER_NAME));
  });

  test("the export view (presentedSlide) carries no open slot", () => {
    const out = presentedSlide(stored(), t, { index: 0, total: 3 });
    expect(out.elements.some((e) => e.name === PHOTO_NAME)).toBe(false);
  });

  test("a placed photograph stays where it is", () => {
    const s = stored();
    const placed: Slide = {
      ...s,
      elements: s.elements.map((e) =>
        e.name === PHOTO_NAME ? { ...e, src: "https://images.pexels.com/p.jpeg" } : e,
      ),
    };
    expect(withoutDiagramSlot(placed, t)).toBe(placed);
    expect(presentedSlide(placed, t).elements.some((e) => e.name === PHOTO_NAME)).toBe(true);
  });
});

describe("the demo view draws every slot (withSlotsShown)", () => {
  const t = getTheme("chalk");
  const cycle: Content = {
    kind: "content",
    factRefs: [],
    heading: "The water cycle",
    body: "Water moves between the sea, the air and the land in a loop. The sun heats the sea and water evaporates.",
    diagram: "Cycle: evaporation → condensation → precipitation → collection",
  };

  test("an undrawn diagram gets the right half, with its instruction", () => {
    const [stored] = materialiseSlides(cycle, "chalk", meta);
    expect((stored as Slide).elements.some((e) => e.name === DIAGRAM_NAME)).toBe(false);
    const shown = withSlotsShown(stored as Slide, t);
    const box = shown.elements.find((e) => e.name === DIAGRAM_NAME);
    expect(box && "doc" in box && box.doc && docLines(box.doc).join(" ")).toBe(
      "Diagram: Cycle: evaporation → condensation → precipitation → collection",
    );
    expect(box?.x).toBeGreaterThan(SAFE.x + SAFE.w / 3);
    for (const e of bodyText(shown)) expect(e.x + e.w).toBeLessThanOrEqual((box?.x ?? 0) + 1);
    expect(shown.elements.some((e) => e.name === "Side panel")).toBe(false);
    expect(words([shown])).toBe(cycle.body);
    // Export never draws it, even from the demo view.
    expect(presentedSlide(shown, t).elements.some((e) => e.name === DIAGRAM_NAME)).toBe(false);
  });

  test("an open photo slot is left for the image view; other slides come back as they are", () => {
    const [stored] = materialiseSlides(why, "chalk", meta, undefined, 0, { photo });
    expect(withSlotsShown(stored as Slide, t)).toBe(stored as Slide);
    const plain = materialiseSlide(why, "chalk", meta);
    expect(withSlotsShown(plain, t)).toBe(plain);
  });

  test("the placeholder's words", () => {
    expect(photoLabel({ subject: "A flooded town street" })).toBe("A flooded town street");
    expect(photoLabel(photo)).toBe("Roman legionaries — shields, armour");
  });
});
