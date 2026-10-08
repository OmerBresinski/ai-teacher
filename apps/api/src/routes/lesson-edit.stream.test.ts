import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { newId, type WorkspaceId } from "@tj/domain";
import type { Lesson, Slide } from "@tj/domain/documents";
import { lesson as demoLesson, textElement } from "@tj/domain/documents/fixtures";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { silentLogger } from "../test-helpers";
import { lessonEditRoutes } from "./lesson-edit";

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

function app() {
  const ai = createFakeAi({ script: [reply] });
  const app = new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set("workspaceId", ws);
      c.set("logger", silentLogger as never);
      c.set("requestId", "req-1" as never);
      await next();
    })
    .route("/", lessonEditRoutes(stubDb(), ai));
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
