import { notifyManager, type QueryClient } from "@tanstack/react-query";
import type { GenerateLessonInput, PlanLessonInput } from "@tj/domain/documents";
import { GenerateLessonSchema, type Lesson, PlanLessonSchema } from "@tj/domain/documents";
import { api } from "./api";
import type { DocumentMeta } from "./library";
import { apiErrorFromResponse, queryKeys } from "./query";
import { assertCurrentSession, sessionRequest } from "./session-boundary";

export async function replanLesson(client: QueryClient, id: string, input: PlanLessonInput) {
  const res = await api.lessons[":id"].plan.$post(
    { param: { id }, json: PlanLessonSchema.parse(input) },
    sessionRequest(client),
  );
  if (res.status !== 202) throw await apiErrorFromResponse(res);
  const result = await res.json();
  assertCurrentSession(client);
  return result;
}
export async function confirmLesson(client: QueryClient, id: string, input: GenerateLessonInput) {
  const res = await api.lessons[":id"].generate.$post(
    { param: { id }, json: GenerateLessonSchema.parse(input) },
    sessionRequest(client),
  );
  if (res.status !== 202) throw await apiErrorFromResponse(res);
  const result = await res.json();
  assertCurrentSession(client);
  return result;
}
/** A new local row has a UUID; only server fact ids are returned to /generate. */
export function objectiveEdits(lesson: Lesson, drafts: { id: string; text: string }[]) {
  const existing = new Set(lesson.facts?.objectives.map(({ id }) => id));
  return drafts.map(({ id, text }) => ({ ...(existing.has(id) ? { id } : {}), text }));
}

/** Install the accepted server lock before mounting an editor with an infinitely fresh plan cache. */
export async function seedConfirmedGeneration(
  client: QueryClient,
  lesson: Lesson,
  result: { jobId: string; revision: number },
) {
  const documentKey = queryKeys.libraryDocument(lesson.id);
  const metaKey = queryKeys.libraryDocumentMeta(lesson.id);
  await Promise.all([
    client.cancelQueries({ queryKey: documentKey, exact: true }),
    client.cancelQueries({ queryKey: metaKey, exact: true }),
  ]);
  assertCurrentSession(client);
  const revisionChanged = result.revision !== lesson.plan?.revision;
  const confirmed: Lesson = {
    ...lesson,
    plan: { revision: result.revision, state: "confirmed", jobId: result.jobId },
    // A pinned replan has not verified its new facts yet. Do not start the worksheet from old facts.
    ...(revisionChanged ? { facts: undefined, generation: undefined } : {}),
  };
  notifyManager.batch(() => {
    client.setQueryData<DocumentMeta>(metaKey, (meta) => ({
      createdAt: lesson.createdAt,
      updatedAt: lesson.updatedAt,
      deletedAt: null,
      ...meta,
      generatingJobId: result.jobId,
    }));
    client.setQueryData(documentKey, confirmed);
  });
  // Mount refetches the real document; the interim body is always protected by the accepted lock.
  await client.invalidateQueries({ queryKey: documentKey, exact: true, refetchType: "none" });
}
