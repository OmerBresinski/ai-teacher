import { beforeEach, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import {
  canRequestWorksheet,
  generationHandoff,
  persistWorksheetHandoff,
  rememberWorksheetIntent,
  subscribeWorksheetHandoff,
} from "./lesson-worksheets";

function client(user = "teacher", workspace = "class") {
  const value = new QueryClient();
  value.setQueryData(["me"], { user: { id: user }, workspaceId: workspace });
  return value;
}
const intent = { recipeId: "knowledge-check", practiceMinutes: 10, expectedRevision: 1 };
beforeEach(() => sessionStorage.clear());
describe("worksheet intent isolation and reload", () => {
  it("recovers a selected, unsubmitted worksheet after reload", () => {
    rememberWorksheetIntent(client(), "lesson", intent);
    expect(generationHandoff(client(), "lesson").intent).toEqual(intent);
    expect(generationHandoff(client(), "lesson").attempted).toBe(false);
  });
  it("never restores an in-flight request as automatic work", () => {
    const old = client();
    rememberWorksheetIntent(old, "lesson", intent);
    const state = generationHandoff(old, "lesson");
    state.attempted = true;
    state.pending = true;
    persistWorksheetHandoff(old, "lesson");
    const restored = generationHandoff(client(), "lesson");
    expect(restored.attempted).toBe(true);
    expect(restored.pending).toBe(false);
    expect(restored.error).toContain("interrupted");
  });
  it("notifies a new editor subscriber when a request from the generating view settles", () => {
    const value = client();
    let updates = 0;
    const unsubscribe = subscribeWorksheetHandoff(value, () => updates++);
    generationHandoff(value, "lesson").error = "Request interrupted";
    persistWorksheetHandoff(value, "lesson");
    expect(updates).toBe(1);
    unsubscribe();
    persistWorksheetHandoff(value, "lesson");
    expect(updates).toBe(1);
  });

  it("does not share choices between teachers, workspaces, or lessons", () => {
    rememberWorksheetIntent(client(), "lesson", intent);
    expect(generationHandoff(client("other"), "lesson").intent).toBeNull();
    expect(generationHandoff(client("teacher", "other"), "lesson").intent).toBeNull();
    expect(generationHandoff(client(), "other").intent).toBeNull();
  });
  it("requires a confirmed matching revision and verified facts", () => {
    const demo = demoWorkspace(new Date()).find((row) => "slides" in row.body)?.body as Lesson;
    const lesson = { ...demo, plan: { state: "confirmed" as const, revision: 1, jobId: "job" } };
    expect(canRequestWorksheet({ ...lesson, generation: undefined }, intent)).toBe(false);
    expect(
      canRequestWorksheet({ ...lesson, plan: { ...lesson.plan, state: "proposed" } }, intent),
    ).toBe(false);
    expect(canRequestWorksheet({ ...lesson, plan: { ...lesson.plan, revision: 2 } }, intent)).toBe(
      false,
    );
    expect(canRequestWorksheet({ ...lesson, facts: undefined }, intent)).toBe(false);
  });
});
