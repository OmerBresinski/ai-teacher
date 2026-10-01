import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import { type Lesson, OutlineEntrySchema } from "@tj/domain/documents";
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
  opts: { longHinge?: boolean; masterFixes?: unknown[] } = {},
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
    expect(lesson.slides[0]?.elements.some((e) => e.type === "image")).toBe(false);
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
      expect(lesson.slides[0]?.elements.some((e) => e.type === "image")).toBe(false);
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
      // No image search here: no slide keeps an empty picture frame.
      expect(lesson.slides.flatMap((sl) => sl.elements).filter((e) => e.type === "image")).toEqual(
        [],
      );
      expect(lesson.generation?.promptVersions.planned).toStartWith("stream-lesson.v20+");
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
