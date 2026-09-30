import { describe, expect, test } from "bun:test";
import { contractFor, planMenu } from "../plan-write/menu";
import { audienceOf } from "../stages/shared";
import { sampleBriefLesson } from "../testing";
import {
  PLAN_LESSON_VERSION,
  type PlanLessonInput,
  type PlanSlide,
  planLessonPrompt,
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
    problems: ["The table has 6 slides; it must have exactly 5, the title included."],
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
    version: "plan-lesson.v1",
    hash: "3f0eebaee63f9d2cfe398aa9b182c9a4479fcb59e131fad61e2b6638c499ec7a",
  },
  write: {
    version: "write-slides.v1",
    hash: "eeca7d1a337fc2533f91895319448ca4fad7a346f8263a1db2ef7752a9bdc1ae",
  },
  rewrite: {
    version: "write-slides.v1",
    hash: "da7b3ebb517d0e13e70ee10caf70ddf4839f9f0b2417b33b5d7ade291d71d2ad",
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
