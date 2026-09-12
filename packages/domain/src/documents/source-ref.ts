import { z } from "zod";

/*
 * Source reference (ADR 0025 §20, ADR 0027 §3; F03). The entry `POST /lessons` writes to
 * `Lesson.sources`: a reference to a teacher-provided material, never its extracted text — the
 * worker's `SourceLoader` reads that from the Source's `extracted.json` (`ExtractedSource` below).
 */

export type SourceRef = {
  id: string;
  kind: "file" | "paste";
  /** The file name or the paste's label, shown to the teacher. */
  name: string;
  /** Storage key of the original object (`original.<ext>`; `original.txt` for a paste). */
  storageKey?: string;
  /** Pages (PDF) or slides (PPTX) of the file, when known; 1 for a DOCX or a paste. */
  pages?: number;
};

export const SourceRefSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["file", "paste"]),
  name: z.string(),
  storageKey: z.string().optional(),
  pages: z.number().int().nonnegative().optional(),
});

/**
 * Where a chunk of extracted text came from (ADR 0027 §3): `page` for a PDF, `slide` for a PPTX,
 * `section` (the nearest heading) for a DOCX or a paste. Rendered to the Plan prompts as
 * `[src p.3]`, `[src slide 4]`, `[src §Heading]`.
 */
export const SourceLocatorSchema = z.strictObject({
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  section: z.string().max(120).optional(),
});
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;

/**
 * `<ws>/sources/<id>/extracted.json` — what `POST /sources` writes after extraction and screening
 * and what the worker's `SourceLoader` reads (ADR 0027 §3, §6). `kind` is the document format;
 * `lowText` marks a document whose text was thin but which carried images (§8). `images` are
 * references to the stored objects under `<ws>/sources/<id>/img/`, never bytes.
 */
export const ExtractedSourceSchema = z.strictObject({
  version: z.literal(1),
  sourceId: z.string(),
  kind: z.enum(["pdf", "pptx", "docx", "paste"]),
  pages: z.number().int().nonnegative(),
  lowText: z.boolean(),
  chunks: z.array(z.strictObject({ ref: SourceLocatorSchema, text: z.string() })),
  images: z.array(
    z.strictObject({ ref: SourceLocatorSchema, storageKey: z.string(), mime: z.string() }),
  ),
});
export type ExtractedSource = z.infer<typeof ExtractedSourceSchema>;
