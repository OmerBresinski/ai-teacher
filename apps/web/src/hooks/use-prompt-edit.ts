import { useQueryClient } from "@tanstack/react-query";
import type { PromptEditAnswer, PromptEditRequest } from "@tj/editor/lesson";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { sessionRequest } from "@/lib/session-boundary";

/** Said when the request itself fails (offline, rate-limited, a server error): nothing changed. */
export const PROMPT_EDIT_FAILED = "That edit didn’t work. Try again.";

/**
 * Edit with a prompt, fast path (TEACH-97 part d): the editor's `onPromptEdit`, over
 * `POST /lessons/:id/edit`. The answer is applied by the editor as one undo step; anything but a
 * 200 is a refusal in teacher words with nothing changed.
 */
export function usePromptEdit(lessonId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (request: PromptEditRequest): Promise<PromptEditAnswer> => {
      try {
        const res = await api.lessons[":id"].edit.$post(
          {
            param: { id: lessonId },
            json: {
              slide: request.slide,
              elementId: request.elementId,
              instruction: request.instruction,
            },
          },
          sessionRequest(queryClient),
        );
        if (res.status !== 200) return { action: "failed", reason: PROMPT_EDIT_FAILED };
        return (await res.json()) as PromptEditAnswer;
      } catch {
        return { action: "failed", reason: PROMPT_EDIT_FAILED };
      }
    },
    [lessonId, queryClient],
  );
}
