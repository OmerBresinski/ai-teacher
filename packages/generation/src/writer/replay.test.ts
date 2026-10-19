import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalArrows } from "@tj/slides/arrow";
import { type El, replayRun, savedSlides } from "./replay-fixture";
import { slideRoles } from "./role";

/*
 * Parity (TEACH-110 part e): the saved base4f-p123 writer outputs (lab/ab-base4f, runs
 * base4f-p123-1 and -2) run through the stage with the run's recorded repair, objective-repair
 * and notes answers and the lab replay's picture states, and must reproduce the lab's replayed
 * decks (runs base4f-p123s-1 and -2, keepPic e3e89767, unshared 5ad4ed59; DECISIONS.md D48c)
 * element for element. No model is called.
 *
 * Not compared:
 *  - element ids (random per layout); picture `source`, `style` and `period` stamps (TEACH-251);
 *  - a list marker's numeral size (part a lays badges at master's sizes; boxes are unchanged);
 *  - speaker notes: the lab replay's notes call failed on every lesson, the stage replays the
 *    original run's notes.
 *
 * Photos in ranged (multi-picture) slots keep their own shape inside the run's box (TEACH-237).
 *
 * One documented difference: r2 y1 slide 6 "Find the pairs". The lab replay kept a split of 5 of
 * its 8 single pictures (splitOk), replacing the matching table the original run shipped. splitOk
 * is ported (TEACH-251 part c), but two of the five tiles carry the same bank image, which ships
 * once: the slide shows 4 distinct photos where the lab showed 5.
 *
 * Two deliberate changes since the lab replay (TEACH-75 part b):
 *  - a question set after the deck's first teaching slide is a check, laid as open-response, not
 *    a "Do now" starter (register prod-11);
 *  - y11 slide 9's heading wraps to two lines, so its body moves down by the extra line, 49 pt
 *    (ruling 198, register layout-06).
 *
 * One since (TEACH-230 part b): practice and exit-ticket slides are the "work alone" layouts, a
 * grid or a ticket of badged tasks, so they keep their heading and kind and are not compared
 * element by element with the lab's numbered list.
 */
/** Each deck slide's role from the run's writer slides (title and objectives first). */
const rolesOf = (b: string) => {
  const main = JSON.parse(readFileSync(join(DIR, b, "main.json"), "utf8")) as { text: string };
  const slides = (JSON.parse(main.text) as { slides: Record<string, unknown>[] }).slides;
  return slideRoles([undefined, undefined, ...slides]);
};

/**
 * SIMPLIFY S3 (TEACH-312 part f): the original runs rewrote these slides into words after their
 * diagram could not be shown (words-rewrite). The stage now keeps the writer's slide, laid without
 * its figure, so only the heading is compared (deck index, title = 0).
 */
const UNSHOWN: Record<string, number[]> = {
  "y11-chemistry-rates-of-reaction": [8],
  "y11-chemistry-rates-of-reaction-r2": [6],
  "y12-psychology-multi-store-model": [3, 6],
  "y12-psychology-multi-store-model-r2": [3],
};
/**
 * SIMPLIFY S3: the original y2 run's objective repair replaced slide 4's "Which shaded part is one
 * half?" on drawn shapes with a text hinge. The repair call is gone, so the writer's drawn task stays.
 */
const OBJECTIVE_KEPT: Record<string, number[]> = { "y2-maths-halves-quarters": [3] };
/**
 * TEACH-247 part n (register diagrams-02): drawings the lab could not show because their labels
 * clashed now find clear spots and draw (y8 s3's family tree, y11 and y11-r2 s3's apparatus, y11-r2 s9's
 * worked-example drawing). The slide keeps
 * the writer's heading and gains its drawing.
 */
const DRAWN_NOW: Record<string, number[]> = {
  "y8-french-my-family": [2],
  "y11-chemistry-rates-of-reaction": [2],
  "y11-chemistry-rates-of-reaction-r2": [2, 8],
};
const headingOf = (els: El[]) => {
  const h = els.find((e) => e.name === "Heading");
  return JSON.stringify(h?.doc ?? h?.text ?? null);
};

const DIR = join(import.meta.dir, "fixtures/replay");
/** The themes whose cover TEACH-215 part g recomposed (every round 5 theme but Geometric). */
const COMPOSED = new Set([
  "paper",
  "poster",
  "treehouse",
  "reading-room",
  "storytime",
  "scrapbook",
  "calm",
  "beacon",
  "crayon",
  "exam-hall",
  "playground",
  "splash",
  "studio",
  "dark-slate",
  "dark-ember",
]);
/** Photo-right and Beacon covers: no question on the picture cover (Greg's call 36, part g). */
const NO_QUESTION = new Set([
  "treehouse",
  "reading-room",
  "beacon",
  "crayon",
  "exam-hall",
  "playground",
  "splash",
  "studio",
  "dark-slate",
  "dark-ember",
]);
const themeOf = (b: string): string =>
  (JSON.parse(readFileSync(join(DIR, b, "brief.json"), "utf8")) as { theme?: string }).theme ?? "";
const LESSONS = readdirSync(DIR).sort();
const SVG_URL = "data:image/svg+xml;charset=utf-8,";
const stable = (e: El) => {
  // `diagram` (TEACH-97 part h): what a drawing was drawn from; the lab's elements predate it.
  const { id: _i, source: _s, style: _t, period: _p, diagram: _d, ...rest } = e;
  // Line arrows are drawn by the arrow primitive since TEACH-75 part x: compare each arrow by its
  // tip, and the rest of the drawing byte for byte.
  if (rest.name === "Diagram" && typeof rest.src === "string" && rest.src.startsWith(SVG_URL))
    rest.src = canonicalArrows(decodeURIComponent(rest.src.slice(SVG_URL.length)));
  // A list marker's numeral is laid at master's badge sizes (TEACH-110 part a), not the lab's.
  if (rest.name === "Marker" && rest.textStyle) {
    const { fontSize: _f, ...ts } = rest.textStyle as El;
    return { ...rest, textStyle: ts };
  }
  return rest;
};

/**
 * TEACH-237: a photo in a ranged slot (compare, picture-sequence, tiles) takes its own shape inside
 * the run's box instead of being cropped to it, so its box may be smaller and its crop gone. Every
 * other field is still the run's.
 */
function expectRangedPhoto(got: El, want: El, at: string) {
  const { x, y, w, h, crop: _c, ...rest } = stable(got);
  const { x: wx, y: wy, w: ww, h: wh, crop: _wc, ...wantRest } = stable(want);
  expect({ at, el: rest }).toEqual({ at, el: wantRest });
  const inside =
    Number(x) >= Number(wx) - 1 &&
    Number(y) >= Number(wy) - 1 &&
    Number(x) + Number(w) <= Number(wx) + Number(ww) + 1 &&
    Number(y) + Number(h) <= Number(wy) + Number(wh) + 1;
  expect({ at, inside }).toEqual({ at, inside: true });
}

describe.each(LESSONS)("replay %s", (b) => {
  test("the stage reproduces the lab's replayed slides", async () => {
    const out = await replayRun(b);
    const saved = savedSlides(b);
    const roles = rolesOf(b);
    expect(out.slides.length).toBe(saved.length);
    out.slides.forEach((s, i) => {
      const want = saved[i] as El & { elements: El[] };
      const got = s.elements as unknown as El[];
      if (b === "y1-science-animals-young-r2" && i === 5) {
        // splitOk: the landed single photos, each once, never the reroute's word table
        const photos = got.filter((e) => e.type === "image" && e.name === "Photo");
        expect(got.some((e) => e.type === "image" && e.name === "Diagram")).toBe(false);
        expect(new Set(photos.map((e) => e.src)).size).toBe(4);
        expect(photos).toHaveLength(4);
        return;
      }
      // TEACH-256 part b: the hinge is re-laid to the v13 gold (question as title, cards on a sand
      // stage), so the lab's saved hinge is not its geometry; its answer cards are still drawn.
      if (s.kind === "multiple-choice" && want.kind === "multiple-choice") {
        expect(got.some((e) => e.name === "Option")).toBe(true);
        return;
      }
      // TEACH-215 part g (19 Oct 2026): the cover (slide 0) on a theme whose round 5 composition
      // changed it (every theme but Geometric) is set on the theme's own ground, so the lab's
      // saved cover is not its geometry or ground; its title, picture and question still are.
      if (i === 0 && s.kind === "title" && want.kind === "title" && COMPOSED.has(themeOf(b))) {
        const has = (els: El[], name: string) => els.some((e) => e.name === name);
        expect({ i, title: has(got, "Title") }).toEqual({ i, title: true });
        expect({ i, photo: has(got, "Photo") }).toEqual({ i, photo: has(want.elements, "Photo") });
        // Greg's call 36: a photo-right or Beacon picture cover draws no question.
        const drops = NO_QUESTION.has(themeOf(b)) && has(got, "Photo");
        expect({ i, q: has(got, "Subtitle") }).toEqual({
          i,
          q: has(want.elements, "Subtitle") && !drops,
        });
        return;
      }
      if (OBJECTIVE_KEPT[b]?.includes(i)) {
        expect(got.some((e) => e.type === "image" && e.name === "Diagram")).toBe(true);
        return;
      }
      if (DRAWN_NOW[b]?.includes(i)) {
        expect(got.some((e) => e.type === "image" && e.name === "Diagram")).toBe(true);
        expect({ i, heading: headingOf(got) }).toEqual({ i, heading: headingOf(want.elements) });
        return;
      }
      if (got.some((e) => e.name === "surface:badge" && !("icon" in e))) {
        expect({ i, heading: headingOf(got) }).toEqual({ i, heading: headingOf(want.elements) });
        expect(got.some((e) => e.name === "Task")).toBe(true);
        return;
      }
      if (UNSHOWN[b]?.includes(i)) {
        expect(got.some((e) => e.type === "image" && e.name === "Diagram")).toBe(false);
        expect({ i, heading: headingOf(got) }).toEqual({ i, heading: headingOf(want.elements) });
        return;
      }
      const kind =
        want.kind === "starter" && roles.get(i) === "check" ? "open-response" : want.kind;
      expect({ i, kind: s.kind, background: s.background }).toEqual({
        i,
        kind: kind as never,
        background: want.background as never,
      });
      expect({ i, n: got.length }).toEqual({ i, n: want.elements.length });
      // Ranged slots are the multi-picture ones; title, picture-text and big-picture hold one photo.
      const ranged =
        want.elements.filter((e) => e.type === "image" && e.name === "Photo").length > 1;
      for (const [k, el] of got.entries()) {
        const w = want.elements[k] as El;
        // Every writer element is the AI's (WRITER-CONTRACT §5); the lab's elements predate it.
        expect({ at: `s${i + 1} #${k}`, by: el.authoredBy }).toEqual({
          at: `s${i + 1} #${k}`,
          by: "ai",
        });
        // The writer -> materialise hop keeps what each drawing was drawn from (TEACH-97 part h).
        if (el.type === "image" && el.name === "Diagram")
          expect({ at: `s${i + 1} #${k}`, kind: (el.diagram as El | undefined)?.kind }).toEqual({
            at: `s${i + 1} #${k}`,
            kind: expect.stringMatching(/^(drawer|library)$/),
          });
        const { authoredBy: _by, ...e } = el;
        if (b === "y11-chemistry-rates-of-reaction" && i === 8 && w.name !== "Heading") {
          expect({ at: `s${i + 1} #${k}`, el: stable({ ...e, y: Number(e.y) - 49 }) }).toEqual({
            at: `s${i + 1} #${k}`,
            el: stable(w),
          });
          continue;
        }
        // Ruling 21 A (TEACH-215 part e): the cover's title and question take the gold's sizes
        // (`coverType`), so their boxes' heights, and the stack's top, are not the lab's; every
        // other field still is. The title stands above the question, and both on the slide.
        if (want.kind === "title" && (w.name === "Title" || w.name === "Subtitle")) {
          const { y: _y, h: _h, w: ew, ...rest } = stable(e);
          const { y: _wy, h: _wh, w: ww, ...wantRest } = stable(w);
          expect({ at: `s${i + 1} #${k}`, el: rest }).toEqual({
            at: `s${i + 1} #${k}`,
            el: wantRest,
          });
          // Ruling 25 A: the column only widens (it takes what the smaller picture frees).
          expect({ at: `s${i + 1} #${k}`, wider: Number(ew) >= Number(ww) }).toEqual({
            at: `s${i + 1} #${k}`,
            wider: true,
          });
          const box = (name: string) => {
            const x = got.find((g) => g.name === name);
            return x ? { name, y: Number(x.y), h: Number(x.h) } : undefined;
          };
          const title = box("Title");
          const sub = box("Subtitle");
          for (const b of [title, sub])
            if (b)
              expect({ at: `s${i + 1} ${b.name}`, y: b.y >= 0, foot: b.y + b.h <= 540 }).toEqual({
                at: `s${i + 1} ${b.name}`,
                y: true,
                foot: true,
              });
          if (title && sub)
            expect({ at: `s${i + 1}`, above: title.y + title.h <= sub.y }).toEqual({
              at: `s${i + 1}`,
              above: true,
            });
          continue;
        }
        // Ruling 25 A (Greg 18 Oct): the cover's picture is 10% smaller than the lab's, on the
        // same right edge and centred on the same line; everything else about it is the lab's.
        if (want.kind === "title" && w.type === "image" && w.name === "Photo") {
          const { x, y, w: ew, h: eh, ...rest } = stable(e);
          const { x: wx, y: wy, w: ww, h: wh, ...wantRest } = stable(w);
          const n = (v: unknown) => Number(v);
          expect({ at: `s${i + 1} #${k}`, el: rest }).toEqual({
            at: `s${i + 1} #${k}`,
            el: wantRest,
          });
          expect({
            at: `s${i + 1} #${k}`,
            w: Math.abs(n(ew) - n(ww) * 0.9) <= 2,
            h: Math.abs(n(eh) - n(wh) * 0.9) <= 2,
            right: n(x) + n(ew) === n(wx) + n(ww),
            middle: Math.abs(n(y) + n(eh) / 2 - (n(wy) + n(wh) / 2)) <= 1,
          }).toEqual({ at: `s${i + 1} #${k}`, w: true, h: true, right: true, middle: true });
          continue;
        }
        if (ranged && w.type === "image" && w.name === "Photo") {
          expectRangedPhoto(e, w, `s${i + 1} #${k}`);
          continue;
        }
        expect({ at: `s${i + 1} #${k}`, el: stable(e) }).toEqual({
          at: `s${i + 1} #${k}`,
          el: stable(w),
        });
      }
    });
  });
});

test("replayed writer outputs end with a diagram source on their drawings (TEACH-97 part h)", async () => {
  const kinds: string[] = [];
  for (const b of LESSONS) {
    const out = await replayRun(b);
    for (const s of out.slides)
      for (const e of s.elements as unknown as El[])
        if (e.type === "image" && e.name === "Diagram")
          kinds.push(String((e.diagram as El | undefined)?.kind));
  }
  expect(kinds.length).toBeGreaterThan(3);
  expect(kinds.filter((k) => k !== "drawer" && k !== "library")).toEqual([]);
});
