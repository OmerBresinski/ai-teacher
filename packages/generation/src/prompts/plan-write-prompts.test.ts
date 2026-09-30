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
import { STREAM_LESSON_VERSION, STREAM_SWAPS, streamLessonPrompt } from "./stream-lesson";
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
  row({ role: "objectives", form: "objectives", objectives: [1, 2], parts: 0 }),
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
  slideCount: 6,
  menu: planMenu(audience.subject),
  repair: {
    previous: { misconception: "m", objectives: ["o"], runningExample: "ice", slides: table },
    problems: ["The plan has 5 rows after the objectives slide; it must have exactly 4."],
  },
};
const { repair: _repair, ...STREAM_SAMPLE } = PLAN_SAMPLE;
const WRITE_SAMPLE: WriteSlidesInput = {
  topic: "States of matter",
  audience,
  objectives: ["Describe particles in a solid", "Explain why ice floats"],
  runningExample: "An ice cube melting in a glass",
  misconception: "Particles in a solid do not move; they vibrate in place.",
  table,
  slides: [4, 5].map((n) => {
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

const CHECK_SAMPLE: WriteSlidesInput = {
  ...WRITE_SAMPLE,
  rewrite: {
    slide: WRITE_SAMPLE.slides[0] as WriteSlidesInput["slides"][number],
    field: "notes",
    failure:
      'the notes do not state the answer the slide reveals ("they vibrate"); they give that answer first',
    current: { heading: "Particles in a solid", body: ["They vibrate."], notes: "Ask the class." },
    reason: "check",
  },
};

const RECHECK_SAMPLE: WriteSlidesInput = {
  ...WRITE_SAMPLE,
  slides: [],
  recheck: {
    slide: {
      number: 7,
      form: "hinge",
      layout: "default",
      contract: contractFor("hinge", "default"),
    },
    failure: "the text runs past the slide's safe area on 3 of 10 themes (chalk, sea, sun)",
    current: { stem: "Why does ice float?", options: [] },
    kinds: [
      { kind: "true-false", contract: contractFor("true-false", "default") },
      { kind: "check-set", contract: contractFor("check-set", "default") },
    ],
  },
};

const PINNED = {
  plan: {
    version: "plan-lesson.v12",
    hash: "6ddb83b7ea24cc2f799cfa2016c51be4fdd7fd9994887b68266889bb22fb90dd",
  },
  write: {
    version: "write-slides.v15",
    hash: "8a545e94b7e39aaca35b6da2d11a74c64412283176a715dfa61b1f77b5aca140",
  },
  stream: {
    version: "stream-lesson.v9",
    hash: "12f51f874dcce6ee3f663fb929d84980637092da324f04bd8cc0505c301fa2a6",
  },
  rewrite: {
    version: "write-slides.v15",
    hash: "45fbff071062d170eb695dced6b323c2c18b1a61c30ed03722944522cefbadf3",
  },
  recheck: {
    version: "write-slides.v15",
    hash: "aa69fd29bb54aee69474e99fe568430611c799385a36e7d3dac84260b5965244",
  },
  check: {
    version: "write-slides.v15",
    hash: "db4bad17f8778028b7aaf385852becf0b2a8c5df175843466376932cbc4cc4c1",
  },
};

describe("plan-write prompt versions", () => {
  test("each prompt's text is pinned to its version", () => {
    expect({
      plan: { version: PLAN_LESSON_VERSION, hash: hash(planLessonPrompt(PLAN_SAMPLE)) },
      write: { version: WRITE_SLIDES_VERSION, hash: hash(writeSlidesPrompt(WRITE_SAMPLE)) },
      stream: {
        version: STREAM_LESSON_VERSION,
        hash: hash(streamLessonPrompt(STREAM_SAMPLE)),
      },
      rewrite: { version: WRITE_SLIDES_VERSION, hash: hash(writeSlidesPrompt(REWRITE_SAMPLE)) },
      recheck: { version: WRITE_SLIDES_VERSION, hash: hash(writeSlidesPrompt(RECHECK_SAMPLE)) },
      check: { version: WRITE_SLIDES_VERSION, hash: hash(writeSlidesPrompt(CHECK_SAMPLE)) },
    }).toEqual(PINNED);
  });

  test("no timings, no word limits and no shortening (ruling 82, ruling 132)", () => {
    for (const p of [
      planLessonPrompt(PLAN_SAMPLE),
      writeSlidesPrompt(WRITE_SAMPLE),
      writeSlidesPrompt(REWRITE_SAMPLE),
      streamLessonPrompt(STREAM_SAMPLE),
    ]) {
      const text = `${p.system}\n${p.user}`;
      expect(text).not.toMatch(/shorten|too long|\bwords? (limit|max)|\bcharacters\b/i);
      expect(text.replace("no minutes or timings anywhere", "")).not.toMatch(/\bminutes?\b/i);
    }
  });

  test("stream-lesson.v5: every swap lands, and the frame survives the picture rule", () => {
    const { system } = streamLessonPrompt(STREAM_SAMPLE);
    for (const [from, to] of STREAM_SWAPS) {
      expect(system).toContain(to);
      if (!to.includes(from)) expect(system).not.toContain(from);
    }
    expect(system).not.toContain("The shape is yours to choose");
    expect(system.indexOf("a retrieve slide on the earlier learning")).toBeLessThan(
      system.indexOf("a teach slide is a photo or a diagram slot"),
    );
  });

  test("a check's re-write names the slide and field, the finding on its own line (write-slides.v11)", () => {
    const { user } = writeSlidesPrompt(CHECK_SAMPLE);
    expect(user).toContain(
      'Checking slide 4 found this in its notes:\nthe notes do not state the answer the slide reveals ("they vibrate"); they give that answer first\nWrite notes again with that put right',
    );
    expect(user).not.toContain("does not fit");
  });

  test("the writer sees the whole table and only its own contracts", () => {
    const { user } = writeSlidesPrompt(WRITE_SAMPLE);
    expect(user).toContain("Write slides 4 and 5.");
    expect(user.match(/^\d+ [a-z]/gm)).toHaveLength(table.length);
    expect(user).toContain("Picture: an iceberg; shows ice above the water");
    expect(user).not.toContain(contractFor("hinge", "default"));
  });
});

describe("plan-lesson rows", () => {
  test("coded rows parse to the table, the title and objectives rows added by code, and round-trip", () => {
    const wire = {
      misconception: "m",
      objectives: ["a", "b"],
      runningExample: "ice",
      titlePicture: { subject: "an iceberg", mustShow: ["ice above the water"] },
      slides: [
        "retrieve | starter-set | default | - | 2 | recall particles | - | -",
        "teach | explain | default | 1 | 2 | how particles sit in a solid | solid, fixed-place | -",
        "hinge | hinge | why | o1, 2 | 4 | which state is it | - | solid",
        "teach | explain",
      ],
    };
    const { plan, unreadable } = parsePlan(wire);
    expect(unreadable).toEqual([6]);
    expect(plan.slides).toHaveLength(6);
    expect(plan.slides[0]).toMatchObject({
      form: "title",
      parts: 0,
      imageBrief: { subject: "an iceberg", mustShow: ["ice above the water"] },
    });
    expect(plan.slides[1]).toMatchObject({ form: "objectives", objectives: [1, 2] });
    expect(plan.slides[3]).toMatchObject({ teaches: ["solid", "fixed-place"], objectives: [1] });
    expect(plan.slides[4]).toMatchObject({ layout: "why", objectives: [1, 2], tests: ["solid"] });
    expect(parsePlan(toWire(plan)).plan.slides.slice(0, 5)).toEqual(plan.slides.slice(0, 5));
  });
});
