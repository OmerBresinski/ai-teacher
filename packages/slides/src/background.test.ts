import { describe, expect, test } from "bun:test";
import type { Slide, SlideArt, SlideKind, Theme } from "@tj/domain/documents";
import {
  artChoices,
  artCollisions,
  hasArtVariants,
  slideArtLayers,
  slideArtRole,
  slideBackground,
  themeArt,
} from "./background";
import { LAYOUT_CATALOGUE, layoutSlide, variantsFor } from "./layouts";
import { applyLook, withDeckChrome } from "./look";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { getTheme, THEMES } from "./themes";

/** A slide as a deck shows it: laid out, the look applied, the deck line and counter set. */
function laidOut(kind: SlideKind, theme: Theme, variant: string): Slide {
  const laid = layoutSlide(kind, theme.id, variant);
  const slide: Slide = { id: "s", kind, elements: laid.elements };
  if (laid.question) slide.question = laid.question;
  const [done] = withDeckChrome([applyLook(slide, theme), slide], theme, {
    yearGroup: "Year 9",
    subject: "Geography",
  });
  return done as Slide;
}

/** The same slide with everything mirrored left-right: a picture on the right (TEACH-19). */
const mirrored = (slide: Slide): Slide => ({
  ...slide,
  id: `${slide.id}-mirrored`,
  elements: slide.elements.map((e) => ({ ...e, x: 960 - e.x - e.w })),
});

const SPECS: SlideSpec[] = [
  {
    kind: "content",
    heading: "Simplifying a ratio",
    body: "Divide both parts by the same number and the ratio stays equivalent.",
    steps: [
      "Write the ratio: 12 : 18",
      "Find a common factor: 6",
      "Divide both parts by 6",
      "Simplest form: 2 : 3",
    ],
    callout: { kind: "watch-out", text: "Divide both parts, not just one." },
    factRefs: [],
  },
  {
    kind: "content",
    heading: "Hard or soft?",
    body: "Coastal managers choose between building against the sea and working with it.",
    compare: {
      left: { label: "Hard engineering", points: ["Sea walls", "Groynes", "Rock armour"] },
      right: {
        label: "Soft engineering",
        points: ["Beach nourishment", "Managed retreat", "Dune planting"],
      },
    },
    factRefs: [],
  },
  {
    kind: "content",
    heading: "Choosing a defence",
    body: "Match the defence to the risk and the place. Groynes trap sediment but starve beaches further along. Managed retreat lets a planned area flood to protect land inland.",
    callout: {
      kind: "example",
      text: "At Medmerry, a planned area floods so inland homes stay safe.",
    },
    factRefs: [],
  },
] as SlideSpec[];

/** Every layout variant of every kind, the generated shapes, and the pictures mirrored. */
function everyLayout(theme: Theme): { name: string; slide: Slide }[] {
  const out: { name: string; slide: Slide }[] = [];
  for (const kind of Object.keys(LAYOUT_CATALOGUE) as SlideKind[]) {
    for (const variant of variantsFor(kind)) {
      const slide = laidOut(kind, theme, variant);
      out.push({ name: `${kind}/${variant}`, slide });
      if (slideArtRole(slide).role === "picture") {
        out.push({ name: `${kind}/${variant} mirrored`, slide: mirrored(slide) });
      }
    }
  }
  const meta = { promptVersion: "test", model: "code", at: "2026-09-27T00:00:00Z" };
  SPECS.forEach((spec, i) => {
    out.push({ name: `spec ${i}`, slide: materialiseSlide(spec, theme.id, meta) });
  });
  return out;
}

describe("theme art per slide role (UX ruling 107)", () => {
  test("the role mapping: title, content and picture, with the picture's side", () => {
    const t = getTheme("playground");
    expect(slideArtRole(laidOut("title", t, "stack"))).toEqual({ role: "title" });
    expect(slideArtRole(laidOut("title", t, "photo-band"))).toEqual({
      role: "picture",
      side: "full",
    });
    expect(slideArtRole(laidOut("title", t, "split"))).toEqual({ role: "picture", side: "right" });
    expect(slideArtRole(laidOut("image-text", t, "photo-left"))).toEqual({
      role: "picture",
      side: "left",
    });
    expect(slideArtRole(mirrored(laidOut("image-text", t, "photo-left")))).toEqual({
      role: "picture",
      side: "right",
    });
    expect(slideArtRole(laidOut("diagram", t, "figure-left"))).toEqual({
      role: "picture",
      side: "left",
    });
    expect(slideArtRole(laidOut("image-match", t, "picture-row"))).toEqual({
      role: "picture",
      side: "full",
    });
    for (const kind of [
      "content",
      "objectives",
      "multiple-choice",
      "true-false",
      "timer",
    ] as const) {
      expect(slideArtRole(laidOut(kind, t, variantsFor(kind)[0] as string)).role).toBe("content");
    }
  });

  test("no overlaps: every theme's art, on every layout, meets no text, card or picture", () => {
    let checked = 0;
    const misses: string[] = [];
    for (const theme of THEMES) {
      for (const { name, slide } of everyLayout(theme)) {
        const { role, side } = slideArtRole(slide);
        for (const layer of artCollisions(themeArt(theme, role, side), slide)) {
          misses.push(
            `${theme.id} ${name} (${role}${side ? ` ${side}` : ""}) at ${layer.x},${layer.y}`,
          );
        }
        checked++;
      }
    }
    expect(misses).toEqual([]);
    expect(checked).toBeGreaterThan(400);
  });

  test("forced variants: what the menu offers fits whole, and nothing forced ever collides", () => {
    const forced: SlideArt[] = ["title", "content", "picture", "plain"];
    for (const theme of THEMES) {
      for (const { name, slide } of everyLayout(theme)) {
        const offered = artChoices(theme, slide);
        for (const art of forced) {
          const withArt = { ...slide, background: { art } };
          const drawn = slideArtLayers(theme, withArt);
          expect(artCollisions(drawn, withArt), `${theme.id} ${name} ${art}`).toEqual([]);
          if (offered.includes(art) && art !== "plain") {
            const side = art === "picture" ? (slideArtRole(slide).side ?? "left") : undefined;
            expect(drawn, `${theme.id} ${name} ${art} whole`).toEqual(themeArt(theme, art, side));
          }
        }
      }
    }
  });

  test("the playful four vary by role; the clean six are plain off the title slide", () => {
    for (const id of ["playground", "crayon", "splash", "treehouse"]) {
      const t = getTheme(id);
      const area = (role: "title" | "content" | "picture") =>
        themeArt(t, role).reduce((a, l) => a + l.w * l.h, 0);
      expect(area("title")).toBeGreaterThan(area("content"));
      expect(area("title")).toBeGreaterThan(area("picture"));
      expect(area("content")).toBeGreaterThan(0);
      expect(area("picture")).toBeGreaterThan(0);
    }
    for (const id of ["chalk", "reading-room", "studio", "exam-hall", "night-lab", "beacon"]) {
      const t = getTheme(id);
      expect(themeArt(t, "title").length).toBeGreaterThan(0);
      expect(themeArt(t, "content")).toEqual([]);
      expect(themeArt(t, "picture")).toEqual([]);
    }
    for (const t of THEMES) expect(hasArtVariants(t)).toBe(true);
  });

  test("slideBackground: role art, the override, and the slide's own colour or image", () => {
    const t = getTheme("playground");
    const content = laidOut("content", t, "headed");
    const cover = laidOut("title", t, "stack");
    expect(slideBackground(t, cover)).toContain("data:image/svg+xml");
    expect(slideBackground(t, content)).not.toBe(slideBackground(t, cover));
    expect(slideBackground(t, { ...content, background: { art: "plain" } })).toBeUndefined();
    expect(slideBackground(t, { ...content, background: { art: "auto" } })).toBe(
      slideBackground(t, content),
    );
    expect(slideBackground(t, { ...content, background: { color: "#000000" } })).toBeUndefined();
    expect(slideBackground(t, { ...content, background: { image: "/a.png" } })).toBeUndefined();
    // The picture motif on a content slide goes on the right, as for a photo on the left.
    const picture = slideBackground(t, { ...content, background: { art: "picture" } });
    expect(picture).toBeTruthy();
    expect(picture).not.toBe(slideBackground(t, content));
  });

  test("a theme without per-role art keeps its one backgroundImage everywhere", () => {
    const plain: Theme = {
      ...getTheme("chalk"),
      backgrounds: undefined,
      backgroundImage: "linear-gradient(red, red)",
    };
    const slide = laidOut("content", plain, "headed");
    expect(slideBackground(plain, slide)).toBe("linear-gradient(red, red)");
    const cover: Slide = {
      id: "c",
      kind: "title",
      elements: layoutSlide("title", "chalk").elements,
    };
    expect(slideBackground(plain, cover)).toBe("linear-gradient(red, red)");
    expect(artChoices(plain, slide)).toEqual([]);
    const bare: Theme = { ...plain, backgroundImage: undefined };
    expect(slideBackground(bare, slide)).toBeUndefined();
  });

  test("the picture motif follows the picture to the other side", () => {
    const t = getTheme("treehouse");
    const left = laidOut("image-text", t, "photo-left");
    const [l] = slideArtLayers(t, left);
    const [r] = slideArtLayers(t, mirrored(left));
    expect(l && l.x > 480).toBe(true);
    expect(r && r.x + r.w < 480).toBe(true);
    expect(r?.image).not.toBe(l?.image);
  });
});
