import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import { type Lesson, OutlineEntrySchema } from "@tj/domain/documents";
import { recipeById } from "@tj/slides";
import { freshClosingWritten } from "../plan-write/closing";
import { inLessonQuestions, SIMILARITY_MAX, similarity } from "../plan-write/fresh-exit";
import { isPlanWriteStamp } from "../plan-write/steps";
import { romansLesson } from "../planner/testing";
import { type PlanSlide, toWire } from "../prompts/plan-lesson";
import type { WriteSlidesInput } from "../prompts/write-slides";
import { FIXTURES, recordingDeps } from "../testing";
import { runLessonPipeline } from "../workflow";
import { plannerOf } from "./objectives-first";

const json = (v: unknown) => JSON.stringify(v);
const row = (over: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  form: "explain",
  layout: "default",
  purpose: "teach it",
  parts: 1,
  teaches: [],
  tests: [],
  imageBrief: null,
  figureBrief: null,
  ...over,
});
const PLAN = {
  objectives: ["Explain why the Romans built forts", "Describe life in a fort"],
  runningExample: "Vindolanda",
  misconception: "Forts were only for fighting",
  slides: [
    row({
      role: "title",
      form: "title",
      objectives: [1, 2],
      imageBrief: { subject: "Hadrian's Wall fort ruins", mustShow: ["stone walls"] },
    }),
    row({ role: "objectives", form: "objectives", objectives: [1, 2] }),
    row({ role: "starter", form: "starter-set", parts: 2 }),
    row({ teaches: ["forts"] }),
    // Serves both objectives, so the hinge after it checks objective 1's teaching (checksToInsert).
    row({ objectives: [1, 2], teaches: ["life"] }),
    row({ role: "hinge", form: "hinge", parts: 4, tests: ["forts"] }),
    row({ objectives: [2], teaches: ["daily life"] }),
    // No exit slide: the exit ticket is on the worksheet (UX rulings 134–140); a closing check.
    row({
      role: "check",
      form: "check-set",
      objectives: [1, 2],
      parts: 2,
      tests: ["forts", "life"],
    }),
  ],
};
const IDEA =
  "Because the soldiers needed a safe and well defended place to live, train and store food while they guarded the frontier";
const LONG_HINGE = {
  stem: "Why did the Romans build forts along the frontier of their empire in Britain?",
  options: [
    { text: IDEA, correct: true },
    { text: `${IDEA} and trade`, correct: false },
    { text: `${IDEA} and pray`, correct: false },
    { text: `${IDEA} and farm`, correct: false },
  ],
  explanation: "Forts held soldiers who guarded the frontier.",
  notes: "Hinge.",
};
const LONG =
  "Soldiers in a Roman fort lived, ate, trained and slept together inside thick stone walls every day";
const ANSWERS: Record<string, unknown> = {
  "starter-set": {
    questions: [
      { question: "What is an empire?", answer: "Lands ruled by one ruler" },
      { question: "Who were the Celts?", answer: "People in Britain" },
    ],
    notes: "Retrieval.",
  },
  explain: {
    heading: "Forts guarded the frontier",
    body: [
      "The border: soldiers watched it from stone forts.",
      "Why: a fort held enough men to stop a raid.",
    ],
    notes: "Say it.",
  },
  hinge: {
    stem: "Why did the Romans build forts?",
    options: [
      { text: "To guard the border", correct: true },
      { text: "To store grain", correct: false },
      { text: "To hold markets", correct: false },
      { text: "To house the emperor", correct: false },
    ],
    explanation: "Forts held soldiers who guarded the frontier.",
    notes: "Hinge.",
  },
  "check-set": {
    questions: [
      { question: "What did soldiers watch from the forts?", answer: "The border" },
      { question: "What were the forts built from?", answer: "Stone" },
    ],
    notes: "The border; stone. Soldiers watched the border from stone forts.",
  },
};

/** The slides a writer call was asked for (and a re-write's field), read back from its user turn. */
function writerCallOf(text: string): WriteSlidesInput {
  const slides = [...text.matchAll(/^Slide (\d+): [^,]+, ([a-z-]+)(?: \(([a-z-]+)\))?$/gm)].map(
    (m) => ({
      number: Number(m[1]),
      form: m[2] as string,
      layout: m[3] ?? "default",
      contract: "",
    }),
  );
  const field = /Write (\S+) again/.exec(text)?.[1];
  const base = { topic: "", audience: {}, objectives: [], runningExample: "", misconception: "" };
  return {
    ...base,
    // One plan row per line ("1 title", "2 retrieve · …"): only the count is asserted.
    table: [...text.matchAll(/^\d+ [a-z]/gm)].map(() => ({}) as PlanSlide),
    slides,
    ...(field && slides[0]
      ? {
          rewrite: {
            slide: slides[0],
            field,
            failure: "",
            current: {},
            ...(/Checking slide \d+ found this in its/.test(text)
              ? { reason: "check" as const }
              : {}),
          },
        }
      : {}),
  };
}

function planWriteAi(
  calls: WriteSlidesInput[],
  opts: {
    longHinge?: boolean;
    masterFixes?: unknown[];
    exitItems?: unknown[];
    /** Round S: held until this resolves, to show the lesson is editable without the items. */
    exitGate?: () => Promise<void>;
  } = {},
) {
  const fallback: FakeScriptEntry = async (call: FakeCall) => {
    const version = call.context?.promptVersion ?? "";
    if (version.startsWith("check-input")) return json({ findings: [] });
    if (version.startsWith("plan-lesson")) return json(toWire(PLAN));
    if (version.startsWith("stream-lesson")) {
      const wire = toWire(PLAN);
      const kinds = ["starter-set", "explain", "explain", "hinge", "explain", "check-set"];
      return json({
        misconception: wire.misconception,
        objectives: wire.objectives,
        runningExample: wire.runningExample,
        titlePicture: wire.titlePicture,
        plan: wire.slides,
        slides: kinds.map((kind, i) =>
          i === 2
            ? { kind, ...(ANSWERS.explain as object), heading: LONG }
            : i === 3
              ? { kind, ...(ANSWERS.hinge as object), options: [] }
              : { kind, ...(ANSWERS[kind] as object) },
        ),
      });
    }
    if (version.startsWith("write-slides")) {
      const input = writerCallOf(call.promptText);
      calls.push(input);
      if (/as another check on the same idea/.test(call.promptText)) {
        return json({
          slide: {
            kind: "true-false",
            notes: "True: forts guarded the border.",
            statement: "Roman forts guarded the border",
            correct: true,
            explanation: "Soldiers watched the frontier from them.",
          },
        });
      }
      if (input.rewrite?.field === "options") return json({ options: LONG_HINGE.options });
      if (input.rewrite) return json({ [input.rewrite.field]: "Soldiers lived inside the fort" });
      return json(
        Object.fromEntries(
          input.slides.map((s) => [
            `slide${s.number}`,
            s.number === 5
              ? { ...(ANSWERS.explain as object), heading: LONG }
              : s.form === "hinge" && opts.longHinge
                ? LONG_HINGE
                : ANSWERS[s.form],
          ]),
        ),
      );
    }
    if (version.startsWith("master-check")) return json({ fixes: opts.masterFixes ?? [] });
    // Round Q: without items given, the exit-items call fails and round P's items stand in.
    if (version.startsWith("exit-items") && opts.exitItems) {
      await opts.exitGate?.();
      return json({ items: opts.exitItems });
    }
    if (version.startsWith("verify-facts")) return json({ corrections: [] });
    if (version.startsWith("evaluate")) return json({ findings: [] });
    if (version.startsWith("repair")) return json(FIXTURES.repair);
    throw new Error(`unexpected call: ${version}`);
  };
  return createFakeAi({ fallback, usage: { inputTokens: 1000, outputTokens: 400 } });
}

const lesson8 = (): Lesson => {
  const l = romansLesson();
  return { ...l, brief: { ...(l.brief as NonNullable<Lesson["brief"]>), slideCount: 8 } };
};

/** The stream's fixture: the model writes 8 and code adds the closing slide (ruling 141). */
const streamLesson = (): Lesson => {
  const l = romansLesson();
  return { ...l, brief: { ...(l.brief as NonNullable<Lesson["brief"]>), slideCount: 9 as 8 } };
};

/** Runs `fn` with PLAN_WRITE_MODE set (undefined: unset, the default). */
async function inMode<T>(mode: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env.PLAN_WRITE_MODE;
  if (mode === undefined) delete process.env.PLAN_WRITE_MODE;
  else process.env.PLAN_WRITE_MODE = mode;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.PLAN_WRITE_MODE;
    else process.env.PLAN_WRITE_MODE = before;
  }
}

const KINDS: Lesson["slides"][number]["kind"][] = [
  "title",
  "objectives",
  "starter",
  "content",
  "content",
  "multiple-choice",
  "content",
  // A check-set is drawn as the starter kind, tagged CHECK (pw6 withSetTag).
  "starter",
];

describe("plan-write (AI_LESSON_PLANNER=plan-write)", () => {
  test("one plan call, parallel writers, one re-write of the failing field, N slides saved in order", async () => {
    const calls: WriteSlidesInput[] = [];
    const deps = recordingDeps(planWriteAi(calls));
    const final = await inMode("plan-write", () =>
      runLessonPipeline({ lesson: lesson8() }, deps, { planner: "plan-write" }),
    );
    const lesson = final.lesson;
    expect(lesson.slides.map((s) => s.kind)).toEqual(KINDS);
    // The fixed slides (UX ruling 134): the title with its picture, then the objectives alone.
    // No photo search in these deps: the title stands alone, never beside an empty frame.
    // UX ruling 156: no photo means the theme's cover pattern, never a photograph.
    expect(
      lesson.slides[0]?.elements.some((e) => e.type === "image" && e.name !== "Cover pattern"),
    ).toBe(false);
    expect(JSON.stringify(lesson.slides[0]?.elements)).not.toContain("the Romans built forts");
    expect(JSON.stringify(lesson.slides[1]?.elements)).toContain("the Romans built forts");
    // The title's brief goes to its photo search only; the saved outline passes the domain schema.
    expect(lesson.facts?.outline[0]?.imageBrief).toBeUndefined();
    expect(OutlineEntrySchema.array().safeParse(lesson.facts?.outline).success).toBe(true);
    // The title alone is the first save.
    expect(deps.persisted[0]?.lesson.slides.map((s) => s.kind)).toEqual(["title"]);
    // Writers: two batches of 2–3 slides, each seeing the whole table; then one re-write.
    const writes = calls.filter((c) => !c.rewrite);
    expect(writes.map((c) => c.slides.map((s) => s.number))).toEqual([
      [3, 4, 5],
      [6, 7, 8],
    ]);
    for (const c of writes) expect(c.table).toHaveLength(8);
    const rewrites = calls.filter((c) => c.rewrite);
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]?.rewrite?.field).toBe("heading");
    expect(JSON.stringify(lesson.slides[4]?.elements)).toContain("Soldiers lived inside the fort");
    expect(isPlanWriteStamp(lesson.generation?.promptVersions.planned)).toBe(true);
    expect(plannerOf(lesson)).toBe("plan-write");
    expect(lesson.facts?.objectives.map((o) => o.text)).toEqual(PLAN.objectives);
    expect(lesson.facts?.retrieval).toHaveLength(2);
    expect(lesson.facts?.questions.filter((q) => q.use === "exit")).toHaveLength(0);
    expect(lesson.facts?.outline.map((e) => e.kind)[0]).toBe("title");
    // No fit flag: every slide fits after the re-write.
    expect(lesson.generation?.findings.filter((f) => f.check === "fit")).toEqual([]);
  });

  test("stops after the plan when asked: objectives and the table saved as planned", async () => {
    const deps = recordingDeps(planWriteAi([]));
    const final = await inMode("plan-write", () =>
      runLessonPipeline({ lesson: lesson8() }, deps, {
        planner: "plan-write",
        stopAfter: "planned",
      }),
    );
    expect(final.lesson.generation?.stage).toBe("planned");
    expect(final.lesson.facts?.slidePlan).toBeDefined();
    expect(final.lesson.slides).toHaveLength(1);
  });

  test("ruling 141's checkbox: the worksheet's exit questions on the closing slide, answers on reveal", async () => {
    await inMode(undefined, async () => {
      const ai = planWriteAi([]);
      const l = streamLesson();
      const on: Lesson = {
        ...l,
        brief: { ...(l.brief as NonNullable<Lesson["brief"]>), exitTicketOnSlides: true },
      };
      const final = await runLessonPipeline({ lesson: on }, recordingDeps(ai), {
        planner: "plan-write",
      });
      const lesson = final.lesson;
      // It replaces the reference slide: the same count, and still no model call for it.
      expect(lesson.slides.map((s) => s.kind)).toEqual([...KINDS, "exit-ticket"]);
      const close = lesson.slides.at(-1);
      const words = JSON.stringify(close?.elements);
      expect(words).not.toContain("Complete it on your worksheet.");
      const before = lesson.slides.slice(0, -1);
      const facts = lesson.facts as NonNullable<Lesson["facts"]>;
      const kept = (freshClosingWritten(facts, before)?.questions ?? []) as {
        question: string;
        answer: string;
      }[];
      expect(kept.length).toBeGreaterThan(0);
      // Fresh: none of them is, or is close to, a question the lesson asked before its close.
      const earlier = inLessonQuestions(before);
      for (const q of kept) {
        for (const e of earlier) expect(similarity(q.question, e)).toBeLessThan(SIMILARITY_MAX);
      }
      for (const q of kept) {
        expect(words).toContain(json(q.question).slice(1, -1));
        // The answer is on the slide, hidden until the first reveal step.
        const shown = close?.elements.find((e) => json(e).includes(json(q.answer).slice(1, -1)));
        expect(shown?.revealStep).toBe(1);
      }
    });
  });

  test("round Q: the model's exit items, checked, go to the closing slide and the worksheet's exit ticket", async () => {
    await inMode(undefined, async () => {
      const items = [
        {
          objective: 1,
          form: "apply",
          answer: "12 ÷ 4 = 3 in each group.",
          question: "Twelve pencils are put into four equal groups. How many are in each group?",
          wrongOptions: [],
        },
        {
          objective: 1,
          form: "multiple-choice",
          answer: "The parts must be equal.",
          question: "What must be true of the groups when you share fairly?",
          wrongOptions: ["They must be large.", "There must be two of them."],
        },
      ];
      const ai = planWriteAi([], { exitItems: items });
      const l = streamLesson();
      const on: Lesson = {
        ...l,
        brief: { ...(l.brief as NonNullable<Lesson["brief"]>), exitTicketOnSlides: true },
      };
      const final = await runLessonPipeline({ lesson: on }, recordingDeps(ai), {
        planner: "plan-write",
      });
      const lesson = final.lesson;
      const versions = ai.calls.map((c) => c.context?.promptVersion ?? "");
      // Round S: two items are short of three, so the set is asked for more (twice); this mock
      // answers the same each time, so the repeats are refused and the two stand.
      expect(versions.filter((v) => v.startsWith("exit-items"))).toHaveLength(3);
      const exit = (lesson.facts?.questions ?? []).filter((q) => q.use === "exit");
      expect(exit.map((q) => q.answer)).toEqual([
        "12 ÷ 4 = 3 in each group.",
        expect.stringMatching(/^\([ABC]\) The parts must be equal$/),
      ]);
      const words = JSON.stringify(lesson.slides.at(-1)?.elements);
      expect(words).toContain("Twelve pencils are put into four equal groups.");
      const sheet = recipeById("exit-ticket")?.build(lesson.facts) ?? [];
      expect(JSON.stringify(sheet)).toContain("Twelve pencils");
    });
  });

  test("round S: the lesson is editable before the exit items land; they are drawn in place after", async () => {
    await inMode(undefined, async () => {
      const items = [
        {
          objective: 1,
          form: "apply",
          answer: "12 ÷ 4 = 3 in each group.",
          question: "Twelve pencils are put into four equal groups. How many are in each group?",
          wrongOptions: [],
        },
      ];
      let deps: ReturnType<typeof recordingDeps> | undefined;
      let editableFirst = false;
      // The exit-items call answers only once "Slides ready" is out: were the editable save to
      // wait for it, this would never come and the call gives up after 2 s.
      const exitGate = async () => {
        for (let i = 0; i < 200; i++) {
          if (deps?.progress.some((p) => p.message === "Slides ready")) {
            editableFirst = true;
            return;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      const ai = planWriteAi([], { exitItems: items, exitGate });
      deps = recordingDeps(ai);
      const l = streamLesson();
      const on: Lesson = {
        ...l,
        brief: { ...(l.brief as NonNullable<Lesson["brief"]>), exitTicketOnSlides: true },
      };
      const final = await runLessonPipeline({ lesson: on }, deps, { planner: "plan-write" });
      expect(editableFirst).toBe(true);
      // The editable save already had its close (round P's items), at the same slide count.
      const ready = deps.progress.findIndex((p) => p.message === "Slides ready");
      const atReady = deps.persisted.find(
        (x) => x.updatedAt === deps?.progress[ready]?.documentUpdatedAt,
      );
      expect(atReady?.lesson.slides.length).toBe(final.lesson.slides.length);
      expect(JSON.stringify(atReady?.lesson.slides.at(-1)?.elements)).not.toContain(
        "Twelve pencils",
      );
      // Then the model's items, in place: same slide id, on the slide and in the worksheet's facts.
      const close = final.lesson.slides.at(-1);
      expect(close?.id).toBe(atReady?.lesson.slides.at(-1)?.id as string);
      expect(JSON.stringify(close?.elements)).toContain("Twelve pencils");
      const exit = (final.lesson.facts?.questions ?? []).filter((q) => q.use === "exit");
      expect(exit.map((q) => q.answer)).toEqual(["12 ÷ 4 = 3 in each group."]);
    });
  });

  test("the stream by default: one call plans and writes; a slide that fails its schema goes to a writer", async () => {
    await inMode(undefined, async () => {
      const calls: WriteSlidesInput[] = [];
      const ai = planWriteAi(calls);
      const deps = recordingDeps(ai);
      const final = await runLessonPipeline({ lesson: streamLesson() }, deps, {
        planner: "plan-write",
      });
      const lesson = final.lesson;
      const versions = ai.calls.map((c) => c.context?.promptVersion ?? "");
      expect(versions.filter((v) => v.startsWith("plan-lesson"))).toEqual([]);
      expect(versions.filter((v) => v.startsWith("stream-lesson"))).toHaveLength(1);
      expect(lesson.slides.map((s) => s.kind)).toEqual([...KINDS, "plenary"]);
      // Ruling 141: the closing slide is code's, after the practise slide, with no model call.
      const close = JSON.stringify(lesson.slides.at(-1)?.elements);
      expect(close).toContain("Exit ticket");
      expect(close).toContain("Complete it on your worksheet.");
      expect(close).toMatch(/\d questions?, on your own/);
      // No photo search in these deps: the title stands alone, never beside an empty frame.
      // UX ruling 156: no photo means the theme's cover pattern, never a photograph.
      expect(
        lesson.slides[0]?.elements.some((e) => e.type === "image" && e.name !== "Cover pattern"),
      ).toBe(false);
      // Slide 6's hinge had no options: written again by a writer; slide 5's heading re-written.
      expect(calls.filter((c) => !c.rewrite).map((c) => c.slides.map((s) => s.number))).toEqual([
        [6],
      ]);
      // The fit re-write; the per-slide check's answer-key re-writes are named "check".
      expect(
        calls.filter((c) => c.rewrite && c.rewrite.reason !== "check").map((c) => c.rewrite?.field),
      ).toEqual(["heading"]);
      expect(
        calls
          .filter((c) => c.rewrite?.reason === "check")
          .every((c) => c.rewrite?.field === "notes"),
      ).toBe(true);
      // Each slide was checked as it closed: Evaluate ran per slide, Repair made no call.
      expect(versions.filter((v) => v.startsWith("repair."))).toEqual([]);
      expect(final.checkedPerSlide).toBe(true);
      // No image search here: no slide keeps an empty picture frame (the cover's pattern is art).
      expect(
        lesson.slides
          .flatMap((sl) => sl.elements)
          .filter((e) => e.type === "image" && e.name !== "Cover pattern"),
      ).toEqual([]);
      expect(lesson.generation?.promptVersions.planned).toStartWith("stream-lesson.v24+");
      expect(plannerOf(lesson)).toBe("plan-write");
      expect(lesson.facts?.objectives.map((o) => o.text)).toEqual(PLAN.objectives);
      // Saves: the title, the header (title with objectives), then the slides in order.
      const counts = deps.persisted.map((p) => p.lesson.slides.length);
      expect(counts[0]).toBe(1);
      expect(counts).toEqual([...counts].sort((a, b) => a - b));
    });
  });

  test("the stream's master check reads the whole lesson once; its fixes go through the named-field re-write", async () => {
    await inMode(undefined, async () => {
      const calls: WriteSlidesInput[] = [];
      const ai = planWriteAi(calls, {
        masterFixes: [
          { slide: 7, field: "heading", kind: "join", problem: "Does not follow slide 6." },
          { slide: 1, field: "title", kind: "duplicate", problem: "The title is fixed." },
          { slide: 4, field: "nope", kind: "contradiction", problem: "No such field." },
        ],
      });
      const final = await runLessonPipeline({ lesson: streamLesson() }, recordingDeps(ai), {
        planner: "plan-write",
      });
      const prompts = ai.calls.filter((c) => c.context?.promptVersion?.startsWith("master-check"));
      expect(prompts).toHaveLength(1);
      // The checker sees every slide, the title and objectives marked fixed.
      expect(prompts[0]?.promptText).toContain("Fixed slides: 1, 2");
      expect(prompts[0]?.promptText).toContain("Slide 8 (");
      const master = ai.calls.filter((c) =>
        c.promptText.includes("Reading the whole lesson found this (join)"),
      );
      expect(master).toHaveLength(1);
      expect(
        calls.filter((c) => c.rewrite?.field === "title" || c.rewrite?.field === "nope"),
      ).toEqual([]);
      expect(JSON.stringify(final.lesson.slides[6]?.elements)).toContain(
        "Soldiers lived inside the fort",
      );
    });
  });

  test("a hinge that does not fit after its re-write is re-planned once as another check, never split", async () => {
    const calls: WriteSlidesInput[] = [];
    const deps = recordingDeps(planWriteAi(calls, { longHinge: true }));
    const final = await inMode("plan-write", () =>
      runLessonPipeline({ lesson: lesson8() }, deps, { planner: "plan-write" }),
    );
    const lesson = final.lesson;
    expect(lesson.slides).toHaveLength(8);
    expect(lesson.slides[5]?.kind).toBe("true-false");
    expect(calls.filter((c) => c.rewrite?.field === "options")).toHaveLength(1);
    expect(lesson.facts?.questions.some((q) => q.stem === "Roman forts guarded the border")).toBe(
      true,
    );
  });
});
