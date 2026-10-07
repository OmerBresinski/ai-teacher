import { describe, expect, test } from "bun:test";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { lessonFromBrief, localeFor } from "@tj/domain/documents";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { z } from "zod";
import { callStructured } from "./call";
import { PROMPTS } from "./prompts";
import { type Audience, audienceBlock, localiseSystem } from "./prompts/shared";
import { audienceOf } from "./stages/shared";

/*
 * TEACH-33 part b (ruling 183): the lesson's country reaches the request the model is sent, and
 * England's requests are byte-for-byte what they were.
 */

const now = new Date("2026-10-07T10:00:00Z");
const brief = { brief: { topic: "Money: making amounts" }, yearGroup: "Year 5" } as const;

describe("localiseSystem", () => {
  test("England and the other UK nations: every system prompt is unchanged", () => {
    for (const country of ["england", "wales", "scotland", "northern-ireland"] as const) {
      for (const prompt of Object.values(PROMPTS)) {
        expect(localiseSystem(prompt.system, localeFor(country))).toBe(prompt.system);
      }
    }
    expect(localiseSystem(PROMPTS["plan-skeleton"].system, undefined)).toBe(
      PROMPTS["plan-skeleton"].system,
    );
  });

  test("India: the teacher and the spelling are substituted, nothing else", () => {
    const system = PROMPTS["plan-skeleton"].system;
    const india = localiseSystem(system, localeFor("india"));
    expect(india).toContain("You are an experienced Indian teacher planning one lesson");
    expect(india).toContain("Write in Indian English spelling and conventions.");
    expect(india).not.toContain("British English");
    expect(india).not.toContain("UK teacher");
    expect(
      india
        .replaceAll("Indian English", "British English")
        .replaceAll("Indian teacher", "UK teacher"),
    ).toBe(system);
  });

  test("no production system prompt keeps a UK token for a non-UK country", () => {
    for (const country of ["ireland", "india", "usa", "australia"] as const) {
      for (const prompt of Object.values(PROMPTS)) {
        const text = localiseSystem(prompt.system, localeFor(country));
        expect(text).not.toContain("British English");
        expect(text).not.toContain("UK teacher");
      }
    }
  });
});

describe("audienceBlock", () => {
  test("England: no country lines (the brief reads as before)", () => {
    const block = audienceBlock(audienceOf(lessonFromBrief(brief, "l1", now)));
    expect(block).toBe(
      [
        "Subject: not given",
        "Year group: Year 5 (ks2)",
        "Reading level: Year 5",
        "Language: en-GB",
      ].join("\n"),
    );
  });

  test("India: language, currency and units under the year group", () => {
    const block = audienceBlock(audienceOf(lessonFromBrief(brief, "l1", now, "india")));
    expect(block).toContain("Language: en-IN");
    expect(block).toContain("Country: India");
    expect(block).toContain("Currency: ₹ (rupees and paise)");
    expect(block).toContain("Units: metric");
  });

  test("USA: dollars and US customary units", () => {
    const block = audienceBlock({ country: "usa", language: "en-US" });
    expect(block).toContain("Currency: $ (dollars and cents)");
    expect(block).toContain("Units: US customary");
  });
});

describe("the compiled request", () => {
  function capturingAi() {
    const sent: { system: string; user: string }[] = [];
    const ai = createFakeAi();
    ai.model = () =>
      new MockLanguageModelV4({
        doGenerate: async (options) => {
          const text = (role: string) =>
            options.prompt
              .filter((m) => m.role === role)
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : m.content.map((p) => ("text" in p ? p.text : "")).join(""),
              )
              .join("\n");
          sent.push({ system: text("system"), user: text("user") });
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
            warnings: [],
          };
        },
      });
    return { ai, sent };
  }

  async function compile(country: "england" | "india") {
    const lesson = lessonFromBrief(brief, "l1", now, country);
    const { ai, sent } = capturingAi();
    await callStructured({
      deps: {
        ai,
        budget: createBudget({ capUsd: 1, capTokens: 1_000_000 }),
        signal: new AbortController().signal,
        logger: pino({ level: "silent" }),
        context: { lessonId: lesson.id, jobId: "j1" },
        locale: localeFor(lesson.country),
      },
      stage: "plan",
      cls: "standard",
      effort: "low",
      prompt: {
        version: "plan-skeleton.v22",
        system: PROMPTS["plan-skeleton"].system,
        user: (a: Audience) => audienceBlock(a),
      },
      input: audienceOf(lesson),
      schema: z.strictObject({ ok: z.boolean() }),
      maxOutputTokens: 100,
    });
    const [request] = sent;
    if (!request) throw new Error("no request reached the model");
    return request;
  }

  test("an India lesson's request carries the country's spelling, teacher, currency and units", async () => {
    const request = await compile("india");
    expect(request.system).toContain("Indian English");
    expect(request.system).toContain("Indian teacher");
    expect(request.system).not.toContain("British English");
    expect(request.user).toContain("Language: en-IN");
    expect(request.user).toContain("Currency: ₹ (rupees and paise)");
    expect(request.user).toContain("Units: metric");
  });

  test("an England lesson's request is England's prompt, unchanged", async () => {
    const request = await compile("england");
    expect(request.system).toBe(PROMPTS["plan-skeleton"].system);
    expect(request.user).toContain("Language: en-GB");
    expect(request.user).not.toContain("Currency:");
  });
});
