import { useQueryClient } from "@tanstack/react-query";
import type { PromptEditAnswer, PromptEditPartial, PromptEditRequest } from "@tj/editor/lesson";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { sessionRequest } from "@/lib/session-boundary";

/** Said when the request itself fails (offline, rate-limited, a server error): nothing changed. */
export const PROMPT_EDIT_FAILED = "That edit didn’t work. Try again.";

/**
 * Edit with a prompt (TEACH-97): the chat pane's `onPromptEdit`, over `POST /lessons/:id/edit`.
 * The answer is applied by the editor as one undo step; anything but a 200 is a refusal in teacher
 * words with nothing changed. Stop aborts through `signal` (the abort is rethrown, not an answer),
 * which closes the request so the server stops the model call.
 *
 * With `onPartial` the request accepts `text/event-stream`: `partial` events (unchecked, for
 * display) are handed on as they arrive and the `final` event is the answer. A stream that ends
 * without `final` is a failure: nothing partial is ever applied.
 */
export function usePromptEdit(lessonId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (
      request: PromptEditRequest,
      signal?: AbortSignal,
      onPartial?: (partial: PromptEditPartial) => void,
    ): Promise<PromptEditAnswer> => {
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
          {
            ...sessionRequest(queryClient, signal),
            ...(onPartial ? { headers: { accept: "text/event-stream" } } : {}),
          },
        );
        if (res.status !== 200) return { action: "failed", reason: PROMPT_EDIT_FAILED };
        const streamed = (res.headers.get("content-type") ?? "").includes("text/event-stream");
        if (!streamed || !onPartial || !res.body) return (await res.json()) as PromptEditAnswer;
        return await readEditStream(res.body, onPartial);
      } catch (error) {
        if (signal?.aborted) throw error;
        return { action: "failed", reason: PROMPT_EDIT_FAILED };
      }
    },
    [lessonId, queryClient],
  );
}

/** Read the edit route's SSE body: hand on each `partial`, resolve with `final`. */
export async function readEditStream(
  body: ReadableStream<Uint8Array>,
  onPartial: (partial: PromptEditPartial) => void,
): Promise<PromptEditAnswer> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let cut = buffer.indexOf("\n\n");
    while (cut !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length === 0) continue;
      const parsed = JSON.parse(data.join("\n")) as unknown;
      if (event === "final") {
        await reader.cancel().catch(() => {});
        return parsed as PromptEditAnswer;
      }
      if (event === "partial") onPartial(parsed as PromptEditPartial);
    }
    if (done) return { action: "failed", reason: PROMPT_EDIT_FAILED };
  }
}
