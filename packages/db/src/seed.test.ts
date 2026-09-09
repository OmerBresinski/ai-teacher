import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { type Series, summarise, type Worksheet } from "@tj/domain/documents";
import {
  lesson as lessonFixture,
  worksheet as worksheetFixture,
} from "@tj/domain/documents/fixtures";
import { getSeriesWithLessons, listSummaries } from "./documents";
import { type SeedDocument, seedDocuments } from "./seed";
import { forWorkspace, type WorkspaceDb } from "./tenant";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping seed tests: ${t.reason}`);

function fixtures(): SeedDocument[] {
  const at = (hoursAgo: number) => new Date(Date.UTC(2026, 8, 1, 12 - hoursAgo)).toISOString();
  const lesson = (key: string, hoursAgo: number) => {
    const body = lessonFixture();
    body.id = key;
    body.title = key;
    body.createdAt = at(hoursAgo + 24);
    body.updatedAt = at(hoursAgo);
    return { key, kind: "lesson" as const, body };
  };
  const series: Series = {
    id: "unit",
    title: "Unit",
    lessonIds: ["first", "missing", "second"],
    createdAt: at(200),
    updatedAt: at(2),
  };
  return [lesson("first", 1), lesson("second", 100), { key: "unit", kind: "series", body: series }];
}

/** A worksheet that names its lesson by key, as the demo workspace does (TEACH-186). */
function sheetFixture(key: string, lessonId: string | undefined): SeedDocument {
  const body = worksheetFixture();
  body.id = key;
  body.title = key;
  body.lessonId = lessonId;
  return { key, kind: "worksheet", body };
}

describeDb("seedDocuments", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const wsId = newId<WorkspaceId>();
  let ws: WorkspaceDb;

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsId, workspaceName: "A" });
    ws = forWorkspace(unsafeDb, wsId);
  });

  test("inserts in order, maps series keys to ids and dates rows from the body", async () => {
    const result = await seedDocuments(ws, fixtures());
    expect(result.skipped).toEqual([]);
    expect([...result.ids.keys()]).toEqual(["first", "second", "unit"]);
    for (const id of result.ids.values()) expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const unit = await getSeriesWithLessons(ws, result.ids.get("unit") ?? "");
    if (!unit) throw new Error("series not found");
    expect(unit.lessons.map((row) => row.title)).toEqual(["first", "second"]);
    expect((unit.series.body as Series).lessonIds).toEqual(
      ["first", "second"].map((key) => result.ids.get(key) ?? "unresolved"),
    );

    const first = result.inserted[0];
    if (!first) throw new Error("nothing inserted");
    expect(first.updatedAt.toISOString()).toBe("2026-09-01T11:00:00.000Z");
    expect(first.createdAt.toISOString()).toBe("2026-08-31T11:00:00.000Z");
    expect((first.body as { updatedAt: string }).updatedAt).toBe(first.updatedAt.toISOString());
    // The dated rows sort by their fixture times, newest first.
    const { items } = await listSummaries(ws, { kind: "lesson" });
    expect(items.map((row) => row.title)).toEqual(["first", "second"]);
  });

  test("maps a worksheet's lessonId from key to id, drops it when the lesson is missing, and promotes marks", async () => {
    const result = await seedDocuments(ws, [
      ...fixtures(),
      sheetFixture("sheet", "first"),
      sheetFixture("orphan", "missing"),
      sheetFixture("loose", undefined),
    ]);
    expect(result.skipped).toEqual([]);
    const bodies = new Map(result.inserted.map((row) => [row.title, row.body as Worksheet]));
    expect(bodies.get("sheet")?.lessonId).toBe(result.ids.get("first"));
    expect(bodies.get("orphan")?.lessonId).toBeUndefined();
    expect(bodies.get("loose")?.lessonId).toBeUndefined();
    const { items } = await listSummaries(ws, { kind: "worksheet" });
    for (const row of items) expect(row.marks).toBe(summarise(worksheetFixture()).marks ?? null);
  });

  test("a body the parser refuses rolls the whole seed back", async () => {
    const [first] = fixtures();
    if (!first) throw new Error("fixture missing");
    const bad: SeedDocument = {
      key: "bad",
      kind: "lesson",
      body: {
        id: "bad",
        title: "Bad",
        createdAt: first.body.createdAt,
        updatedAt: first.body.updatedAt,
      },
    };
    await expect(seedDocuments(ws, [first, bad])).rejects.toThrow();
    expect((await listSummaries(ws, { kind: "lesson" })).items).toEqual([]);
  });

  test("skipTitles leaves those documents out and their keys unresolved", async () => {
    const result = await seedDocuments(ws, fixtures(), { skipTitles: new Set(["first"]) });
    expect(result.skipped).toEqual(["first"]);
    expect(result.ids.has("first")).toBe(false);
    const unit = await getSeriesWithLessons(ws, result.ids.get("unit") ?? "");
    expect(unit?.lessons.map((row) => row.title)).toEqual(["second"]);
  });
});
