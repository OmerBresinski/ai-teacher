import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "@tj/slides/themes";
import { checkSlide, placeholderSlots } from "./checks";
import { materialise, slotShapes, visualsOf } from "./materialise";

/*
 * TEACH-247 part bx: the human writer's y1 lesson (replay 20261029-010427, s7 "From chick to hen")
 * shipped three grey placeholders. The stages template lays a `stage.<n>` slot for every stage
 * picture, but `figures()` never listed them, so no picture was asked for and the slots stayed
 * open with the checks reading `failing: 0`. Every slot a laid slide holds must be asked for, and
 * a slide that still holds a placeholder is a check fault.
 */
type S = Record<string, unknown>;
type El = { type: string; src?: string; children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const INDEX = 6;
const base = {
  brief: {
    id: "t",
    topic: "Animals and their young",
    subject: "science",
    yearGroup: "Year 1",
    year: 1,
    keyStage: "ks1",
    theme: "crayon",
    readingLevel: "",
    language: "en-GB",
    durationMin: 60,
    exitTicketOnSlides: true,
  },
  theme: getTheme("crayon"),
  stage: "ks1",
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
} as never;
const SLIDES = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/human-writer-y1-slides.json"), "utf8"),
) as S[];
const stages = SLIDES.find((s) => s.template === "stages") as S;
const pic = (shows: string) => ({ shows, must_see: [], subject: "generic" });

describe("stages: every stage picture is asked for", () => {
  test("the chick-to-hen strip asks three pictures, one set, each in its slot's shape", () => {
    const asks = visualsOf(stages, INDEX, base);
    expect(asks.map((a) => a.key)).toEqual(["stage.0", "stage.1", "stage.2"]);
    for (const a of asks) {
      expect(a.type).toBe("photo");
      expect((a as { set?: string }).set).toBe("stages");
      expect((a as { aspect?: number }).aspect).toBeGreaterThan(0);
    }
    expect((asks[0] as { shows: string }).shows).toContain("newly hatched chick");
  });
  test("a stage with no picture asks nothing; one picture alone is not a set", () => {
    const items = (stages.items as S[]).map((i, n) => ({
      ...i,
      picture: n === 1 ? i.picture : null,
    }));
    const asks = visualsOf({ ...stages, items }, INDEX, base);
    expect(asks.map((a) => a.key)).toEqual(["stage.1"]);
    expect((asks[0] as { set?: string }).set).toBeUndefined();
  });
  test("a landed stage picture fills its tile: no placeholder, no fault", () => {
    const m = materialise(stages, {
      ...(base as object),
      index: INDEX,
      visual: (k: string) => ({
        status: "photo",
        photo: { src: `https://img.test/${k}.png`, alt: k, aspect: 1, request: k },
      }),
    } as never);
    const srcs = flat(m.slide.elements as El[])
      .filter((e) => e.type === "image")
      .map((e) => e.src);
    expect(srcs).toEqual([0, 1, 2].map((n) => `https://img.test/stage.${n}.png`));
    expect(placeholderSlots(m.slide.elements)).toEqual([]);
  });
});

describe("every picture slot a laid slide holds is asked for (the y1 deck and synthetic layouts)", () => {
  const SYNTH: Record<string, S> = {
    "picture-sequence": {
      template: "picture-sequence",
      heading: "An egg hatches",
      sequence: [
        { ...pic("an egg"), caption: "Egg" },
        { ...pic("a cracking egg"), caption: "Crack" },
        { ...pic("a wet chick"), caption: "Chick" },
      ],
    },
    "activity cards": {
      template: "sort",
      heading: "Sort the animals",
      instruction: "Sort them.",
      cards: [
        { label: "Puppy", picture: pic("a puppy") },
        { label: "Dog", picture: pic("a dog") },
      ],
    },
  };
  const all: [string, S][] = [
    ...SLIDES.map((s, n) => [`y1 s${n + 1} ${s.template}`, s] as [string, S]),
    ...Object.entries(SYNTH),
  ];
  for (const [name, s] of all)
    test(name, () => {
      const slots = Object.keys(slotShapes(s, { ...(base as object), index: INDEX } as never));
      const asked = new Set(visualsOf(s, INDEX, base).map((a) => a.key));
      expect(slots.filter((k) => !asked.has(k))).toEqual([]);
    });
});

describe("a slide still holding a picture placeholder is a check fault", () => {
  test("the never-asked stage strip reads as three placeholder faults, not a pass", () => {
    const m = materialise(stages, {
      ...(base as object),
      index: INDEX,
      visual: () => ({ status: "pending" }),
    } as never);
    const r = checkSlide({
      index: INDEX,
      slide: m.slide,
      over: [],
      questions: [],
      answers: undefined,
      notesChecked: true,
      words: "",
    });
    expect(r.faults.filter((f) => f.startsWith("placeholder:"))).toHaveLength(3);
  });
});

/*
 * TEACH-247 part ca (Plants s5): a pair activity's cards are distinct subjects, so the director
 * never makes them one individual. Only stages, a picture sequence or a sequence of one subject are.
 */
describe("a set says whether it is one subject", () => {
  const same = (s: S) =>
    visualsOf(s, INDEX, base).map((a) => (a as { sameSubject?: boolean }).sameSubject);
  const cards = (template: string, shows: string[]) => ({
    template,
    heading: "Plant parts",
    instruction: "Match each picture to its name.",
    cards: shows.map((x) => ({ label: x.split(" ")[0], picture: pic(x) })),
  });
  test("pair, group-sort and odd-one-out cards are distinct subjects", () => {
    const parts = ["Roots of a flowering plant", "Stem of a flowering plant"];
    for (const t of ["pair", "group-sort", "odd-one-out"])
      expect(same(cards(t, parts))).toEqual([false, false]);
  });
  test("a sequence activity is one subject only when its cards name one", () => {
    expect(
      same(cards("sequence", ["A bean seed in soil", "A bean seedling", "A tall bean plant"])),
    ).toEqual([true, true, true]);
    expect(
      same(cards("sequence", ["Bread on a plate", "A toaster", "Hot buttered toast"])),
    ).toEqual([false, false, false]);
  });
  test("a stages strip is one subject", () => {
    expect(same(stages)).toEqual([true, true, true]);
  });
});
