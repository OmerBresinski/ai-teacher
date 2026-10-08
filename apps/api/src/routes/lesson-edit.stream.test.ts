import { describe, expect, test } from "bun:test";
import { createBudget } from "@tj/ai";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import { newId, type WorkspaceId } from "@tj/domain";
import type { Lesson, Slide } from "@tj/domain/documents";
import { lesson as demoLesson, textElement } from "@tj/domain/documents/fixtures";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { silentLogger } from "../test-helpers";
import {
  type LessonEditOptions,
  lessonEditRoutes,
  SLIDE_CHANGED,
  SLIDE_IDENTIFIER,
} from "./lesson-edit";

/*
 * The streamed edit (TEACH-97 chat-d): with `Accept: text/event-stream` the route answers over
 * SSE, `partial` events while the (fake) model writes, then one `final` event with the checked
 * answer, the same JSON a plain request gets. The route is mounted alone over a stub document
 * store; the guards in front of it are `app.ts`'s and are covered there and in smoke-prod.
 */

const slide: Slide = {
  id: "s-content",
  kind: "content",
  elements: [
    textElement("b", "Water warms up and turns into a gas called water vapour.", {
      y: 140,
      h: 120,
    } as never),
  ],
};
const lesson: Lesson = { ...demoLesson(), slides: [...demoLesson().slides, slide] };
const lessonId = newId();
const ws = newId() as WorkspaceId;

/** A document store that answers every query with the one lesson row. */
function stubDb(): never {
  const row = { id: lessonId, kind: "lesson", body: lesson };
  const chain: unknown = new Proxy(() => {}, {
    get: (_t, key) =>
      key === "then" ? undefined : key === "limit" ? () => Promise.resolve([row]) : () => chain,
    apply: () => chain,
  });
  return chain as never;
}

const reply = JSON.stringify({
  action: "edit",
  reason: null,
  offer: null,
  changes: [
    { target: "s4/elements/b/text", text: "Water warms up and becomes a gas.", node_json: null },
  ],
  summary: "Made it shorter.",
});

function app(options: LessonEditOptions = {}, script: FakeScriptEntry[] = [reply]) {
  const ai = createFakeAi({ script });
  const app = new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set("workspaceId", ws);
      c.set("logger", silentLogger as never);
      c.set("requestId", "req-1" as never);
      await next();
    })
    .route("/", lessonEditRoutes(stubDb(), ai, options));
  return { app, ai };
}

const body = JSON.stringify({ slide, elementId: "b", instruction: "Shorter" });

describe("POST /lessons/:id/edit, streamed", () => {
  test("partials, then the checked answer as `final`", async () => {
    const { app: a, ai } = app();
    const res = await a.request(`/lessons/${lessonId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter((b) => b.includes("data:"))
      .map((b) => ({
        event: /event: ?(\S+)/.exec(b)?.[1],
        data: JSON.parse((/data: ?(.*)/.exec(b)?.[1] ?? "null") as string),
      }));
    expect(events.at(-1)?.event).toBe("final");
    const partials = events.filter((e) => e.event === "partial");
    expect(partials.length).toBeGreaterThan(0);
    expect(partials.at(-1)?.data).toEqual({
      summary: "Made it shorter.",
      texts: [{ elementId: "b", text: "Water warms up and becomes a gas." }],
    });
    const final = events.at(-1)?.data as { action: string; summary: string; changes: unknown[] };
    expect(final.action).toBe("edit");
    expect(final.summary).toBe("Made it shorter.");
    expect(final.changes).toHaveLength(1);
    expect(ai.calls).toHaveLength(1);
  });

  test("a plain request still gets one JSON answer", async () => {
    const { app: a } = app();
    const res = await a.request(`/lessons/${lessonId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as { action: string }).action).toBe("edit");
  });
});

const sse = (a: Hono<AppEnv>, payload: string = body, signal?: AbortSignal) =>
  a.request(`/lessons/${lessonId}/edit`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: payload,
    ...(signal ? { signal } : {}),
  });
const finalOf = (text: string) =>
  JSON.parse(/event: final\ndata: (.*)/.exec(text)?.[1] ?? "null") as {
    action: string;
    reason?: string;
    check?: string;
  };

describe("POST /lessons/:id/edit, guards and budget", () => {
  test("a capped budget is refused before any model call, streamed or not", async () => {
    const capped = createBudget({ capUsd: 0, capTokens: 0 });
    const { app: a, ai } = app({ budgetFor: () => capped });
    const final = finalOf(await (await sse(a)).text());
    expect(final.action).toBe("failed");
    expect(ai.calls).toHaveLength(0);
  });

  test("the streamed call reserves and settles on the budget it was given", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const { app: a } = app({ budgetFor: () => budget });
    expect(finalOf(await (await sse(a)).text()).action).toBe("edit");
    const totals = budget.totals();
    expect(totals.calls).toBe(1);
    expect(totals.inputTokens + totals.outputTokens).toBeGreaterThan(0);
    expect(totals.reserved?.calls ?? 0).toBe(0);
  });

  test("personal data in the sent slide's text is refused before any model call", async () => {
    const { app: a, ai } = app();
    const withEmail = {
      ...slide,
      elements: [
        textElement("b", "Send it to jo.bloggs@school.org.uk", { y: 140, h: 120 } as never),
      ],
    };
    const res = await sse(
      a,
      JSON.stringify({ slide: withEmail, elementId: "b", instruction: "Shorter" }),
    );
    const final = finalOf(await res.text());
    expect(final).toMatchObject({
      action: "refuse",
      reason: SLIDE_IDENTIFIER,
      check: "identifier",
    });
    expect(ai.calls).toHaveLength(0);
  });

  test("a box the saved slide does not have is a 400 and no model call", async () => {
    const { app: a, ai } = app();
    const forged = { ...slide, elements: [...slide.elements, textElement("zz", "Extra")] };
    const res = await sse(
      a,
      JSON.stringify({ slide: forged, elementId: "b", instruction: "Shorter" }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(SLIDE_CHANGED);
    const res2 = await sse(a, JSON.stringify({ slide, elementId: "nope", instruction: "Shorter" }));
    expect(res2.status).toBe(400);
    expect(ai.calls).toHaveLength(0);
  });

  test("a quiet stream carries heartbeat comments", async () => {
    const slow: FakeScriptEntry = async () => {
      await new Promise((r) => setTimeout(r, 120));
      return reply;
    };
    const { app: a } = app({ heartbeatMs: 20 }, [slow]);
    const text = await (await sse(a)).text();
    expect(text).toContain(": ping");
    expect(finalOf(text).action).toBe("edit");
  });

  test("Stop mid-stream aborts the model call and writes nothing after", async () => {
    let aborted = false;
    const slow: FakeScriptEntry = async (call) => {
      await new Promise((r) => setTimeout(r, 150));
      aborted = call.abortSignal?.aborted === true;
      return reply;
    };
    const { app: a } = app({ heartbeatMs: 10 }, [slow]);
    const stop = new AbortController();
    const res = await sse(a, body, stop.signal);
    setTimeout(() => stop.abort(), 30);
    const text = await res.text().catch(() => "");
    await new Promise((r) => setTimeout(r, 250));
    expect(text).not.toContain("event: final");
    expect(aborted).toBe(true);
  });
});
