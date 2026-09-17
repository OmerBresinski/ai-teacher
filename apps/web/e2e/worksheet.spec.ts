/**
 * TEACH-14: a worksheet made beside a finished lesson over the fake worker (`AI_FAKE_SCRIPT=
 * pipeline`, ADR 0025 §22; ADR 0030). API-level until T7 ships the worksheet screen: the lesson
 * is created with `skipPlanning` (the brief page's stopgap, so the plan is confirmed up front),
 * the request goes to `POST /lessons/:id/worksheet` and `GET /lessons/:id/worksheets` shows the
 * sheet framed then checked, with the lesson row never written by the worksheet job. When T7
 * lands, this spec becomes the offer → Make → frame → fill flow on the lesson page.
 */
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ seed: false });

type Sheet = {
  id: string;
  generatingJobId: string | null;
  generation?: { stage: string; recipeId: string; practiceMinutes: number; findings: unknown[] };
};

test.describe("worksheet beside a generated lesson (API level)", () => {
  test("POST /worksheet → framed → checked; the lesson row is untouched", async ({
    signedInPage: { page },
  }) => {
    const api = page.request;
    const origin = { origin: E2E_WEB_URL };
    const created = await api.post(`${E2E_API_URL}/lessons`, {
      headers: origin,
      data: { brief: { topic: "States of matter" }, yearGroup: "Year 8", skipPlanning: true },
    });
    expect(created.status(), await created.text()).toBe(202);
    const { lessonId } = (await created.json()) as { lessonId: string };

    // The whole pipeline runs over the fake; wait for the lock to clear.
    const lessonRow = async () =>
      (await (await api.get(`${E2E_API_URL}/documents/${lessonId}`)).json()) as {
        updatedAt: string;
        generatingJobId: string | null;
        body: { generation?: { stage: string }; plan?: { revision: number } };
      };
    await expect
      .poll(async () => (await lessonRow()).generatingJobId, { timeout: 60_000 })
      .toBe(null);
    const before = await lessonRow();
    expect(before.body.plan?.revision).toBe(1);

    const requested = await api.post(`${E2E_API_URL}/lessons/${lessonId}/worksheet`, {
      headers: origin,
      // The fake answers the knowledge-check frame (`worksheet-fill.json`).
      data: { expectedRevision: 1, recipeId: "knowledge-check" },
    });
    expect(requested.status(), await requested.text()).toBe(202);
    const { worksheetId, jobId } = (await requested.json()) as {
      worksheetId: string;
      jobId: string;
    };

    const sheets = async () =>
      (
        (await (await api.get(`${E2E_API_URL}/lessons/${lessonId}/worksheets`)).json()) as {
          items: Sheet[];
        }
      ).items;
    // Listed at once, locked by the job.
    const listed = await sheets();
    expect(listed.map((s) => s.id)).toEqual([worksheetId]);
    // The frame lands within a second or two; the fill and checks a little later.
    const stages = new Set<string>();
    await expect
      .poll(
        async () => {
          const sheet = (await sheets())[0];
          if (sheet?.generation) stages.add(sheet.generation.stage);
          return sheet?.generatingJobId === null ? sheet.generation?.stage : "running";
        },
        { timeout: 60_000 },
      )
      .toBe("checked");
    expect(stages.has("framed") || stages.has("filled")).toBe(true);
    const done = (await sheets())[0] as Sheet;
    expect(done.generation).toMatchObject({ recipeId: "knowledge-check", practiceMinutes: 13 });
    void jobId;

    // The sheet itself: the recipe's blocks and the fixture's three items, provenance on each.
    const doc = (await (await api.get(`${E2E_API_URL}/documents/${worksheetId}`)).json()) as {
      body: { lessonId: string; blocks: { type: string; generatedFrom?: unknown }[] };
    };
    expect(doc.body.lessonId).toBe(lessonId);
    expect(doc.body.blocks.map((b) => b.type)).toEqual([
      "instructions",
      "question",
      "question",
      "multiple-choice",
      "multiple-choice",
      "multiple-choice",
    ]);
    expect(doc.body.blocks.every((b) => b.generatedFrom !== undefined)).toBe(true);

    // The worksheet job never wrote the lesson row.
    const after = await lessonRow();
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.generatingJobId).toBeNull();

    // A second request while the first is done and the slot has passed is not this spec's
    // concern (`lessons.integration.test.ts`); the same request again straight away is 409.
    const again = await api.post(`${E2E_API_URL}/lessons/${lessonId}/worksheet`, {
      headers: origin,
      data: { expectedRevision: 1, recipeId: "knowledge-check" },
    });
    expect(again.status()).toBe(409);
  });
});
