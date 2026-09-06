import { z } from "zod";

/*
 * Rich text (ADR 0021). A ProseMirror/Tiptap JSON document, kept opaque here; the editor's
 * `text/` helpers know the node types. Behavioural reference: TeachDeck `lib/model/types.ts`
 * `RichDoc`/`RichNode` and `lib/model/schema.ts:17-37`.
 */

export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export type RichDoc = {
  type: "doc";
  content?: RichNode[];
};

const AttrsSchema = z.record(z.string(), z.unknown());

const MarkSchema = z.object({
  type: z.string(),
  attrs: AttrsSchema.optional(),
});

export const RichNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: AttrsSchema.optional(),
    content: z.array(RichNodeSchema).optional(),
    marks: z.array(MarkSchema).optional(),
    text: z.string().optional(),
  }),
) as z.ZodType<RichNode>;

export const RichDocSchema: z.ZodType<RichDoc> = z.object({
  type: z.literal("doc"),
  content: z.array(RichNodeSchema).optional(),
});
