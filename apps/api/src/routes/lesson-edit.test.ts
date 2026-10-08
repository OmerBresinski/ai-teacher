import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { newId, type WorkspaceId } from "@tj/domain";
import { multipleChoiceSlide } from "@tj/domain/documents/fixtures";
import { createApp } from "../app";
import { fakeSql, silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

/*
 * `POST /lessons/:id/edit` (TEACH-97 part d): the request contract. The edit itself (the call,
 * the checks, the retry and the refusals) is covered in `@tj/generation` `edit-fast.test.ts`;
 * here every bad body is the standard `400 validation_failed` before the database or a model is
 * reached, so no call is ever paid for a request the editor could not have sent.
 */

const ws = newId<WorkspaceId>();
const lessonId = "0199b7a4-5b7e-7c3e-9a51-6f2d3c1b0a99";

function appWithFake() {
  const fake = createFakeAi({});
  const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger, ai: fake });
  return { app, fake };
}

const post = (app: ReturnType<typeof createApp>, id: string, body: unknown) =>
  app.request(`/lessons/${id}/edit`, {
    method: "POST",
    headers: { [WORKSPACE_HEADER]: ws, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /lessons/:id/edit", () => {
  test.each([
    ["an empty instruction", { slide: multipleChoiceSlide(), elementId: "q", instruction: " " }],
    ["no slide", { elementId: "q", instruction: "Shorter" }],
    ["a slide that is not a slide", { slide: { id: "x" }, elementId: "q", instruction: "Shorter" }],
    ["an unknown key", { slide: multipleChoiceSlide(), elementId: "q", instruction: "x", y: 1 }],
    [
      "more than 3 history turns",
      {
        slide: multipleChoiceSlide(),
        instruction: "a bit more",
        history: [1, 2, 3, 4].map(() => ({ instruction: "x", summary: "y", slides: [] })),
      },
    ],
    [
      "a history slide that is not a path",
      {
        slide: multipleChoiceSlide(),
        instruction: "a bit more",
        history: [{ instruction: "x", summary: "y", slides: ["slide 4"] }],
      },
    ],
    [
      "an overlong instruction",
      { slide: multipleChoiceSlide(), elementId: "q", instruction: "x".repeat(501) },
    ],
  ])("%s is a 400 and no model call", async (_name, body) => {
    const { app, fake } = appWithFake();
    const res = await post(app, lessonId, body);
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  test("a lesson id that is not a uuid is a 400", async () => {
    const { app, fake } = appWithFake();
    const body = { slide: multipleChoiceSlide(), elementId: "q", instruction: "Shorter" };
    const res = await post(app, "not-a-uuid", body);
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });
});
