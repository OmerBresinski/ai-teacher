import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { withActivities } from "./activities";
import { charsOver, fitTable } from "./fixes";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import { materialise, type Plan, type VisualState, visualsOf } from "./materialise";
import { HOOK_DEFAULT, writerSchema } from "./schema";
import { validate } from "./strict-subset";

/*
 * Full-bleed hook on the writer's side (UX ruling 203, P5): the schema entry is off by default
 * (master's schema byte for byte) and older outputs still parse with it on; the photo is an
 * ordinary picture slot (key `picture`, so the same retries and lostPic ladder); a failed picture
 * makes the slide a discussion prompt, never an empty dark slide.
 */
type S = Record<string, unknown>;
type J = Record<string, unknown>;

const hook: S = {
  template: "hook",
  heading: "Why do volcanoes erupt?",
  lead: "Deep under your feet, rock is hot enough to melt. Why does it burst out?",
  picture: { shows: "a volcano erupting at night", must_see: ["volcano"], subject: "generic" },
};

describe("the hook schema", () => {
  const SLIDES = (fixture as { brief: { slides: { min: number; max: number } } }).brief.slides;
  const on = writerSchema("KS2", SLIDES, undefined, { hook: true }) as J;
  const defs = on.$defs as Record<string, J>;

  test("is off by default: master's schema byte for byte", () => {
    expect(HOOK_DEFAULT).toBe(false);
    expect(JSON.stringify(writerSchema("KS2", SLIDES))).toBe(
      JSON.stringify(writerSchema("KS2", SLIDES, undefined, { hook: false })),
    );
    expect(JSON.stringify(writerSchema("KS2", SLIDES))).not.toContain('"hook"');
  });

  test("older outputs still validate with it on (round trip)", () => {
    const k1 = writerSchema("KS1", SLIDES, undefined, { hook: true }) as J;
    expect(validate(withActivities(k1, "KS1"), (fixture as { main: unknown }).main)).toEqual([]);
  });

  test("a hook validates; one with no picture does not", () => {
    expect(validate(defs.hook as J, hook, on)).toEqual([]);
    const { picture: _, ...bare } = hook;
    expect(validate(defs.hook as J, bare, on)).not.toEqual([]);
  });
});

describe("hook on the writer's layout", () => {
  const brief = { ...sampleBriefLesson().brief, keyStage: "KS2" } as never;
  const base = {
    brief,
    theme: getTheme(undefined as never, "KS2" as never),
    stage: "KS2" as never,
  };
  const plan = { slides: [] } as unknown as Plan;
  const run = (s: S, visual: (k: string) => VisualState) =>
    materialise(s, { ...base, index: 2, plan, visual });

  test("the photo is one ordinary picture ask, at the slide's own shape", () => {
    const asks = visualsOf(hook, 2, { ...base, plan });
    expect(asks).toHaveLength(1);
    const a = asks[0];
    if (a?.type !== "photo") throw new Error("not a photo ask");
    expect(a.key).toBe("picture");
    expect(a.aspect).toBeCloseTo(960 / 540, 1);
    expect(a.fixedShape).toBe(false);
  });

  test("a placed photo is full bleed under the scrim", () => {
    const r = run(hook, () => ({
      status: "photo",
      photo: { src: "https://x.test/h.jpg", alt: "volcano", aspect: 16 / 9 },
    }));
    expect(r.slide.elements.find((e) => e.name === "Hook photo")).toMatchObject({ w: 960, h: 540 });
    expect(r.slide.elements.some((e) => e.name === "Scrim")).toBe(true);
    expect(r.over).toEqual([]);
  });

  test("a failed picture makes a discussion prompt, never an empty dark slide", () => {
    const r = run(hook, () => ({ status: "failed" }));
    expect(r.slide.kind).toBe("discussion");
    expect(r.slide.elements.some((e) => e.name === "Scrim")).toBe(false);
  });
});

describe("the hook's fit", () => {
  test("the fit table has the hook, and its cap holds the writer to it", () => {
    const v = fitTable().KS2?.layouts.hook?.variants ?? [];
    expect(v).toHaveLength(1);
    expect(v[0]?.chars).toBeGreaterThan(200);
    const SLIDES = (fixture as { brief: { slides: { min: number; max: number } } }).brief.slides;
    const on = writerSchema("KS2", SLIDES, undefined, { hook: true }) as J;
    const def = (on.$defs as Record<string, J>).hook as J;
    expect(validate(def, { ...hook, lead: "word ".repeat(200) }, on)).not.toEqual([]);
    expect(charsOver({ ...hook, lead: "word ".repeat(200) }, "KS2")[0]).toMatch(/^lead:/);
  });
});
