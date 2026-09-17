import { describe, expect, test } from "bun:test";
import { AiError, createAi } from "@tj/ai";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import { newId, type WorkspaceId } from "@tj/domain";
import { FIXTURES } from "@tj/generation/testing";
import { createApp } from "../app";
import type { ErrorEnvelope } from "../errors";
import { captureLogger, fakeSql, silentLogger, TEST_ENV, TEST_ENV_NO_SHIM } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

/*
 * `POST /briefs/parse` (ADR 0029 item 13, TEACH-16) end to end on the fake client: every row of
 * the ticket's acceptance table. No database is involved (`fakeSql`), nothing is persisted, and
 * the fake records what the model was asked so the "rules first" contract is asserted on the
 * prompt the model saw, not on log text. Invalid bodies are the app's standard `400
 * validation_failed` envelope (`errors.ts`), as on every other route.
 */

const ws = newId<WorkspaceId>();

type Parsed = {
  topic: string;
  yearGroup?: string;
  subject?: string;
  level?: string;
  durationMin?: number;
  inferred: string[];
};

function appWith(script?: FakeScriptEntry[], options: { ai?: "none" | "unconfigured" } = {}) {
  const { logger, lines } = captureLogger();
  const fake = createFakeAi({ script, logger });
  // `createAi` with no bearer token is the real unconfigured client, as at boot without one.
  const ai =
    options.ai === "none" ? undefined : options.ai === "unconfigured" ? createAi({}) : fake;
  const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger, ai });
  const parsed = () =>
    lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === "brief parsed");
  return { app, fake, lines, parsed };
}

const post = (
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request("/briefs/parse", {
    method: "POST",
    headers: { [WORKSPACE_HEADER]: ws, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const answer = (fields: unknown) => JSON.stringify(fields);

describe("POST /briefs/parse", () => {
  test("rules find the year group and subject; the model adds only the level", async () => {
    const { app, fake, parsed } = appWith([answer(FIXTURES.parseBrief)]);
    const res = await post(app, { text: "Year 8 history: causes of the First World War" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Parsed;
    expect(body).toEqual({
      topic: "causes of the First World War",
      yearGroup: "Year 8",
      subject: "History",
      level: "easier",
      inferred: ["level"],
    });
    // The fixture also says "Science"; the rule's "History" stands.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.modelClass).toBe("small");
    expect(fake.calls[0]?.context).toMatchObject({ stage: "parse-brief", effort: "low" });
    expect(fake.calls[0]?.promptText).not.toContain('"subject": one of');
    expect(fake.calls[0]?.promptText).not.toContain('"yearGroup": one of');
    expect(parsed()).toMatchObject({ rules: 2, model: true, dropped: 0 });
    expect(typeof parsed()?.ms).toBe("number");
  });

  test("nothing from the rules: the model is asked for everything and fills the subject", async () => {
    const { app, fake } = appWith([answer({ subject: "Science" })]);
    const res = await post(app, { text: "the water cycle" });
    expect(await res.json()).toEqual({
      topic: "the water cycle",
      subject: "Science",
      inferred: ["subject"],
    });
    const prompt = fake.calls[0]?.promptText ?? "";
    expect(prompt).toContain('"yearGroup": one of');
    expect(prompt).toContain('"subject": one of');
    expect(prompt).toContain('"durationMin"');
    expect(prompt).toContain('"level"');
  });

  test("a rule hit wins over the model", async () => {
    const { app } = appWith([answer({ yearGroup: "Year 9" })]);
    const res = await post(app, { text: "Year 5 maths, 45 minutes" });
    expect(await res.json()).toEqual({
      topic: "Year 5 maths, 45 minutes",
      yearGroup: "Year 5",
      subject: "Maths",
      durationMin: 45,
      inferred: [],
    });
  });

  test("the year groups the form offers bound both the rules and the model", async () => {
    const { app, fake } = appWith([answer({ yearGroup: "Year 8" })]);
    const res = await post(app, { text: "Year 8 rivers", yearGroups: ["Year 7", "Year 9"] });
    expect(await res.json()).toEqual({ topic: "Year 8 rivers", inferred: [] });
    expect(fake.calls[0]?.promptText).toContain('"Year 7", "Year 9"');
  });

  test("a model string that is a name is dropped; nothing but the teacher's own text carries it", async () => {
    const { app, parsed } = appWith([answer({ subject: "Amelia Jones" })]);
    const res = await post(app, { text: "a lesson for Amelia Jones on fractions" });
    const body = (await res.json()) as Parsed;
    expect(body.subject).toBeUndefined();
    expect(body.inferred).toEqual([]);
    const { topic, ...fields } = body;
    expect(topic).toBe("a lesson for Amelia Jones on fractions");
    expect(JSON.stringify(fields)).not.toContain("Amelia");
    expect(parsed()).toMatchObject({ rules: 0, model: true, dropped: 1 });
  });

  test("no AI client: rules only, still 200", async () => {
    const { app, fake, parsed } = appWith([answer({ level: "harder" })], { ai: "none" });
    const res = await post(app, { text: "Year 8 history: causes of the First World War" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      topic: "causes of the First World War",
      yearGroup: "Year 8",
      subject: "History",
      inferred: [],
    });
    expect(fake.calls).toHaveLength(0);
    expect(parsed()).toMatchObject({ rules: 2, model: false, dropped: 0 });
  });

  test("an unconfigured AI client is not called", async () => {
    const { app, fake, parsed } = appWith([answer({ level: "harder" })], { ai: "unconfigured" });
    const res = await post(app, { text: "the water cycle" });
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(0);
    expect(parsed()).toMatchObject({ model: false });
  });

  test("a model that never answers: the rules' result within 2.5 s", async () => {
    const { app, parsed, lines } = appWith([() => new Promise<never>(() => {})]);
    const start = performance.now();
    const res = await post(app, { text: "Year 8 history: causes of the First World War" });
    const elapsed = performance.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2500);
    expect(await res.json()).toEqual({
      topic: "causes of the First World War",
      yearGroup: "Year 8",
      subject: "History",
      inferred: [],
    });
    expect(parsed()).toMatchObject({ model: false });
    const failed = lines.find((l) => l.includes("parse-brief model call failed"));
    expect(failed).toBeDefined();
    expect(failed).not.toContain("First World War");
  });

  test("any model error is the rules' result, logged by class only", async () => {
    const { app, parsed, lines } = appWith([
      () => {
        throw new AiError("moderated", "the provider refused: Year 8 history");
      },
    ]);
    const res = await post(app, { text: "Year 8 history: causes of the First World War" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Parsed).inferred).toEqual([]);
    expect(parsed()).toMatchObject({ model: false });
    const failed = lines.find((l) => l.includes("parse-brief model call failed")) ?? "";
    expect(JSON.parse(failed)).toMatchObject({ error: "AiError" });
    expect(failed).not.toContain("the provider refused");
  });

  test("an answer that never validates: rules only after the one retry", async () => {
    const { app, fake } = appWith(['{"level": "hardest"}', '{"level": "hardest"}']);
    const res = await post(app, { text: "Year 8 history: causes of the First World War" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Parsed).inferred).toEqual([]);
    expect(fake.calls).toHaveLength(2);
  });

  test("400 validation_failed on a text over 500 characters, path text", async () => {
    const { app, fake } = appWith();
    const res = await post(app, { text: "x".repeat(501) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toMatchObject({ code: "validation_failed", fields: ["text"] });
    expect(fake.calls).toHaveLength(0);
  });

  test("400 on an identifier in the text, before any model call", async () => {
    const { app, fake, lines } = appWith();
    const res = await post(app, { text: "fractions for a pupil called Sam, admission 1234567" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorEnvelope).error.fields).toEqual(["text"]);
    expect(fake.calls).toHaveLength(0);
    expect(lines.join("\n")).not.toContain("pupil called");
  });

  test("400 on an unknown key and on a missing JSON content type", async () => {
    const { app } = appWith();
    expect((await post(app, { text: "rivers", topic: "rivers" })).status).toBe(400);
    const res = await app.request("/briefs/parse", {
      method: "POST",
      headers: { [WORKSPACE_HEADER]: ws, "content-type": "text/plain" },
      body: "rivers",
    });
    expect(res.status).toBe(400);
  });

  test("31 calls in a minute hit the model-call limit shared with /lessons", async () => {
    const { app } = appWith(undefined, { ai: "none" });
    for (let i = 0; i < 30; i++) expect((await post(app, { text: "rivers" })).status).toBe(200);
    const over = await post(app, { text: "rivers" });
    expect(over.status).toBe(429);
    expect(((await over.json()) as ErrorEnvelope).error.code).toBe("rate_limited");
  });

  test("no session: 401 from the app origin, 403 from a foreign one", async () => {
    const app = createApp({ env: TEST_ENV_NO_SHIM, db: fakeSql(true), logger: silentLogger });
    const browser = { "content-type": "application/json", "Sec-Fetch-Site": "cross-site" };
    const unauthenticated = await app.request("/briefs/parse", {
      method: "POST",
      headers: { ...browser, Origin: "https://app.example.test" },
      body: JSON.stringify({ text: "rivers" }),
    });
    expect(unauthenticated.status).toBe(401);
    const foreign = await app.request("/briefs/parse", {
      method: "POST",
      headers: { ...browser, Origin: "https://evil.example" },
      body: JSON.stringify({ text: "rivers" }),
    });
    expect(foreign.status).toBe(403);
  });
});
