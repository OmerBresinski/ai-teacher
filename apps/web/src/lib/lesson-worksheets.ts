import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { z } from "zod";
import type { CharacterOrigin } from "@/components/lesson-creation/character-origin";
import { api } from "./api";
import { apiErrorFromResponse, type Me } from "./query";
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
export function canRequestWorksheet(lesson: Lesson, intent: WorksheetIntent) {
  return (
    lesson.plan?.state === "confirmed" &&
    lesson.plan.revision === intent.expectedRevision &&
    lesson.generation?.stage !== undefined &&
    !!lesson.facts
  );
}
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
