import { describe, expect, test } from "bun:test";
import { contractFor, planMenu } from "../plan-write/menu";
import { audienceOf } from "../stages/shared";
import { sampleBriefLesson } from "../testing";
import {
  PLAN_LESSON_VERSION,
  type PlanLessonInput,
  type PlanSlide,
  parsePlan,
  planLessonPrompt,
  toWire,
} from "./plan-lesson";
import { WRITE_SLIDES_VERSION, type WriteSlidesInput, writeSlidesPrompt } from "./write-slides";

/*
 * ADR 0025 §17 for the plan-write prompts, which sit outside the registry (they are called only
 * behind AI_LESSON_PLANNER=plan-write): each prompt's text is pinned to its version. Change the
 * text → bump the version → update the hash. The planner's hash covers the rendered palette, so a
 * contract change in @tj/slides re-pins it too.
 */

const hash = (p: { system: string; user: string }) =>
  new Bun.CryptoHasher("sha256").update(`${p.system}\n---\n${p.user}`).digest("hex");

const audience = audienceOf(sampleBriefLesson());
const row = (over: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  tests: [],
  teaches: [],
  purpose: "teach it",
  parts: 2,
  form: "explain",
  layout: "default",
  imageBrief: null,
  figureBrief: null,
  ...over,
});
const table: PlanSlide[] = [
  row({ role: "title", form: "title", objectives: [1, 2], parts: 0 }),
  row({ role: "retrieve", form: "starter-set", objectives: [], purpose: "recall particles" }),
  row({ teaches: ["particles in a solid"], purpose: "how particles sit in a solid" }),
  row({
    form: "photo",
    teaches: ["ice floats"],
    imageBrief: { subject: "an iceberg", mustShow: ["ice above the water"] },
  }),
  row({ role: "hinge", form: "hinge", parts: 4, tests: ["particles in a solid"] }),
];

const PLAN_SAMPLE: PlanLessonInput = {
  topic: "States of matter",
  audience,
  answers: { q1: "yes" },
  priorKnowledge: "Solids, liquids and gases by name",
  slideCount: 5,
  menu: planMenu(audience.subject),
  repair: {
    previous: { misconception: "m", objectives: ["o"], runningExample: "ice", slides: table },
    problems: ["The plan has 5 rows after the title; it must have exactly 4."],
  },
};
const WRITE_SAMPLE: WriteSlidesInput = {
  topic: "States of matter",
  audience,
  objectives: ["Describe particles in a solid", "Explain why ice floats"],
  runningExample: "An ice cube melting in a glass",
  misconception: "Particles in a solid do not move; they vibrate in place.",
  table,
  slides: [3, 4].map((n) => {
    const s = table[n - 1] as PlanSlide;
    return { number: n, form: s.form, layout: s.layout, contract: contractFor(s.form, s.layout) };
  }),
};
const REWRITE_SAMPLE: WriteSlidesInput = {
  ...WRITE_SAMPLE,
  rewrite: {
    slide: WRITE_SAMPLE.slides[0] as WriteSlidesInput["slides"][number],
    field: "heading",
    failure: "the heading sits on 2 lines, not one on 4 of 10 themes (chalk, ink, sea, sun)",
    current: { heading: "Particles in a solid", body: ["They vibrate."] },
  },
};

const PINNED = {
  plan: {
    version: "plan-lesson.v5",
    hash: "7aa015097efeabae697c90d94dfdcb1c32144a9b2d30730644ec3ec083f25a37",
  },
  write: {
    version: "write-slides.v5",
    hash: "41b40e3776ad03f38e346ee686242c460012a9d610de2fb8e7a4e3a9936aa86e",
  },
  rewrite: {
    version: "write-slides.v5",
    hash: "852bddda07cb7c39e35c6265cb086730a0c95a501fc62e065de352904844bf60",
  },
};

describe("plan-write prompt versions", () => {
  test("each prompt's text is pinned to its version", () => {
    expect({
      plan: { version: PLAN_LESSON_VERSION, hash: hash(planLessonPrompt(PLAN_SAMPLE)) },
      write: { version: WRITE_SLIDES_VERSION, hash: hash(writeSlidesPrompt(WRITE_SAMPLE)) },
      rewrite: { version: WRITE_SLIDES_VERSION, hash: hash(writeSlidesPrompt(REWRITE_SAMPLE)) },
    }).toEqual(PINNED);
  });

  test("no timings, no word limits and no shortening (ruling 82, ruling 132)", () => {
    for (const p of [
      planLessonPrompt(PLAN_SAMPLE),
      writeSlidesPrompt(WRITE_SAMPLE),
      writeSlidesPrompt(REWRITE_SAMPLE),
    ]) {
      const text = `${p.system}\n${p.user}`;
      expect(text).not.toMatch(/shorten|too long|\bwords? (limit|max)|\bcharacters\b/i);
      expect(text.replace("no minutes or timings anywhere", "")).not.toMatch(/\bminutes?\b/i);
    }
  });

  test("the writer sees the whole table and only its own contracts", () => {
    const { user } = writeSlidesPrompt(WRITE_SAMPLE);
    expect(user).toContain("Write slides 3 and 4.");
    expect(user.match(/^\d+ [a-z]/gm)).toHaveLength(table.length);
    expect(user).toContain("Picture: an iceberg; shows ice above the water");
    expect(user).not.toContain(contractFor("hinge", "default"));
  });
});

describe("plan-lesson rows", () => {
  test("coded rows parse to the table, the title row added by code, and round-trip", () => {
    const wire = {
      misconception: "m",
      objectives: ["a", "b"],
      runningExample: "ice",
      slides: [
        "retrieve | starter-set | default | - | 2 | recall particles | - | -",
        "teach | explain | default | 1 | 2 | how particles sit in a solid | solid, fixed-place | -",
        "hinge | hinge | why | o1, 2 | 4 | which state is it | - | solid",
        "teach | explain",
      ],
    };
    const { plan, unreadable } = parsePlan(wire);
    expect(unreadable).toEqual([5]);
    expect(plan.slides).toHaveLength(5);
    expect(plan.slides[0]).toMatchObject({ form: "title", objectives: [1, 2], parts: 0 });
    expect(plan.slides[2]).toMatchObject({ teaches: ["solid", "fixed-place"], objectives: [1] });
    expect(plan.slides[3]).toMatchObject({ layout: "why", objectives: [1, 2], tests: ["solid"] });
    expect(parsePlan(toWire(plan)).plan.slides.slice(0, 4)).toEqual(plan.slides.slice(0, 4));
  });
});
