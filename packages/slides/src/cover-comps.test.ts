import { describe, expect, test } from "bun:test";
import type { TextElement } from "@tj/domain/documents";
import { coverDropsQuestion } from "./cover-comps";
import { coverTypeAt } from "./layout-sizes";
import { layoutSlide } from "./layouts";
import { applyLook, contrastRatio } from "./look";
import { layoutTemplate } from "./templates/index";
import { atKeyStage, getTheme } from "./themes";

const run = (text: string) => ({ type: "text", text });
const doc = (...runs: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content: runs }],
});

// The writer's title cap is 8 words (heading) and 12 (lead); the lines below are past it.
const LONG_TITLE = "Why did the industrial revolution transform everyday working lives?";
const LONG_LEAD =
  "What changed for families when factories, railways and new machines arrived in towns?";

function cover(stage: "ks1" | "ks2" | "ks3", title: string, lead: string) {
  const theme = atKeyStage(getTheme("geometric"), stage);
  const l = layoutSlide("title", "geometric", "split");
  const els = l.elements.map((e) => {
    if (e.type === "image") return { ...e, src: "/x.jpg" };
    if (e.type !== "text") return e;
    if (e.style.preset === "caption") return { ...e, doc: doc(run("HISTORY · YEAR 9")) };
    if (e.style.preset === "title") return { ...e, doc: doc(run(title)) };
    return { ...e, doc: doc(run(lead)) };
  });
  return applyLook({ id: "c", kind: "title", elements: els, background: {} } as never, theme);
}

describe("geometric hexagon cover column (round 5 cover)", () => {
  for (const stage of ["ks1", "ks2", "ks3"] as const)
    for (const [title, lead] of <[string, string][]>[
      ["How do volcanoes erupt?", "What happens under the ground before lava reaches the surface?"],
      [LONG_TITLE, LONG_LEAD],
    ])
      test(`${stage}: "${title.slice(0, 20)}": the question is the small step, under the title, inside the slide`, () => {
        const s = cover(stage, title, lead);
        const texts = s.elements.filter((e): e is TextElement => e.type === "text");
        const t = texts.find((e) => e.style.preset === "title")!;
        const q = texts.find((e) => e.style.preset === "small" && e.y > t.y)!;
        expect(q).toBeTruthy();
        // The gold's cover question (ruling 21 A): the stage's reading floor, drawn at that size.
        expect(q.style.fontSize).toBe(coverTypeAt(stage).question);
        expect(q.style.fixedSize).toBe(true);
        expect(q.y).toBeGreaterThanOrEqual(t.y + t.h);
        expect(q.y + q.h).toBeLessThanOrEqual(540 - 43);
        // Beside the hexagon, never under it.
        expect(q.x + q.w).toBeLessThanOrEqual(507);
        expect(t.x + t.w).toBeLessThanOrEqual(507);
      });
});

describe("a generated cover (the title template) takes the theme's cover composition", () => {
  const input = {
    template: "title",
    heading: "River processes",
    lead: "Recall: what have you seen moving water carry away?",
    figure: { photo: "/x.jpg", alt: "A river", aspect: 1.5 },
  } as never;
  test("Geometric: the hexagon frame on the dot ground, no accent ground", () => {
    const r = layoutTemplate(input, atKeyStage(getTheme("geometric"), "ks3"), "ks3");
    expect(r.slide.background?.color).toBeUndefined();
    const photo = r.slide.elements.find((e) => e.type === "image" && e.name === "Photo");
    expect(photo && "mask" in photo ? photo.mask : undefined).toBe("hexagon");
    expect(r.slide.elements.some((e) => e.name === "Cover outline")).toBe(true);
    expect(r.over).toEqual([]);
  });
  test("Paper: its split, the picture framed on the sand field, on its own ground", () => {
    const r = layoutTemplate(input, atKeyStage(getTheme("paper"), "ks3"), "ks3");
    expect(r.slide.background?.color).toBeUndefined();
    expect(r.slide.elements.some((e) => e.name === "Cover field")).toBe(true);
    expect(r.slide.elements.some((e) => e.name === "Cover outline")).toBe(false);
  });
});

// TEACH-215 part g: every round 5 theme's cover (themes5.json `covers`, `coverFallback`).
const THEMES5 = [
  "paper",
  "poster",
  "treehouse",
  "reading-room",
  "storytime",
  "scrapbook",
  "calm",
  "geometric",
  "beacon",
  "crayon",
  "exam-hall",
  "playground",
  "splash",
  "studio",
  "dark-slate",
  "dark-ember",
];
const VOLCANO = {
  template: "title",
  heading: "How do volcanoes erupt?",
  accentWord: "volcanoes",
  lead: "What happens under the ground before lava reaches the surface?",
};
const withPic = { ...VOLCANO, figure: { photo: "/x.jpg", alt: "A volcano", aspect: 1.5 } };
const titleOf = (els: { type: string; name?: string }[]) =>
  els.find((e) => e.type === "text" && e.name === "Title") as TextElement;
const accentRun = (t: TextElement) =>
  (t.doc.content?.[0]?.content ?? []).find((r) => "text" in r && r.text === "volcanoes") as
    | { marks?: { attrs?: { color?: string } }[] }
    | undefined;
const box = (e: { x: number; y: number; w: number; h: number }) => e;
const inside = (e: { x: number; y: number; w: number; h: number }) =>
  e.x >= -0.5 && e.y >= -0.5 && e.x + e.w <= 960.5 && e.y + e.h <= 540.5;

describe("round 5 covers on every theme (TEACH-215 part g)", () => {
  for (const id of THEMES5) {
    const t = atKeyStage(getTheme(id), id === "storytime" ? "ks1" : "ks3");
    const st = id === "storytime" ? "ks1" : "ks3";
    test(`${id}: the picture cover is the theme's composition on its own ground, words clear of the picture`, () => {
      const r = layoutTemplate(withPic as never, t, st);
      expect(r.over).toEqual([]);
      if (id !== "poster") expect(r.slide.background?.color).toBeUndefined();
      const photo = r.slide.elements.find((e) => e.type === "image" && e.name === "Photo") as {
        x: number;
        y: number;
        w: number;
        h: number;
      };
      expect(photo).toBeTruthy();
      for (const e of r.slide.elements.filter((x) => x.type === "text")) {
        expect(inside(box(e))).toBe(true);
        // Text never sits on the photo (cover5 rule), except on Poster's plate over its bleed.
        if (id !== "poster") {
          const hit =
            e.x < photo.x + photo.w &&
            photo.x < e.x + e.w &&
            e.y < photo.y + photo.h &&
            photo.y < e.y + e.h;
          expect(hit).toBe(false);
        }
      }
    });
    if (id === "geometric") continue;
    test(`${id}: the picture-failed cover is the theme's fallback, not the flat accent card`, () => {
      const r = layoutTemplate(VOLCANO as never, t, st);
      expect(r.over).toEqual([]);
      const bg = r.slide.background?.color;
      expect(bg === undefined || bg !== t.colors.accent).toBe(true);
      for (const e of r.slide.elements) expect(inside(box(e))).toBe(true);
    });
    test(`${id}: the accent word wears the theme's cover accent`, () => {
      for (const input of [withPic, VOLCANO]) {
        const r = layoutTemplate(input as never, t, st);
        const run = accentRun(titleOf(r.slide.elements));
        expect(run?.marks?.[0]?.attrs?.color).toBeTruthy();
        expect(run?.marks?.[0]?.attrs?.color).not.toBe(titleOf(r.slide.elements).style.color);
      }
    });
  }
  test("a saved cover's old look colour gives way to the composition's ground", () => {
    const theme = atKeyStage(getTheme("treehouse"), "ks3");
    const l = layoutSlide("title", "treehouse", "split");
    const els = l.elements.map((e) => (e.type === "image" ? { ...e, src: "/x.jpg" } : e));
    const s = applyLook(
      { id: "c", kind: "title", elements: els, background: { color: "#5A1530" } } as never,
      theme,
    );
    expect(s.background?.color).toBeUndefined();
  });
});

// Review fixes (TEACH-215 part g): edge cases on every theme, real contrast, a teacher's ground.
const LONG_Q =
  "What do you think happens deep under the ground before hot lava finally reaches the surface?";
const SAFE_FOOT = 540 - 43;
const textsOf = (els: readonly { type: string }[]) =>
  els.filter((e) => e.type === "text") as TextElement[];

/** The fill under the middle of `e`: the last shape drawn before it that covers that point. */
function groundUnder(
  els: readonly { type: string; x: number; y: number; w: number; h: number; fill?: string }[],
  i: number,
  ground: string,
): string {
  const e = els[i] as { x: number; y: number; w: number; h: number };
  const cx = e.x + Math.min(e.w, 60) / 2;
  const cy = e.y + Math.min(e.h, 40) / 2;
  for (let j = i - 1; j >= 0; j--) {
    const b = els[j] as { type: string; x: number; y: number; w: number; h: number; fill?: string };
    if (b.type !== "shape" || !b.fill || b.fill === "transparent") continue;
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return b.fill;
  }
  return ground;
}

describe("covers hold every case on every theme (TEACH-215 part g review)", () => {
  const cases = {
    "long title": {
      ...VOLCANO,
      heading: "Why did the industrial revolution change everyday lives?",
    },
    "no question": { template: "title", heading: VOLCANO.heading, accentWord: "volcanoes" },
    "16-word question": { ...VOLCANO, lead: LONG_Q },
  };
  for (const id of THEMES5)
    for (const stage of ["ks1", "ks3"] as const)
      test(`${id} ${stage}: long title, no question, a 16-word question, with and without a picture`, () => {
        const t = atKeyStage(getTheme(id), stage);
        for (const [name, base] of Object.entries(cases))
          for (const pic of [true, false]) {
            const input = pic ? { ...base, figure: withPic.figure } : base;
            const r = layoutTemplate(input as never, t, stage);
            const els = r.slide.elements;
            for (const e of textsOf(els)) {
              expect({ name, pic, el: e.name, inside: inside(e) }).toEqual({
                name,
                pic,
                el: e.name,
                inside: true,
              });
              expect({ name, pic, el: e.name, foot: e.y + e.h <= SAFE_FOOT + 1 }).toEqual({
                name,
                pic,
                el: e.name,
                foot: true,
              });
            }
            if (name !== "long title")
              expect({ name, pic, over: r.over }).toEqual({ name, pic, over: [] });
            const hasQ = textsOf(els).some((e) => e.name === "Subtitle");
            // Greg's call 36: a photo-right or Beacon picture cover draws no question.
            expect({ name, pic, hasQ }).toEqual({
              name,
              pic,
              hasQ: name !== "no question" && !(pic && coverDropsQuestion(t)),
            });
          }
      });
});

describe("cover words read on what is under them (WCAG AA, layout-contrast.test's rule)", () => {
  for (const id of THEMES5) {
    if (id === "geometric") continue;
    test(`${id}: title, accent word, question and eyebrow`, () => {
      const t = atKeyStage(getTheme(id), "ks3");
      const slides = [
        layoutTemplate(withPic as never, t, "ks3").slide,
        layoutTemplate(VOLCANO as never, t, "ks3").slide,
      ];
      // The saved path with an eyebrow (applyLook over the split layout).
      const l = layoutSlide("title", id, "split");
      const els0 = l.elements.map((e) => {
        if (e.type === "image") return { ...e, src: "/x.jpg" };
        if (e.type !== "text") return e;
        if (e.style.preset === "caption") return { ...e, doc: doc(run("GEOGRAPHY · YEAR 8")) };
        if (e.style.preset === "title") return { ...e, doc: doc(run("How do volcanoes erupt?")) };
        return { ...e, doc: doc(run("What happens under the ground?")) };
      });
      slides.push(
        applyLook({ id: "c", kind: "title", elements: els0, background: {} } as never, t),
      );
      const bad: string[] = [];
      for (const s of slides) {
        const ground = s.background?.color ?? t.colors.background;
        s.elements.forEach((e, i) => {
          if (e.type !== "text") return;
          const back = groundUnder(s.elements as never, i, ground);
          const size = e.style.fontSize ?? 20;
          const large = size >= 24 || (size >= 18.66 && (e.style.fontWeight ?? 400) >= 700);
          const need = large ? 3 : 4.5;
          const inks = [e.style.color ?? t.colors.ink];
          for (const r of e.doc.content?.[0]?.content ?? [])
            for (const m of (r as { marks?: { attrs?: { color?: string } }[] }).marks ?? [])
              if (m.attrs?.color) inks.push(m.attrs.color);
          for (const ink of inks)
            if (contrastRatio(ink, back) < need)
              bad.push(
                `${e.name ?? e.style.preset}: ${ink} on ${back} ${contrastRatio(ink, back).toFixed(2)}`,
              );
        });
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("a teacher's own cover ground survives the look", () => {
  test("a custom colour and a picture background stay; an old look colour goes", () => {
    const theme = atKeyStage(getTheme("treehouse"), "ks3");
    const l = layoutSlide("title", "treehouse", "split");
    const els = l.elements.map((e) => (e.type === "image" ? { ...e, src: "/x.jpg" } : e));
    const look = (background: object) =>
      applyLook({ id: "c", kind: "title", elements: els, background } as never, theme).background;
    expect(look({ color: "#123456" })?.color).toBe("#123456");
    expect(look({ image: "/bg.jpg" })?.image).toBe("/bg.jpg");
    expect(look({ color: getTheme("splash").colors.accent })?.color).toBeUndefined();
  });
});
