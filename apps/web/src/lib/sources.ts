import type { UseMutationOptions } from "@tanstack/react-query";
import type { SourceRef } from "@tj/domain/documents";
import { api } from "./api";
import { apiErrorFromResponse } from "./query";

/*
 * Sources (ADR 0027 §7): the drop zone's two calls. `POST /sources` takes one file or one paste
 * as multipart — `hc` builds the `FormData` and its boundary itself, so no `Content-Type` is set
 * here — and answers with the `SourceRef` the brief sends back in `sourceIds`. A refusal is a
 * `422` whose `ApiError.reason` names the screen and whose `message` is shown verbatim.
 */

export type UploadSourceInput = { file: File } | { text: string; name?: string };

/** Client-side cap, so a 200 MB drop is refused before a request (the API's own cap is 25 MB). */
export const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SOURCES = 3;
export const FILE_TOO_LARGE_MESSAGE = "This file is over 25 MB.";
export const SOURCE_ACCEPT = ".pdf,.pptx,.docx";

export const sourceMutations = {
  upload: (): UseMutationOptions<SourceRef, Error, UploadSourceInput> => ({
    mutationFn: async (input) => {
      const form = "file" in input ? { file: input.file } : { text: input.text, name: input.name };
      const res = await api.sources.$post({ form });
      if (res.status !== 201) throw await apiErrorFromResponse(res);
      return (await res.json()).source;
    },
  }),
  remove: (): UseMutationOptions<void, Error, string> => ({
    mutationFn: async (id) => {
      const res = await api.sources[":id"].$delete({ param: { id } });
      if (res.status !== 204) throw await apiErrorFromResponse(res);
    },
  }),
};

/** The chip's second line: "12 pages", "30 slides", "1 page" or "text". */
export function describeSource(ref: SourceRef): string {
  if (ref.kind === "paste") return "text";
  const ext = ref.name.split(".").pop()?.toLowerCase();
  const n = ref.pages ?? 0;
  if (ext === "pptx") return `${n} ${n === 1 ? "slide" : "slides"}`;
  return `${n} ${n === 1 ? "page" : "pages"}`;
}
