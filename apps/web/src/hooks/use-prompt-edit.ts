import { useQueryClient } from "@tanstack/react-query";
import type { PromptEditAnswer, PromptEditRequest } from "@tj/editor/lesson";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { sessionRequest } from "@/lib/session-boundary";

/** Said when the request itself fails (offline, rate-limited, a server error): nothing changed. */
export const PROMPT_EDIT_FAILED = "That edit didn’t work. Try again.";

/**
 * Edit with a prompt (TEACH-97): the chat pane's `onPromptEdit`, over `POST /lessons/:id/edit`.
 * The answer is applied by the editor as one undo step; anything but a 200 is a refusal in teacher
 * words with nothing changed. Stop aborts through `signal` (the abort is rethrown, not an answer).
 */
export function usePromptEdit(lessonId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (request: PromptEditRequest, signal?: AbortSignal): Promise<PromptEditAnswer> => {
      try {
        const res = await api.lessons[":id"].edit.$post(
          {
            param: { id: lessonId },
            json: {
              slide: request.slide,
              ...(request.elementId ? { elementId: request.elementId } : {}),
              instruction: request.instruction,
              ...(request.history && request.history.length > 0
                ? { history: request.history }
                : {}),
            },
          },
          sessionRequest(queryClient, signal),
        );
        if (res.status !== 200) return { action: "failed", reason: PROMPT_EDIT_FAILED };
        return (await res.json()) as PromptEditAnswer;
      } catch (error) {
        if (signal?.aborted) throw error;
        return { action: "failed", reason: PROMPT_EDIT_FAILED };
      }
    },
    [lessonId, queryClient],
  );
}
