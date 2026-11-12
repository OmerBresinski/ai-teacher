import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type Lesson, WORKSHEET_FAILURE_MESSAGES, type Worksheet } from "@tj/domain/documents";
import { z } from "zod";
import type { CharacterOrigin } from "@/components/lesson-creation/character-origin";
import { api } from "./api";
import { ApiError, apiErrorFromResponse, type Me } from "./query";
import { assertCurrentSession, sessionRequest } from "./session-boundary";

export interface WorksheetIntent {
  recipeId: string;
  practiceMinutes: number;
  expectedRevision: number;
}
export type Handoff = {
  intent: WorksheetIntent | null;
  origin: CharacterOrigin | null;
  attempted: boolean;
  error: string | null;
  pending: boolean;
  lastRequestedAt: number;
};
const storedIntentSchema = z.object({
  intent: z
    .object({
      recipeId: z.string(),
      practiceMinutes: z.number(),
      expectedRevision: z.number().int().positive(),
    })
    .nullable(),
  attempted: z.boolean(),
  error: z.string().nullable(),
  pending: z.boolean(),
  lastRequestedAt: z.number(),
});
// User + Workspace + Lesson scoped; a reload can recover an unsubmitted choice. An in-flight
// request becomes explicit uncertainty, never a second automatic model spend.
const handoffs = new WeakMap<QueryClient, Map<string, Handoff>>();
const listeners = new WeakMap<QueryClient, Set<() => void>>();
export function subscribeWorksheetHandoff(client: QueryClient, notify: () => void) {
  let set = listeners.get(client);
  if (!set) {
    set = new Set();
    listeners.set(client, set);
  }
  set.add(notify);
  return () => {
    set.delete(notify);
  };
}
export function worksheetHandoffSnapshot(client: QueryClient, id: string) {
  const value = handoff(client, id);
  return JSON.stringify([
    value.intent,
    value.error,
    value.pending,
    value.attempted,
    value.lastRequestedAt,
  ]);
}
function storageKey(client: QueryClient, id: string) {
  const me = client.getQueryData<Me>(["me"]);
  return me ? `tj:worksheet-intent:${me.user.id}:${me.workspaceId}:${id}` : null;
}
export function persistWorksheetHandoff(client: QueryClient, id: string) {
  for (const notify of listeners.get(client) ?? []) notify();
  const key = storageKey(client, id);
  if (!key) return;
  const { origin: _origin, ...stored } = handoff(client, id);
  try {
    sessionStorage.setItem(key, JSON.stringify(stored));
  } catch {
    /* Storage can be unavailable. */
  }
}
function handoff(client: QueryClient, id: string): Handoff {
  let map = handoffs.get(client);
  if (!map) {
    map = new Map();
    handoffs.set(client, map);
  }
  let value = map.get(id);
  if (!value) {
    value = {
      intent: null,
      origin: null,
      attempted: false,
      error: null,
      pending: false,
      lastRequestedAt: 0,
    };
    const key = storageKey(client, id);
    try {
      const parsed = storedIntentSchema.safeParse(
        JSON.parse(key ? (sessionStorage.getItem(key) ?? "null") : "null"),
      );
      if (parsed.success)
        value = {
          ...parsed.data,
          origin: null,
          pending: false,
          error: parsed.data.pending
            ? "The last worksheet request was interrupted. Check your worksheets before trying again."
            : parsed.data.error,
        };
    } catch {
      /* Ignore unavailable or malformed storage. */
    }
    map.set(id, value);
  }
  return value;
}
export function rememberWorksheetIntent(
  client: QueryClient,
  id: string,
  intent: WorksheetIntent | null,
) {
  const value = handoff(client, id);
  value.intent = intent;
  value.attempted = false;
  value.error = null;
  persistWorksheetHandoff(client, id);
}
export function rememberGenerationOrigin(
  client: QueryClient,
  id: string,
  origin: CharacterOrigin | null,
) {
  handoff(client, id).origin = origin;
}
export function generationHandoff(client: QueryClient, id: string) {
  return handoff(client, id);
}
/**
 * Whether the handoff's sheet may be requested now. The sheet is read from the slides (worksheets
 * plan v2 T6): wait until they are written, and (R4 review, 12 Nov) until no lesson job holds the
 * lesson (`lessonBusy`, the lesson's `generatingJobId`): stage `generated` is saved before the
 * slides are checked and repaired, and the api refuses a sheet then. A lesson with no recorded
 * stage is read from its slides, as the api does.
 */
export function canRequestWorksheet(lesson: Lesson, intent: WorksheetIntent, lessonBusy = false) {
  const stage = lesson.generation?.stage;
  return (
    !lessonBusy &&
    lesson.plan?.state === "confirmed" &&
    lesson.plan.revision === intent.expectedRevision &&
    (stage === undefined ? lesson.slides.length > 0 : stage !== "planned") &&
    !!lesson.facts
  );
}

/** One sheet type the lesson's picker offers, greyed with its reason when the slides can't carry it. */
export type WorksheetTypeOption = {
  type: string;
  name: string;
  available: boolean;
  reason?: string;
};

export const lessonWorksheetTypesQuery = (
  client: QueryClient,
  id: string,
  stage?: string,
  lessonBusy = false,
) =>
  queryOptions({
    // Keyed on the lesson's stage and on whether a lesson job holds it, so the greyed reasons are
    // read again once the slides are written and again once they are checked and repaired.
    queryKey: ["library", "lesson-worksheet-types", id, stage ?? "none", lessonBusy],
    queryFn: async ({ signal }): Promise<WorksheetTypeOption[]> => {
      const res = await api.lessons[":id"]["worksheet-types"].$get(
        { param: { id } },
        sessionRequest(client, signal),
      );
      if (res.status !== 200) throw await apiErrorFromResponse(res);
      const body = await res.json();
      assertCurrentSession(client);
      return body.types;
    },
  });
export const lessonWorksheetsQuery = (client: QueryClient, id: string) =>
  queryOptions({
    queryKey: ["library", "lesson-worksheets", id],
    queryFn: async ({ signal }) => {
      const res = await api.lessons[":id"].worksheets.$get(
        { param: { id } },
        sessionRequest(client, signal),
      );
      if (res.status !== 200) throw await apiErrorFromResponse(res);
      const body = await res.json();
      assertCurrentSession(client);
      return body.items;
    },
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.generatingJobId) ? 2000 : false,
  });
export async function requestLessonWorksheet(
  client: QueryClient,
  id: string,
  intent: WorksheetIntent,
) {
  const res = await api.lessons[":id"].worksheet.$post(
    {
      param: { id },
      json: {
        expectedRevision: intent.expectedRevision,
        recipeId: intent.recipeId,
        practiceMinutes: intent.practiceMinutes as 5 | 10 | 15 | 20 | 30 | 45,
      },
    },
    sessionRequest(client),
  );
  if (res.status !== 202) throw await apiErrorFromResponse(res);
  const result = await res.json();
  assertCurrentSession(client);
  return result;
}

type WorksheetListItem = {
  id: string;
  title: string;
  updatedAt: string;
  generatingJobId?: string | null;
  unfinished: boolean;
  generation?: Worksheet["generation"];
};

/**
 * The status beside a sheet in the dialog. "Making…" while its job holds the row; "Didn’t finish"
 * when the job saved it `failed` (T2), with `failureMessageOf` as the reason; "Incomplete" is
 * `isUnfinishedWorksheet`, which the api evaluates on the whole body (`unfinished`), so a sheet
 * that finished with placeholder questions or a missing answer is not called Ready.
 */
export function worksheetStatusLabel(
  item: Pick<WorksheetListItem, "generatingJobId" | "unfinished" | "generation">,
): "Making…" | "Ready" | "Incomplete" | "Didn’t finish" {
  if (item.generatingJobId) return "Making…";
  if (item.generation?.stage === "failed") return "Didn’t finish";
  return item.unfinished ? "Incomplete" : "Ready";
}

/** The saved reason of a failed sheet, in the teacher's words, or `null`. */
export function failureMessageOf(item: Pick<WorksheetListItem, "generation">): string | null {
  const failure = item.generation?.stage === "failed" ? item.generation.failure : undefined;
  if (!failure)
    return item.generation?.stage === "failed"
      ? WORKSHEET_FAILURE_MESSAGES["could-not-write"]
      : null;
  return failure.message || WORKSHEET_FAILURE_MESSAGES[failure.code];
}

/** Try again on a failed sheet: the request it was made with, at the lesson's current plan. */
export function retryIntentOf(
  lesson: Pick<Lesson, "plan">,
  item: Pick<WorksheetListItem, "generation">,
): WorksheetIntent | null {
  const generation = item.generation;
  if (generation?.stage !== "failed" || !lesson.plan) return null;
  return {
    recipeId: generation.recipeId,
    practiceMinutes: generation.practiceMinutes,
    expectedRevision: lesson.plan.revision,
  };
}

/**
 * The lesson's one Worksheet entry (ruling 186) as its sheets change: making while a job holds
 * one, ready once a job this screen watched finished, didn't finish while the newest sheet is
 * `failed`; otherwise the plain entry.
 */
export type WorksheetEntryState = "making" | "ready" | "failed" | "idle";
export function worksheetEntryState(
  items:
    | readonly Pick<WorksheetListItem, "generatingJobId" | "generation" | "updatedAt">[]
    | undefined,
  justFinished: boolean,
): WorksheetEntryState {
  if (!items?.length) return "idle";
  if (items.some((item) => item.generatingJobId)) return "making";
  const newest = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (newest?.generation?.stage === "failed") return "failed";
  return justFinished ? "ready" : "idle";
}
export const WORKSHEET_ENTRY_LABEL: Record<WorksheetEntryState, string> = {
  making: "Worksheet: making…",
  ready: "Worksheet ready · Open",
  failed: "Worksheet didn’t finish · Try again",
  idle: "Worksheet",
};

/**
 * The api's `409` inside the 30 s throttle slot (`WORKSHEET_QUEUED_MESSAGE` in
 * `apps/api/src/routes/lessons.ts`): no job holds a sheet, the slot is just taken.
 */
export const WORKSHEET_QUEUED_MESSAGE = "A worksheet for this lesson was requested a moment ago.";
export const WORKSHEET_SLOT_MS = 30_000;
export const TRYING_AGAIN_SHORTLY = "Trying again in a few seconds…";

function isQueuedRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 409 && error.message === WORKSHEET_QUEUED_MESSAGE
  );
}

/**
 * `requestLessonWorksheet`, retried once when the throttle slot refuses it: `onWaiting` fires,
 * then the request goes again just after the next slot opens (pg-boss slots are aligned to the
 * clock, so that is under 30 s away). Any other error, or a second refusal, is thrown.
 */
export async function requestWorksheetRetryingOnce(
  client: QueryClient,
  id: string,
  intent: WorksheetIntent,
  options: {
    onWaiting?: () => void;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    request?: typeof requestLessonWorksheet;
  } = {},
) {
  const request = options.request ?? requestLessonWorksheet;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    return await request(client, id, intent);
  } catch (error) {
    if (!isQueuedRefusal(error)) throw error;
    options.onWaiting?.();
    const now = (options.now ?? Date.now)();
    await wait(WORKSHEET_SLOT_MS - (now % WORKSHEET_SLOT_MS) + 1_000);
    return await request(client, id, intent);
  }
}
