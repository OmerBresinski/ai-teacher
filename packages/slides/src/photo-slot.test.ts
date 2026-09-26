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
  PHOTO_TEXT_SHARE,
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
import { floorBelow, readingSize } from "./text-style";
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

describe("a photo brief keeps the left of an explain or a list", () => {
  for (const t of THEMES) {
    test(`${t.id}: explain, a rounded cover-cropped slot left, the text right at the body size`, () => {
      const [s] = materialiseSlides(why, t.id, meta, undefined, 0, { photo });
      const img = slot(s as Slide);
      expect(img.type).toBe("image");
      expect(img.src).toBe(PLACEHOLDER_IMAGE);
      expect(img.alt).toBe("Roman legionaries — shields, armour");
      expect(img.fit).toBe("cover");
      expect(img.radius).toBe(t.radius);
      // About 38% of the width (a real photo, not a thumbnail), to the foot of the safe area.
      expect(img.w / SAFE.w).toBeGreaterThan(0.35);
      expect(img.w / SAFE.w).toBeLessThan(0.42);
      const half = Math.floor((SAFE.w - SPACE[5]) * PHOTO_TEXT_SHARE);
      expect(Math.abs(img.w - (SAFE.w - half - SPACE[5]))).toBeLessThanOrEqual(1);
      expect(img.x).toBe(SAFE.x);
      expect(img.y + img.h).toBe(SAFE_BOTTOM);
      for (const e of bodyText(s as Slide)) {
        expect(e.x).toBeGreaterThanOrEqual(img.x + img.w + SPACE[5] - 1);
        expect(e.x + e.w).toBeLessThanOrEqual(SAFE.x + SAFE.w + 1);
        expect(e.style.fontSize ?? readingSize(t)).toBeGreaterThanOrEqual(readingSize(t));
      }
      expect(fitSlide(s as Slide, t).overflow).toHaveLength(0);
    });
  }

  test("a list keeps its points as dots in the right column", () => {
    const [s] = materialiseSlides(reasons, "chalk", meta, undefined, 0, { photo });
    const img = slot(s as Slide);
    const items = (s as Slide).elements.filter((e) => e.name === ITEM_NAME);
    expect(img).toBeDefined();
    expect(items).toHaveLength(3);
    for (const e of items) expect(e.x).toBeGreaterThanOrEqual(img.x + img.w);
  });

  for (const t of THEMES) {
    test(`${t.id}: bullets that do not fit beside the photo continue as bullets, never a paragraph`, () => {
      const floods: Content = {
        kind: "content",
        factRefs: [],
        heading: "How river floods affect people",
        body: "Floods cause damage to people and places in three main ways.",
        points: [
          "Homes: floodwater ruins floors, walls and furniture, and families may have to move out for months.",
          "Roads: streets and bridges close, so people are cut off from shops, schools and hospitals.",
          "Health: dirty water spreads disease, and damp homes grow mould that harms breathing.",
        ],
      };
      const pages = materialiseSlides(floods, t.id, meta, undefined, 0, { photo });
      const items = (p: Slide) =>
        p.elements
          .filter((e): e is TextElement => e.name === ITEM_NAME)
          .map((e) => docLines(e.doc).join(" "));
      expect(slot(pages[0] as Slide)).toBeDefined();
      expect(pages.flatMap(items)).toEqual(floods.points as string[]);
      for (const p of pages) {
        expect(p.elements.some((e) => e.name === "Body")).toBe(false);
        expect(fitSlide(p, t).overflow).toHaveLength(0);
        for (const e of bodyText(p)) {
          expect(e.style.fontSize ?? readingSize(t)).toBeGreaterThanOrEqual(floorBelow(t, "body"));
        }
      }
      if (pages.length > 1) {
        // The lead (and the bullets that fit) beside the photo; every continuation carries bullets.
        expect((pages[0] as Slide).elements.some((e) => e.name === "Lead")).toBe(true);
        for (const p of pages.slice(1)) expect(items(p).length).toBeGreaterThan(0);
        const img = slot(pages[0] as Slide);
        for (const e of bodyText(pages[0] as Slide))
          expect(e.x).toBeGreaterThanOrEqual(img.x + img.w);
      }
    });
  }

  test("words too long beside the photo continue on the next slide, the photo not shrunk", () => {
    const t = getTheme("chalk");
    const pages = materialiseSlides({ ...why, body: LONG }, "chalk", meta, undefined, 0, {
      photo,
    });
    expect(pages.length).toBeGreaterThan(1);
    const img = slot(pages[0] as Slide);
    const half = Math.floor((SAFE.w - SPACE[5]) * PHOTO_TEXT_SHARE);
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

  test("an undrawn diagram gets the left half, with its instruction", () => {
    const [stored] = materialiseSlides(cycle, "chalk", meta);
    expect((stored as Slide).elements.some((e) => e.name === DIAGRAM_NAME)).toBe(false);
    const shown = withSlotsShown(stored as Slide, t);
    const box = shown.elements.find((e) => e.name === DIAGRAM_NAME);
    expect(box && "doc" in box && box.doc && docLines(box.doc).join(" ")).toBe(
      "Diagram: Cycle: evaporation → condensation → precipitation → collection",
    );
    expect(box?.x).toBe(SAFE.x);
    for (const e of bodyText(shown))
      expect(e.x).toBeGreaterThanOrEqual((box?.x ?? 0) + (box?.w ?? 0));
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

describe("the first slide holds all it can; a continuation never holds one item alone", () => {
  const sentencesIn = (p: Slide) =>
    bodyText(p)
      .filter((e) => e.name !== "Heading")
      .flatMap((e) => docLines(e.doc))
      .join(" ")
      .split(/(?<=\.) /)
      .filter(Boolean);
  const itemsIn = (p: Slide) => p.elements.filter((e) => e.name === ITEM_NAME).length;

  for (const t of THEMES) {
    test(`${t.id}: a list beside a photo keeps every point that fits on the first slide`, () => {
      const spec: Content = {
        kind: "content",
        factRefs: [],
        heading: "Why the Romans invaded Britain",
        body: "Britain offered the Romans wealth and glory.",
        points: [
          "Wealth: metals such as tin and lead.",
          "Glory: a victory made Claudius look strong.",
          "Safety: Britons had helped Rome's enemies in Gaul.",
          "Trade: grain and slaves could be sent to Rome.",
        ],
      };
      const pages = materialiseSlides(spec, t.id, meta, undefined, 0, { photo });
      const first = pages[0] as Slide;
      expect(slot(first)).toBeDefined();
      expect(itemsIn(first)).toBeGreaterThan(0);
      for (const p of pages.slice(1)) expect(itemsIn(p)).toBeGreaterThanOrEqual(2);
      expect(pages.reduce((n, p) => n + itemsIn(p), 0)).toBe(4);
      for (const p of pages) expect(fitSlide(p, t).overflow).toHaveLength(0);
    });

    test(`${t.id}: sentences beside a photo fill the first slide; the rest never one sentence alone`, () => {
      const pages = materialiseSlides({ ...why, body: LONG }, t.id, meta, undefined, 0, { photo });
      expect(sentencesIn(pages[0] as Slide).length).toBeGreaterThanOrEqual(2);
      for (const p of pages.slice(1)) expect(sentencesIn(p).length).toBeGreaterThanOrEqual(2);
      for (const p of pages) {
        for (const e of bodyText(p)) {
          expect(e.style.fontSize ?? readingSize(t)).toBeGreaterThanOrEqual(floorBelow(t, "body"));
        }
      }
    });
  }

  test("rivers 04: steps too long for the strip read as dots across the full measure, at the body size", () => {
    const t = getTheme("chalk");
    const spec: Content = {
      kind: "content",
      factRefs: [],
      heading: "How rainfall can cause river flooding",
      body: "Heavy or prolonged rainfall can raise a river’s discharge until it spills over its banks.",
      steps: [
        "When rain falls heavily or for a long time, the ground may not absorb it all.",
        "The extra water flows over the land into streams and rivers, raising their discharge.",
        "If the river cannot contain this added water, it spills onto nearby land.",
        "During Storm Desmond in 2015, heavy rain caused river flooding in Cumbria.",
      ],
    };
    const pages = materialiseSlides(spec, "chalk", meta);
    for (const p of pages) {
      expect(fitSlide(p, t).overflow).toHaveLength(0);
      const words = bodyText(p).filter((e) => e.name !== "Heading");
      const right = Math.max(...words.map((e) => e.x + e.w));
      expect(right).toBeGreaterThanOrEqual(SAFE.x + SAFE.w - 2);
      // At the body size, or the one step down that keeps an item from standing alone.
      for (const e of words)
        expect(e.style.fontSize ?? readingSize(t)).toBeGreaterThanOrEqual(floorBelow(t, "body"));
    }
    expect(pages.reduce((n, p) => n + itemsIn(p), 0)).toBe(4);
  });
});

test("tempest 06: a written list too long for one slide stays dots across the full measure", () => {
  const t = getTheme("chalk");
  const spec: Content = {
    kind: "content",
    factRefs: [],
    heading: "Prospero's commands and threats",
    body: "Prospero makes his authority visible through commands and threats.",
    points: [
      "Command: It tells another character what to do, showing that Prospero expects obedience from everyone on the island.",
      "Threat: It warns of punishment for disobedience, pressuring the character and showing Prospero can enforce his will.",
      "Example: Prospero warns Ariel, “I will rend an oak”; the threatened punishment shows how his words can pressure Ariel to obey.",
    ],
  };
  const pages = materialiseSlides(spec, "chalk", meta, undefined, 0, { deck: {} });
  expect(pages.flatMap((p) => p.elements.filter((e) => e.name === ITEM_NAME))).toHaveLength(3);
  for (const p of pages) {
    expect(fitSlide(p, t).overflow).toHaveLength(0);
    const items = p.elements.filter((e) => e.name === ITEM_NAME);
    for (const e of items) expect(e.x + e.w).toBeGreaterThanOrEqual(SAFE.x + SAFE.w - 2);
  }
});

test("the counter's box holds a two-digit count", async () => {
  const { withDeckChrome, COUNTER_NAME: C } = await import("./look");
  const t = getTheme("chalk");
  const s = materialiseSlide(why, "chalk", meta);
  const deck = withDeckChrome(
    Array.from({ length: 12 }, () => s),
    t,
  );
  const box = deck[10]?.elements.find((e) => e.name === C);
  expect(box?.w ?? 0).toBeGreaterThanOrEqual(Math.ceil("88 / 88".length * t.sizes.caption * 0.78));
});
