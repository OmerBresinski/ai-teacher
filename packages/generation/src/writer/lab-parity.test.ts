import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAi, createBudget } from "@tj/ai";
import { openaiSchemaFaults } from "@tj/slides/diagrams";
import pino from "pino";
import { catalogue, libSchema } from "../library/catalogue";
import { checkObjectives } from "../objectives-check";
import { SET_JUDGE_JSON_SCHEMA, SET_JUDGE_SYSTEM } from "../prompts/set-judge";
import { WRITER_OBJECTIVES, writerObjectivesCall } from "../stages/objectives";
import { directedSetJudges } from "../stages/picture-set";
import { shapeOf } from "../stages/shared";
import { sampleBriefLesson } from "../testing";
import type { PipelineDeps } from "../types";
import {
  aiWriterServices,
  chatCallOptions,
  writerProviderOptions,
  writerRoute,
} from "./ai-services";
import { writerBundle } from "./bundle";
import { schemaText } from "./schema";

/*
 * TEACH-110 part f: the writer path sends what base4f-p123 sent. The objectives call runs the
 * bundle's pinned objectives prompt on Sol, low, strict, capped at 3000; the writer, repair and
 * notes calls are strict, and every schema they send is one OpenAI's strict mode accepts.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Deps on the real OpenAI provider with fetch replaced: the request body is what would be sent. */
function capture(answer: string) {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [
        { index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" },
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
  return { bodies, deps };
}

describe("writer objectives call", () => {
  test("sends the bundle's objectives prompt on Sol, low, strict, as the lab did", async () => {
    const { bodies, deps } = capture(
      JSON.stringify({ objectives: ["Explain why leaves are green."] }),
    );
    const got = await writerObjectivesCall(sampleBriefLesson(), deps);
    expect(got).toEqual([{ text: "Explain why leaves are green." }]);
    const P = writerBundle();
    const b = bodies[0] as {
      model: string;
      reasoning_effort: string;
      max_completion_tokens: number;
      messages: { role: string; content: string }[];
      response_format: { json_schema: { name: string; strict: boolean; schema: unknown } };
    };
    expect(b.model).toBe("gpt-6.1-sol");
    expect(b.reasoning_effort).toBe("low");
    expect(b.max_completion_tokens).toBe(WRITER_OBJECTIVES.maxTokens);
    expect(b.messages[0]).toEqual({ role: "system", content: P.objectives });
    expect(b.messages[1]?.content).toStartWith("Topic: ");
    expect(b.messages[1]?.content).not.toContain("{{");
    expect(b.response_format.json_schema).toEqual({
      name: "objectives",
      strict: true,
      schema: JSON.parse(P.objectivesSchema),
    });
  });

  test("production's check accepts every objective set the lab's evidence ran on", () => {
    const dir = join(import.meta.dir, "fixtures/replay");
    const lesson = sampleBriefLesson();
    for (const b of readdirSync(dir)) {
      const o = JSON.parse(readFileSync(join(dir, b, "objectives.json"), "utf8")) as {
        objectives: { teacher: string }[];
      };
      const set = o.objectives.map((x) => ({ text: x.teacher }));
      const check = checkObjectives(set, shapeOf(lesson).verb, { hasSource: false });
      // `too-long` is editorial in the step (logged, kept), so it never blocks a set.
      expect({ b, issues: check.issues.filter((i) => i.kind !== "too-long") }).toEqual({
        b,
        issues: [],
      });
    }
  });
});

describe("strict JSON on the writer path", () => {
  test("the writer, repair and notes calls ask for strict JSON and a system message", () => {
    const w = writerProviderOptions("openai/gpt-6.1-sol", "low").providerOptions?.openai;
    expect(w).toMatchObject({ strictJsonSchema: true, systemMessageMode: "system" });
    const signal = new AbortController().signal;
    const base = { model: "gpt-6-luna", system: "s", user: "u", schema: {} };
    const strict = chatCallOptions({ ...base, name: "slide", strict: true }, signal);
    expect(strict.providerOptions?.openai).toMatchObject({ strictJsonSchema: true });
    // The drawer and the objective repair stay non-strict, as the lab ran them.
    const loose = chatCallOptions({ ...base, name: "diagram", strict: false }, signal);
    expect(loose.providerOptions?.openai).toMatchObject({ strictJsonSchema: false });
  });

  test("a Sol-named small call runs on Sol; every other on Luna", async () => {
    const { bodies, deps } = capture("{}");
    const s = aiWriterServices(deps);
    const req = { system: "s", user: "u", schema: { type: "object" }, name: "x" };
    await s.chat({ ...req, model: "gpt-6.1-sol" });
    await s.chat({ ...req, model: "gpt-6-luna" });
    expect(bodies.map((b) => b.model)).toEqual(["gpt-6.1-sol", "gpt-6-luna"]);
  });

  test.each(["KS1", "KS2", "KS3-5"] as const)(
    "every schema the strict calls send is strict-valid at %s, the library's included",
    async (st) => {
      const P = writerBundle();
      const models = await catalogue(st);
      const writer = libSchema(
        JSON.parse(schemaText(st, { min: 9, max: 12 }, P)),
        models.map((m) => m.id),
      );
      const repair =
        st === "KS1" ? P.repairSchemaKS1 : st === "KS2" ? P.repairSchemaKS2 : P.repairSchemaKS3_5;
      for (const schema of [
        writer,
        JSON.parse(repair),
        JSON.parse(P.notesSchema),
        JSON.parse(P.objectivesSchema),
      ])
        expect(openaiSchemaFaults(schema, true)).toEqual([]);
    },
  );
});

describe("set judge request", () => {
  test("sends the lab's request: system message, low-detail panels, set_judge, its schema, strict", async () => {
    const { bodies, deps } = capture(JSON.stringify({ same: true, odd: [], why: "same calf" }));
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const v = await directedSetJudges(sampleBriefLesson(), deps).judgeSet(
      ["a calf", "a cow"],
      [png, png],
    );
    expect(v).toEqual({ same: true, odd: [], why: "same calf" });
    const b = bodies[0] as Record<string, unknown>;
    expect(b.model).toBe("gpt-6-luna");
    expect(b.reasoning_effort).toBe("low");
    expect(b.max_completion_tokens).toBe(2000);
    expect(b.messages).toEqual([
      { role: "system", content: SET_JUDGE_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Panel 1: a calf\nPanel 2: a cow" },
          { type: "image_url", image_url: { url: png, detail: "low" } },
          { type: "image_url", image_url: { url: png, detail: "low" } },
        ],
      },
    ]);
    expect(b.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "set_judge", strict: true, schema: SET_JUDGE_JSON_SCHEMA },
    });
  });
});

test("the repair's layouts menu is the one the lab's repair calls sent (room in characters)", () => {
  const P = writerBundle();
  for (const m of [P.repairLayoutsKS1, P.repairLayoutsKS2, P.repairLayoutsKS3_5])
    expect(m).toMatch(/^Layouts\. A heading is up to \d+ characters\./);
});
