import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { withActivities } from "./activities";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import { materialise, type Plan, type VisualState, visualsOf } from "./materialise";
import { BANNER_TEXT_DEFAULT, writerSchema } from "./schema";
import { validate } from "./strict-subset";

/*
 * Banner text on the writer's side (UX ruling 203, P4): the schema entry is off by default
 * (master's schema byte for byte) and older outputs still parse with it on; the strip is an
 * ordinary picture slot (key `picture`, so the same retries and lostPic ladder); a failed picture
 * leaves the words, never an empty strip.
 */
type S = Record<string, unknown>;
type J = Record<string, unknown>;

const banner: S = {
  template: "banner-text",
  heading: "The body's transport network",
  lead: "The circulatory system is your body's delivery service.",
  points: [
    { label: "The heart", text: "the pump." },
    { label: "Blood vessels", text: "the pipes." },
    "Blood carries oxygen.",
  ],
  picture: { shows: "the human circulatory system", must_see: ["heart"], subject: "generic" },
  at: "top",
};

describe("the banner-text schema", () => {
  const SLIDES = (fixture as { brief: { slides: { min: number; max: number } } }).brief.slides;
  const on = writerSchema("KS2", SLIDES, undefined, { bannerText: true }) as J;
  const defs = on.$defs as Record<string, J>;

  test("is off by default: master's schema byte for byte", () => {
    expect(BANNER_TEXT_DEFAULT).toBe(false);
    expect(JSON.stringify(writerSchema("KS2", SLIDES))).toBe(
      JSON.stringify(writerSchema("KS2", SLIDES, undefined, { bannerText: false })),
    );
    expect(JSON.stringify(writerSchema("KS2", SLIDES))).not.toContain("banner-text");
  });

  test("older outputs still validate with it on (round trip)", () => {
    const k1 = writerSchema("KS1", SLIDES, undefined, { bannerText: true }) as J;
    expect(validate(withActivities(k1, "KS1"), (fixture as { main: unknown }).main)).toEqual([]);
  });

  test("a banner validates top or bottom; four bullets do not", () => {
    expect(validate(defs["banner-text"] as J, banner, on)).toEqual([]);
    expect(validate(defs["banner-text"] as J, { ...banner, at: "bottom" }, on)).toEqual([]);
    const four = { ...banner, points: ["a", "b", "c", "d"] };
    expect(validate(defs["banner-text"] as J, four, on)).not.toEqual([]);
  });
});

describe("banner text on the writer's layout", () => {
  const brief = { ...sampleBriefLesson().brief, keyStage: "KS2" } as never;
  const base = {
    brief,
    theme: getTheme(undefined as never, "KS2" as never),
    stage: "KS2" as never,
  };
  const plan = { slides: [] } as unknown as Plan;
  const run = (s: S, visual: (k: string) => VisualState) =>
    materialise(s, { ...base, index: 3, plan, visual });

  test("the strip is one ordinary picture ask, at the strip's wide shape", () => {
    const asks = visualsOf(banner, 3, { ...base, plan });
    expect(asks).toHaveLength(1);
    const a = asks[0];
    if (a?.type !== "photo") throw new Error("not a photo ask");
    expect(a.key).toBe("picture");
    expect(a.aspect).toBeGreaterThan(4);
    expect(a.fixedShape).toBe(false);
  });

  test("a placed wide photo is the strip", () => {
    const r = run(banner, () => ({
      status: "photo",
      photo: {
        src: "https://x.test/b.jpg",
        alt: "body",
        aspect: 1.5,
        subjects: [{ name: "heart", x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
      },
    }));
    const strip = r.slide.elements.find((e) => e.name === "Banner");
    expect(strip).toMatchObject({ x: 0, w: 960 });
  });

  test("a failed picture leaves the words, never an empty strip", () => {
    const r = run(banner, () => ({ status: "failed" }));
    expect(r.slide.elements.filter((e) => e.type === "image")).toHaveLength(0);
    expect(r.slide.kind).toBe("content");
  });
});
