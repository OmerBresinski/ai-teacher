import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createAi, createBudget } from "@tj/ai";
import { jsonSchema, Output, streamText } from "ai";
import pino from "pino";
import { providerOptionsFor } from "../call";
import { WRITER_WORDS } from "../library/catalogue";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import type { PipelineDeps } from "../types";
import {
  aiWriterServices,
  lessonPartAt,
  WRITER_CACHE_KEY,
  writerProviderOptions,
  writerRoute,
  writerSystem,
} from "./ai-services";
import { PILOT_PACK_ID } from "./pilot-pack";
import { WRITER_EFFORT, WRITER_MODEL, type WriterReq, type WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * TEACH-202 part k: the writer call carries OpenAI's prompt cache options and a breakpoint on its
 * system message, and the text the model reads is byte-for-byte what it read before.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Part = { type: string; text: string; prompt_cache_breakpoint?: unknown };
type Body = {
  model: string;
  messages: { role: string; content: string | Part[] }[];
  response_format: unknown;
  prompt_cache_key?: string;
  prompt_cache_options?: unknown;
};

/** The real OpenAI provider with fetch replaced by a one-chunk stream: the body is what it sends. */
function capture(details: object = { cached_tokens: 13550 }) {
  const bodies: Body[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const chunk = (delta: object, finish: string | null, usage?: object) =>
      `data: ${JSON.stringify({
        id: "c",
        object: "chat.completion.chunk",
        created: 0,
        model: "m",
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...(usage ? { usage } : {}),
      })}\n\n`;
    const sse =
      chunk({ role: "assistant", content: "{}" }, null) +
      chunk({}, "stop", {
        prompt_tokens: 13757,
        completion_tokens: 1,
        total_tokens: 13758,
        prompt_tokens_details: details,
      }) +
      "data: [DONE]\n\n";
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  }) as never;
  const ai = createAi({ OPENAI_API_KEY: "sk-test" } as never, { route: writerRoute });
  const deps = {
    ai,
    budget: createBudget({ capUsd: 1, capTokens: 1e7 }),
    signal: new AbortController().signal,
    logger: pino({ level: "silent" }),
    context: { lessonId: "l", jobId: "j" },
  } as unknown as PipelineDeps;
  return { bodies, deps, ai };
}

/** Everything the model reads, in order: each message's role and text, then the schema. */
function promptBytes(b: Body): string {
  const text = (c: string | Part[]) =>
    typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).join("");
  return JSON.stringify([
    b.messages.map((m) => [m.role, text(m.content)]),
    b.response_format,
    b.model,
  ]);
}
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// A system text with the characters that break naive re-encoding: curly quotes, an en dash,
// emoji, a NUL-free control set, trailing whitespace and a blank last line.
const SYSTEM = `You're an expert teacher in England — design the lesson’s slides.\n\t“Quotes” – dash 🫀\n${"Rule. ".repeat(2000)}  \n`;
const USER = "Topic: The heart and circulatory system\nYear group: Year 6 (ks2)\n";
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: { title: { type: "string" } },
};

describe("the writer's prompt cache", () => {
  test("the request carries the cache key, explicit 30-minute caching and a system breakpoint", async () => {
    const { bodies, deps } = capture();
    const req = {
      model: WRITER_MODEL,
      effort: WRITER_EFFORT,
      system: SYSTEM,
      user: USER,
      schema: SCHEMA,
      name: "lesson" as const,
      maxTokens: 9000,
    };
    const result = await aiWriterServices(deps).writer(req, () => {});
    expect(result.text).toBe("{}");
    const b = bodies[0] as Body;
    expect(b.prompt_cache_key).toBe(WRITER_CACHE_KEY);
    expect(b.prompt_cache_options).toEqual({ mode: "explicit", ttl: "30m" });
    expect(b.messages[0]).toEqual({
      role: "system",
      content: [{ type: "text", text: SYSTEM, prompt_cache_breakpoint: { mode: "explicit" } }],
    });
    // The lesson's own turn stays last and unmarked: only the shared prefix is cached.
    expect(b.messages[1]).toEqual({ role: "user", content: USER });
    expect(b.messages).toHaveLength(2);
    // A cache hit is priced at the cached rate: 13 550 at $0.10, 207 at $2, 1 out at $10 per MTok.
    expect(result.usd).toBeCloseTo((13550 * 0.1 + 207 * 2 + 1 * 10) / 1e6, 10);
  });

  test("a miss is priced at the write rate for the prefix and the input rate for the tail", async () => {
    const { deps } = capture({ cached_tokens: 0, cache_write_tokens: 13550 });
    const result = await aiWriterServices(deps).writer(
      {
        model: WRITER_MODEL,
        effort: WRITER_EFFORT,
        system: SYSTEM,
        user: USER,
        schema: SCHEMA,
        name: "lesson",
        maxTokens: 9000,
      },
      () => {},
    );
    // 13 550 written at $2.50 (1.25x input), 207 at $2, 1 out at $10 per MTok.
    expect(result.usd).toBeCloseTo((13550 * 2.5 + 207 * 2 + 1 * 10) / 1e6, 10);
  });

  test("the prompt bytes are unchanged: sha256 before and after the cache plumbing", async () => {
    const { bodies, ai } = capture();
    const context = {
      lessonId: "l",
      jobId: "j",
      stage: "write",
      promptVersion: "lesson-writer.v1/lesson",
      effort: WRITER_EFFORT,
    };
    const send = async (after: boolean) => {
      const base = providerOptionsFor(WRITER_MODEL, WRITER_EFFORT, true).providerOptions as Record<
        string,
        Record<string, unknown>
      >;
      const result = streamText({
        model: ai.model("frontier", context),
        system: after ? writerSystem(SYSTEM) : SYSTEM,
        prompt: USER,
        output: Output.object({ schema: jsonSchema(SCHEMA as never), name: "lesson" }),
        maxOutputTokens: 9000,
        // Before: the options as the writer sent them until part k.
        ...(after
          ? writerProviderOptions(WRITER_MODEL, WRITER_EFFORT)
          : {
              providerOptions: {
                ...base,
                openai: { ...base.openai, systemMessageMode: "system" },
              },
            }),
      });
      for await (const _ of result.textStream);
    };
    await send(false);
    await send(true);
    const [before, after] = bodies as [Body, Body];
    expect(before.prompt_cache_key).toBeUndefined();
    expect(before.messages[0]).toEqual({ role: "system", content: SYSTEM });
    expect(after.prompt_cache_key).toBe(WRITER_CACHE_KEY);
    expect(sha256(promptBytes(after))).toBe(sha256(promptBytes(before)));
    // And the system text itself, exactly as given.
    const sys = after.messages[0]?.content as Part[];
    expect(sha256(sys.map((p) => p.text).join(""))).toBe(sha256(SYSTEM));
  });
});

/*
 * The cached prefix carries nothing of the lesson (genlab records 1 and 2, 26 Oct: every writer
 * call wrote ~20k tokens and read 0, because the schema held the lesson's menu ids and objectives
 * count and the breakpoint sat after the lesson's model menu).
 */
const MENU = `${WRITER_WORDS.header}\n- plant_growth, Reception-Y3: how a plant grows\n`;
const WITH_MENU = `Head rules.\n${WRITER_WORDS.menuLine}\n\n${MENU}\nFill shapes after the menu.\n`;

describe("the writer's cached prefix ends before the lesson's model menu", () => {
  test("the system text goes as a marked head and an unmarked menu, the same text in order", async () => {
    const { bodies, deps } = capture();
    await aiWriterServices(deps).writer(
      {
        model: WRITER_MODEL,
        effort: WRITER_EFFORT,
        system: WITH_MENU,
        user: USER,
        schema: SCHEMA,
        name: "lesson",
        maxTokens: 9000,
      },
      () => {},
    );
    const b = bodies[0] as Body;
    const at = lessonPartAt(WITH_MENU);
    expect(WITH_MENU.slice(at).startsWith(WRITER_WORDS.header)).toBe(true);
    expect(b.messages[0]).toEqual({
      role: "system",
      content: [
        {
          type: "text",
          text: WITH_MENU.slice(0, at),
          prompt_cache_breakpoint: { mode: "explicit" },
        },
      ],
    });
    expect(b.messages[1]).toEqual({ role: "system", content: WITH_MENU.slice(at) });
    expect(b.messages[2]).toEqual({ role: "user", content: USER });
    expect(b.messages).toHaveLength(3);
  });

  test("a system text with no Models list stays one marked message", () => {
    expect(lessonPartAt(SYSTEM)).toBe(-1);
    expect(writerSystem(SYSTEM)).toHaveLength(1);
  });

  /** The production writer request (pilot pack, library filtered and ranked) for one lesson. */
  async function prodRequest(yearGroup: string, ageBand: string, subject: string, objs: string[]) {
    let got: WriterReq | undefined;
    const services = {
      log: () => {},
      chat: async () => {
        throw new Error("no chat in this test");
      },
      writer: async (r: WriterReq) => {
        got = r;
        throw new Error("stop after the request");
      },
    } as unknown as WriterServices;
    const l = sampleBriefLesson({ yearGroup, ageBand, subject } as never);
    await runWriter({
      brief: writerBrief(l),
      objectives: objs,
      services,
      pilotPack: PILOT_PACK_ID,
      drawDiagrams: { callDrawer: async () => ({ out: undefined, usd: 0, ms: 0 }) },
      library: true,
      libraryMenuFilter: true,
      libraryMenuRank: true,
      libraryModelBody: true,
      libraryPanelsOff: true,
      checks: "log",
    } as never).catch(() => {});
    if (!got) throw new Error("no writer request");
    const head = writerSystem(got.system)[0]?.content as string;
    return { schema: JSON.stringify(got.schema), head, system: got.system };
  }

  test("two lessons at one key stage and length share the schema and the cached head", async () => {
    const a = await prodRequest("Year 1", "ks1", "Science", ["Name the parts of a plant."]);
    const b = await prodRequest("Year 2", "ks1", "Maths", [
      "Add two 2-digit numbers.",
      "Check with a number line.",
      "Explain the method.",
    ]);
    // The lessons' menus differ (year, subject, ranking) …
    expect(a.system).not.toBe(b.system);
    // … and the prefix the provider caches (schema, then the system head) is byte for byte one.
    expect(sha256(b.schema)).toBe(sha256(a.schema));
    expect(sha256(b.head)).toBe(sha256(a.head));
    expect(a.head.length).toBeGreaterThan(20000);
  });

  test("two KS3 lessons with different years, topics and objectives share the cached prefix", async () => {
    // The pair genlab ran 13 minutes apart on 27 Oct (Y9 rivers, then Y8 photosynthesis, subject
    // left blank) and the second read 0 cached tokens: the prefix our code sends was one.
    const a = await prodRequest("Year 9", "ks3", "", [
      "Describe how hydraulic action, abrasion, attrition and solution erode river channels.",
      "Explain how faster outer-bend flow and slower inner-bend flow form meanders.",
      "Explain how meander migration and neck cut-through form oxbow lakes.",
    ]);
    const b = await prodRequest("Year 8", "ks3", "", [
      "Describe photosynthesis using its word equation.",
      "Explain how broad, thin leaves and stomata help photosynthesis.",
    ]);
    expect(a.system).not.toBe(b.system);
    expect(sha256(b.schema)).toBe(sha256(a.schema));
    expect(sha256(b.head)).toBe(sha256(a.head));
    // Over the provider's 1,024-token floor many times over (~4 characters a token).
    expect(a.head.length).toBeGreaterThan(20000);
  });
});
