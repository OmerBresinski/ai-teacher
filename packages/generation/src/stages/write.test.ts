import { afterEach, describe, expect, test } from "bun:test";
import { createAi, createBudget } from "@tj/ai";
import { type AgeBand, deriveAgeBand, type Lesson } from "@tj/domain/documents";
import pino from "pino";
import { sampleBriefLesson } from "../testing";
import type { PipelineDeps } from "../types";
import { withActivityMenu } from "../writer/activities";
import { writerRoute } from "../writer/ai-services";
import { writerBundle } from "../writer/bundle";
import { contractSystem } from "../writer/contract";
import { promptStage, pupilWordLimit, type Stage } from "../writer/fixes";
import fixture from "../writer/fixtures/activities/y1-animals.json" with { type: "json" };
import type { ChatReq, WriterReq, WriterServices } from "../writer/services";
import { runWriter } from "../writer/stage";
import { writerObjectivesCall } from "./objectives";
import { slideRange, stageOf, withQueuedWorksheet, writerBrief, writtenTitle } from "./write";

/*
 * Sixth-form lessons carry `ageBand: "post16"` (`deriveAgeBand`, Years 12–13). The writer used
 * to read any band that was not ks1–ks5 as KS3, so a Year 12 lesson was written as "Year 12 (ks3)".
 */

const year12 = (): Lesson =>
  sampleBriefLesson({ yearGroup: "Year 12", ageBand: "post16", readingLevel: "Year 12" });

describe("the writer's key stage", () => {
  test("every age band maps to its key stage; post16 is ks5 and eyfs ks1", () => {
    const want: Record<AgeBand, Stage> = {
      eyfs: "ks1",
      ks1: "ks1",
      ks2: "ks2",
      ks3: "ks3",
      ks4: "ks4",
      post16: "ks5",
    };
    for (const [band, stage] of Object.entries(want)) expect(stageOf(band)).toBe(stage);
  });

  test("no band: the year group's band, else ks3", () => {
    expect(stageOf(undefined, "Year 13")).toBe("ks5");
    expect(stageOf(undefined, "Year 4")).toBe("ks2");
    expect(stageOf(undefined, "Mixed")).toBe("ks3");
    expect(stageOf(undefined)).toBe("ks3");
  });

  test("every intake year reaches its writer bundle: Years 1-2 KS1, 12-13 KS5", () => {
    const want: Record<string, Stage> = {
      "Year 1": "ks1",
      "Year 2": "ks1",
      "Year 3": "ks2",
      "Year 6": "ks2",
      "Year 7": "ks3",
      "Year 9": "ks3",
      "Year 10": "ks4",
      "Year 11": "ks4",
      "Year 12": "ks5",
      "Year 13": "ks5",
    };
    for (const [yearGroup, stage] of Object.entries(want)) {
      // As `createLesson` stores it, and as a lesson with no band reads it.
      expect(stageOf(deriveAgeBand(yearGroup), yearGroup)).toBe(stage);
      expect(stageOf(undefined, yearGroup)).toBe(stage);
    }
    expect(promptStage(stageOf(undefined, "Year 1"))).toBe("KS1");
    expect(promptStage(stageOf(undefined, "Year 2"))).toBe("KS1");
    expect(promptStage(stageOf(undefined, "Year 12"))).toBe("KS3-5");
    expect(writerBrief(sampleBriefLesson({ yearGroup: "Year 12" })).year).toBe(12);
    expect(writerBrief(sampleBriefLesson({ yearGroup: "Year 1" })).year).toBe(1);
  });

  test("a band the writer does not know throws instead of becoming ks3", () => {
    for (const band of ["ks6", "KS5", "constructor", "toString", ""]) {
      expect(() => stageOf(band)).toThrow(/no key stage for age band/);
    }
  });

  test("a Year 12 lesson's brief is ks5", () => {
    expect(writerBrief(year12()).keyStage).toBe("ks5");
    expect(writerBrief(year12()).year).toBe(12);
  });

  test("ruling 201: the exit ticket is on the slides unless a worksheet was queued", () => {
    const withWorksheet = (worksheet: boolean | undefined): Lesson => {
      const lesson = year12();
      return { ...lesson, brief: { topic: "Memory", durationMin: 60, worksheet } };
    };
    expect(writerBrief(withWorksheet(true)).exitTicketOnSlides).toBe(false);
    expect(writerBrief(withWorksheet(false)).exitTicketOnSlides).toBe(true);
    // A lesson confirmed before the field existed had no worksheet queued with it.
    expect(writerBrief(withWorksheet(undefined)).exitTicketOnSlides).toBe(true);
  });

  describe("ruling 201: the worksheet flag holds only when its job was created", () => {
    const asked = (): Lesson => ({
      ...year12(),
      brief: { topic: "Memory", durationMin: 60, worksheet: true },
    });
    const deps = (queued?: boolean) => {
      const calls: number[] = [];
      const d = {
        logger: pino({ level: "silent" }),
        ...(queued === undefined
          ? {}
          : {
              worksheetQueued: async () => {
                calls.push(1);
                return queued;
              },
            }),
      } as unknown as PipelineDeps;
      return { d, calls };
    };

    test("the worksheet request failed: the exit ticket goes on the slides", async () => {
      const lesson = await withQueuedWorksheet(asked(), deps(false).d);
      expect(lesson.brief?.worksheet).toBe(false);
      expect(writerBrief(lesson).exitTicketOnSlides).toBe(true);
    });

    test("the worksheet job exists: the exit ticket stays on the worksheet", async () => {
      const lesson = await withQueuedWorksheet(asked(), deps(true).d);
      expect(lesson.brief?.worksheet).toBe(true);
      expect(writerBrief(lesson).exitTicketOnSlides).toBe(false);
    });

    test("no worksheet asked for: nothing is looked up", async () => {
      const { d, calls } = deps(true);
      const none = { ...asked(), brief: { topic: "Memory", durationMin: 60, worksheet: false } };
      expect(await withQueuedWorksheet(none, d)).toBe(none);
      expect(calls).toEqual([]);
    });
  });
});

describe("a Year 12 lesson's requests", () => {
  test("the writer and pupil-wording requests say ks5 and use the KS3-5 limits", async () => {
    const brief = writerBrief(year12());
    let writer: WriterReq | undefined;
    const chats: ChatReq[] = [];
    const services: WriterServices = {
      log: () => {},
      writer: async (req) => {
        writer = req;
        return { text: JSON.stringify(fixture.main), usd: 0, ms: 1, finishReason: "stop" } as never;
      },
      chat: async (req) => {
        chats.push(req);
        throw new Error("no answers in this run");
      },
    };
    // The fixture predates `close` (TEACH-110 part ab): its exit ticket is on the worksheet.
    await runWriter({
      brief: { ...brief, exitTicketOnSlides: false },
      objectives: fixture.objectives,
      services,
    });
    const P = writerBundle();
    // Activities are on by default (TEACH-101 part e): the KS3-5 text carries the KS3-5 menu.
    expect(writer?.system).toBe(withActivityMenu(contractSystem(P.systemKS3_5), "KS3-5"));
    expect(writer?.user).toContain("Year group: Year 12 (ks5)");
    expect(writer?.user).not.toContain("(ks3)");
    const pupil = chats.find((c) => c.name === "pupil_objectives");
    expect(pupil?.user).toContain("Year group: Year 12 (ks5)");
    expect(pupil?.user).toContain(
      `Word limit per line: ${pupilWordLimit("ks5", fixture.objectives.length)}`,
    );
  });

  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("the objectives request says ks5", async () => {
    const bodies: { messages: { content: string }[] }[] = [];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return Response.json({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify({ objectives: ["Explain."] }) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as never;
    const deps = {
      ai: createAi({ OPENAI_API_KEY: "sk-test" } as never, { route: writerRoute }),
      budget: createBudget({ capUsd: 1, capTokens: 1e7 }),
      signal: new AbortController().signal,
      logger: pino({ level: "silent" }),
      context: { lessonId: "l", jobId: "j" },
    } as unknown as PipelineDeps;
    await writerObjectivesCall(year12(), deps);
    const user = bodies[0]?.messages[1]?.content ?? "";
    expect(user).toContain("Year group: Year 12 (ks5)");
    expect(user).not.toContain("(ks3)");
  });
});

describe("the lesson's title after the writer", () => {
  const brief = "Year 6 Science. Topic: The heart and circulatory system. 60-minute lesson.";
  const created = (): Lesson => {
    const lesson = sampleBriefLesson({ yearGroup: "Year 6" });
    return { ...lesson, title: brief, brief: { ...lesson.brief, topic: brief } } as Lesson;
  };

  test("a title still from the brief becomes the title slide's heading", () => {
    expect(writtenTitle(created(), "The heart and circulatory system")).toBe(
      "The heart and circulatory system",
    );
  });

  test("a long brief cut to the title limit still counts as the brief's title", () => {
    const long = `${"Photosynthesis in green plants and why it matters ".repeat(3)}`;
    const lesson = created();
    const withLong = {
      ...lesson,
      title: long.trim().slice(0, 80),
      brief: { ...lesson.brief, topic: long },
    } as Lesson;
    expect(writtenTitle(withLong, "Photosynthesis")).toBe("Photosynthesis");
  });

  test("a title the teacher changed is kept", () => {
    const lesson = { ...created(), title: "Our hearts" };
    expect(writtenTitle(lesson, "The heart and circulatory system")).toBe("Our hearts");
  });

  test("an empty or missing heading keeps the title", () => {
    expect(writtenTitle(created(), "  ")).toBe(brief);
    expect(writtenTitle(created(), undefined)).toBe(brief);
  });

  test("the heading is trimmed, its whitespace collapsed and cut to the title limit", () => {
    expect(writtenTitle(created(), "  The   heart\n")).toBe("The heart");
    expect(writtenTitle(created(), "x".repeat(120))).toHaveLength(80);
  });
});

// Ruling 261 (TEACH-110 part ae): the writer plans near a range's low end, so the schema's maximum
// must leave room for a split to add one or two slides; an exact count stays exact.
describe("the slide range leaves room for splits", () => {
  for (const slideTier of ["quick", "standard", "detailed"] as const)
    test(`${slideTier}: a plan at the minimum may add two slides`, () => {
      const r = slideRange({ slideTier });
      expect(r.min + 2).toBeLessThanOrEqual(r.max);
    });
  test("an exact slide count is not a range", () => {
    expect(slideRange({ slideCount: 10 })).toEqual({ min: 10, max: 10 });
  });
});
