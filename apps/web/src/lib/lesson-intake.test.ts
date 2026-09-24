import { afterEach, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { type Lesson, lessonFromBrief } from "@tj/domain/documents";
import {
  confirmLesson,
  objectiveEdits,
  replanLesson,
  seedConfirmedGeneration,
} from "./lesson-intake";

import { queryKeys } from "./query";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
function transport(status = 202) {
  const requests: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json(
      status === 202
        ? { jobId: "job", revision: 2 }
        : { error: { code: "conflict", reason: "stale", message: "Plan changed" } },
      { status },
    );
  }) as typeof fetch;
  return requests;
}
describe("lesson intake transport", () => {
  it("installs the accepted lock and revision before an editor can observe confirmation", async () => {
    const client = new QueryClient();
    const lesson = lessonFromBrief({ brief: { topic: "Rocks" } }, "lesson", new Date());
    lesson.plan = { state: "proposed", revision: 1, jobId: "plan-job" };
    client.setQueryData(queryKeys.libraryDocument(lesson.id), lesson);
    client.setQueryData(queryKeys.libraryDocumentMeta(lesson.id), { generatingJobId: null });
    let unsafe = false;
    const unsubscribe = client.getQueryCache().subscribe(() => {
      const body = client.getQueryData<Lesson>(queryKeys.libraryDocument(lesson.id));
      const meta = client.getQueryData<{ generatingJobId: string }>(
        queryKeys.libraryDocumentMeta(lesson.id),
      );
      if (body?.plan?.state === "confirmed" && meta?.generatingJobId !== "generate-job")
        unsafe = true;
    });
    await seedConfirmedGeneration(client, lesson, { jobId: "generate-job", revision: 2 });
    expect(unsafe).toBe(false);
    expect(client.getQueryData(queryKeys.libraryDocumentMeta(lesson.id))).toMatchObject({
      generatingJobId: "generate-job",
    });
    expect(client.getQueryData<Lesson>(queryKeys.libraryDocument(lesson.id))?.plan).toEqual({
      state: "confirmed",
      revision: 2,
      jobId: "generate-job",
    });
    expect(client.getQueryState(queryKeys.libraryDocument(lesson.id))?.isInvalidated).toBe(true);
    unsubscribe();
  });

  it("preserves stored objective IDs and omits temporary IDs for additions", () => {
    const lesson = {
      facts: {
        objectives: [
          { id: "o1", text: "Old" },
          { id: "o2", text: "Remove" },
        ],
      },
    } as Lesson;
    expect(
      objectiveEdits(lesson, [
        { id: "o1", text: "Edited" },
        { id: "local-uuid", text: "Added" },
      ]),
    ).toEqual([{ id: "o1", text: "Edited" }, { text: "Added" }]);
  });
  it("confirms the displayed revision with no hidden duration", async () => {
    const requests = transport();
    await confirmLesson(new QueryClient(), "lesson", {
      expectedRevision: 1,
      objectives: [{ id: "o1", text: "Explain" }],
      slideCount: 8,
    });
    expect(requests[0]?.url).toContain("/lessons/lesson/generate");
    expect(requests[0]?.body).toEqual({
      expectedRevision: 1,
      objectives: [{ id: "o1", text: "Explain" }],
      slideCount: 8,
    });
  });
  it("replan carries source membership and level without duration", async () => {
    const requests = transport();
    await replanLesson(new QueryClient(), "lesson", {
      expectedRevision: 2,
      brief: { topic: "Rocks", level: "easier" },
      yearGroup: "Year 3",
      sourceIds: [],
    });
    expect(requests[0]?.body).toEqual({
      expectedRevision: 2,
      brief: { topic: "Rocks", level: "easier" },
      yearGroup: "Year 3",
      sourceIds: [],
    });
  });
  it("does not retry a stale confirmation", async () => {
    const requests = transport(409);
    await expect(
      confirmLesson(new QueryClient(), "lesson", {
        expectedRevision: 1,
        objectives: [{ text: "Explain" }],
      }),
    ).rejects.toMatchObject({ reason: "stale" });
    expect(requests).toHaveLength(1);
  });
});
