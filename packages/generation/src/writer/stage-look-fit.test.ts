import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "@tj/slides";
import { fitsWithVisual } from "./check-pictures";
import type { Brief } from "./fixes";
import { type MaterialiseCtx, materialise, type VisualAsk, type VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part cx (CODE-NOTE v4.21 item 4, its fit half): a picture `withLook` adds to a check
 * slide from the flow's look gets cj's fit test (`fitsWithVisual`): placed only when the writer's
 * words still fit beside it no worse than without it. Code never cuts a word to make room, so one
 * that does not fit is taken off the slide: logged `look-unfit`, and the slide goes on to cj like
 * any check slide with no visual. One that fits is drawn (practice reads `figure`). The fit is
 * measured once the theme has settled, in the theme the deck is drawn in.
 */
type S = Record<string, unknown>;
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

const LONG =
  "Look closely at every animal in the picture and say which young one belongs with which adult";

const LOOK_SRC = "/files/test/look-picture.png";
async function replay(edit: (slides: S[]) => void, themeNow?: string) {
  const main = JSON.parse((read("main.json") as { text: string }).text) as { slides: S[] };
  edit(main.slides);
  const events: S[] = [];
  const asked: string[] = [];
  const rec = recordedVisuals(B);
  const out = await runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services: {
      ...replayServices(B),
      log: (e: S) => events.push(e),
      writer: async () => ({ text: JSON.stringify(main), finishReason: "stop", usd: 0, ms: 0 }),
    },
    visual: (i: number, key: string, a: VisualAsk): VisualState => {
      asked.push(`${i}:${key}:${a.shows ?? ""}`);
      if (a.shows === LOOK)
        return {
          status: "photo",
          photo: { src: LOOK_SRC, alt: LOOK, aspect: 4 / 3, request: LOOK },
        };
      return rec(i, key, a);
    },
    held: recordedHeld(B),
    ...(themeNow ? { themeNow: async () => themeNow } : {}),
  });
  return { out, events, asked };
}
/** Flow slide 6 plans this practice slide with a picture look (its own picture taken off here). */
const LOOK = "Three adults and three young animals in mixed order";

describe("a check picture added from the flow's look gets cj's fit test", () => {
  test("words that fit beside it: the look's picture is asked for and drawn", async () => {
    const { events, asked, out } = await replay((slides) => {
      expect(slides[3]?.template).toBe("practice");
      (slides[3] as S).picture = null;
    });
    const added = events.filter((e) => e.ev === "look-added" && e.how === "figure-from-look");
    expect(added).toHaveLength(1);
    expect(events.filter((e) => e.ev === "look-unfit")).toEqual([]);
    expect(asked.some((a) => a.endsWith(LOOK))).toBe(true);
    expect(JSON.stringify(out.slides)).toContain(LOOK_SRC);
  });

  test("words that do not fit beside it: off the slide, `look-unfit` logged, then cj", async () => {
    const { events, out } = await replay((slides) => {
      const s = slides[3] as S;
      s.picture = null;
      s.questions = [1, 2, 3].map((n) => `${LONG} (${n}).`);
    });
    const unfit = events.filter((e) => e.ev === "look-unfit");
    expect(unfit).toHaveLength(1);
    expect(unfit[0]).toMatchObject({ template: "practice", key: "figure", next: "cj" });
    expect(JSON.stringify(out.slides)).not.toContain(LOOK_SRC);
    const slide = (unfit[0] as S).slide;
    expect(events.filter((e) => e.ev === "look-unmet" && e.slide === slide)).toHaveLength(1);
    const cj = events.filter(
      (e) => (e.ev === "check-visual" || e.ev === "check-visual-skip") && e.slide === slide,
    );
    expect(cj).toHaveLength(1);
  });

  test("the fit is decided after the theme settles, in the theme the deck is drawn in", async () => {
    // A teacher switches the theme while the job writes (`themeNow`, TEACH-247 part ap): the slides
    // are laid again in it, and only then is the look's picture measured.
    const { events } = await replay((slides) => {
      const s = slides[3] as S;
      s.picture = null;
      s.questions = [1, 2, 3].map((n) => `${LONG} (${n}).`);
    }, "poster");
    const at = (ev: string) => events.findIndex((e) => e.ev === ev);
    expect(events[at("theme-now")]).toMatchObject({ to: "poster" });
    expect(at("look-unfit")).toBeGreaterThan(at("theme-now"));
  });
});

describe("practice draws the look's picture, and a pending one is measured with its room", () => {
  const brief = { keyStage: "ks1", topic: "Animals and their young", subject: "science" } as never;
  const ctx = (visual: (k: string) => VisualState): MaterialiseCtx => ({
    brief,
    theme: getTheme("splash", "ks1" as never),
    stage: "ks1" as never,
    index: 3,
    plan: { slides: [] },
    visual,
  });
  const failed = (): VisualState => ({ status: "failed" });
  const bare: S = { template: "practice", heading: "Make the matches", questions: ["Name it."] };
  const fig = { shows: LOOK, must_see: [LOOK], subject: "generic" };

  test("a landed photo under `figure` is drawn on practice", () => {
    const photo: VisualState = {
      status: "photo",
      photo: { src: "/files/x/p.jpg", alt: LOOK, aspect: 4 / 3, request: LOOK } as never,
    };
    const m = materialise(
      { ...bare, figure: fig },
      ctx((k) => (k === "figure" ? photo : failed())),
    );
    expect(m.slide.elements.filter((e) => e.type === "image")).toHaveLength(1);
  });

  test("a pending picture takes its room: long words beside it are refused, short ones pass", () => {
    const pending: VisualState = { status: "pending" };
    const wordy = { ...bare, questions: [1, 2, 3, 4].map((n) => `${LONG} (${n}).`) };
    expect(fitsWithVisual(wordy, { ...wordy, figure: fig }, ctx(failed), "figure", pending)).toBe(
      false,
    );
    expect(fitsWithVisual(bare, { ...bare, figure: fig }, ctx(failed), "figure", pending)).toBe(
      true,
    );
  });
});
