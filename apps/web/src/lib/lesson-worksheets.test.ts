import { beforeEach, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import {
  canRequestWorksheet,
  failureMessageOf,
  generationHandoff,
  persistWorksheetHandoff,
  rememberWorksheetIntent,
  requestWorksheetRetryingOnce,
  retryIntentOf,
  subscribeWorksheetHandoff,
  WORKSHEET_ENTRY_LABEL,
  WORKSHEET_QUEUED_MESSAGE,
  worksheetEntryState,
  worksheetStatusLabel,
} from "./lesson-worksheets";
import { ApiError } from "./query";

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
    expect(
      canRequestWorksheet({ ...lesson, generation: { stage: "planned" } as never }, intent),
    ).toBe(false);
    // R4 review: a lesson job still holding the lesson (writing, checking, repairing): wait.
    const written = { ...lesson, generation: { stage: "generated" } as never };
    expect(canRequestWorksheet(written, intent, true)).toBe(false);
    expect(canRequestWorksheet(written, intent, false)).toBe(lesson.facts !== undefined);
    // No recorded stage: read from its slides, as the api does.
    expect(canRequestWorksheet({ ...lesson, generation: undefined }, intent)).toBe(
      lesson.slides.length > 0 && lesson.facts !== undefined,
    );
    expect(
      canRequestWorksheet({ ...lesson, plan: { ...lesson.plan, state: "proposed" } }, intent),
    ).toBe(false);
    expect(canRequestWorksheet({ ...lesson, plan: { ...lesson.plan, revision: 2 } }, intent)).toBe(
      false,
    );
    expect(canRequestWorksheet({ ...lesson, facts: undefined }, intent)).toBe(false);
  });
});

describe("worksheetStatusLabel (WS1)", () => {
  it("is Incomplete whenever the api says isUnfinishedWorksheet, Ready otherwise", () => {
    expect(worksheetStatusLabel({ generatingJobId: "job", unfinished: true })).toBe("Making…");
    expect(worksheetStatusLabel({ generatingJobId: null, unfinished: true })).toBe("Incomplete");
    expect(worksheetStatusLabel({ generatingJobId: null, unfinished: false })).toBe("Ready");
  });
});

const failedGeneration = {
  jobId: "job-1",
  stage: "failed" as const,
  startedAt: "2026-11-11T10:00:00.000Z",
  promptVersions: {},
  usage: { calls: 2, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  findings: [],
  recipeId: "exit-ticket" as const,
  practiceMinutes: 15,
  failure: { code: "spend-limit" as const, message: "Saved words." },
};

describe("failed and making sheets (WS2)", () => {
  it("labels a failed sheet Didn’t finish, with its saved reason, and builds its retry", () => {
    const item = { generatingJobId: null, unfinished: true, generation: failedGeneration };
    expect(worksheetStatusLabel(item)).toBe("Didn’t finish");
    expect(failureMessageOf(item)).toBe("Saved words.");
    expect(failureMessageOf({ generation: { ...failedGeneration, failure: undefined } })).toBe(
      "We couldn’t write this sheet. Try again, or choose another type.",
    );
    expect(failureMessageOf({ generation: { ...failedGeneration, stage: "checked" } })).toBeNull();
    expect(retryIntentOf({ plan: { state: "confirmed", revision: 3, jobId: "p" } }, item)).toEqual({
      recipeId: "exit-ticket",
      practiceMinutes: 15,
      expectedRevision: 3,
    });
    expect(
      retryIntentOf(
        { plan: { state: "confirmed", revision: 3, jobId: "p" } },
        { generation: { ...failedGeneration, stage: "checked" } },
      ),
    ).toBeNull();
  });

  it("the entry says making, then ready once a watched job finished, or didn’t finish", () => {
    const at = (updatedAt: string, extra = {}) => ({ updatedAt, generatingJobId: null, ...extra });
    expect(worksheetEntryState(undefined, false)).toBe("idle");
    expect(worksheetEntryState([at("1", { generatingJobId: "j" })], false)).toBe("making");
    expect(worksheetEntryState([at("1")], true)).toBe("ready");
    expect(worksheetEntryState([at("1")], false)).toBe("idle");
    // The newest sheet decides: an old failure under a newer good sheet is not shouted about.
    const failed = at("2026-11-11T10:00:00Z", { generation: failedGeneration });
    expect(worksheetEntryState([at("2026-11-10T10:00:00Z"), failed], true)).toBe("failed");
    expect(worksheetEntryState([failed, at("2026-11-12T10:00:00Z")], false)).toBe("idle");
    expect(WORKSHEET_ENTRY_LABEL.making).toBe("Worksheet: making…");
    expect(WORKSHEET_ENTRY_LABEL.ready).toBe("Worksheet ready · Open");
    expect(WORKSHEET_ENTRY_LABEL.failed).toBe("Worksheet didn’t finish · Try again");
  });

  it("retries once, after the next throttle slot, when the api answers queued", async () => {
    const queued = new ApiError(409, {
      code: "conflict",
      message: WORKSHEET_QUEUED_MESSAGE,
      reason: "generating",
    });
    const waits: number[] = [];
    let calls = 0;
    let waiting = 0;
    const ok = { worksheetId: "w", jobId: "j" } as never;
    const result = await requestWorksheetRetryingOnce(client(), "lesson", intent, {
      request: (async () => {
        calls++;
        if (calls === 1) throw queued;
        return ok;
      }) as never,
      wait: async (ms) => {
        waits.push(ms);
      },
      now: () => 61_000,
      onWaiting: () => waiting++,
    });
    expect(result).toEqual(ok);
    expect(calls).toBe(2);
    expect(waiting).toBe(1);
    // 61 s is 1 s into a slot: the next opens in 29 s, plus a second's margin.
    expect(waits).toEqual([30_000]);

    calls = 0;
    await expect(
      requestWorksheetRetryingOnce(client(), "lesson", intent, {
        request: (async () => {
          calls++;
          throw queued;
        }) as never,
        wait: async () => {},
      }),
    ).rejects.toBe(queued);
    expect(calls).toBe(2);

    // Any other refusal is not retried.
    const generating = new ApiError(409, { code: "conflict", message: "Already being written." });
    calls = 0;
    await expect(
      requestWorksheetRetryingOnce(client(), "lesson", intent, {
        request: (async () => {
          calls++;
          throw generating;
        }) as never,
        wait: async () => {},
      }),
    ).rejects.toBe(generating);
    expect(calls).toBe(1);
  });
});
