import { afterEach, describe, expect, test } from "bun:test";
import { createAi, createBudget } from "@tj/ai";
import type { AgeBand, Lesson } from "@tj/domain/documents";
import pino from "pino";
import { sampleBriefLesson } from "../testing";
import type { PipelineDeps } from "../types";
import { writerRoute } from "../writer/ai-services";
import { writerBundle } from "../writer/bundle";
import { contractSystem } from "../writer/contract";
import { pupilWordLimit, type Stage } from "../writer/fixes";
import fixture from "../writer/fixtures/activities/y1-animals.json" with { type: "json" };
import type { ChatReq, WriterReq, WriterServices } from "../writer/services";
import { runWriter } from "../writer/stage";
import { writerObjectivesCall } from "./objectives";
import { stageOf, writerBrief } from "./write";

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

  test("a band the writer does not know throws instead of becoming ks3", () => {
    for (const band of ["ks6", "KS5", "constructor", "toString", ""]) {
      expect(() => stageOf(band)).toThrow(/no key stage for age band/);
    }
  });

  test("a Year 12 lesson's brief is ks5", () => {
    expect(writerBrief(year12()).keyStage).toBe("ks5");
    expect(writerBrief(year12()).year).toBe(12);
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
    await runWriter({ brief, objectives: fixture.objectives, services });
    const P = writerBundle();
    expect(writer?.system).toBe(contractSystem(P.systemKS3_5));
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
