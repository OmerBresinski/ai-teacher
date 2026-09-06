import { z } from "zod";

/*
 * Source reference (ADR 0025 §20; F03). The entry F03 writes to `Lesson.sources`: a reference to
 * a teacher-provided material, never its extracted text — the worker's `SourceLoader` loads that.
 * Reserved now so the field name and shape are fixed before F03 fills it.
 */

export type SourceRef = {
  id: string;
  kind: "file" | "paste";
  /** The file name or the paste's label, shown to the teacher. */
  name: string;
  /** Storage key of the uploaded file (`file` only). */
  storageKey?: string;
  /** Page count of the file, when known. */
  pages?: number;
};

export const SourceRefSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["file", "paste"]),
  name: z.string(),
  storageKey: z.string().optional(),
  pages: z.number().int().nonnegative().optional(),
});
