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

/**
 * The plain-text projection of a rich doc (ADR 0025 §10): text nodes joined in order, a line
 * break after every paragraph and list item, trailing breaks trimmed. Shared by `checkLesson` and
 * the Evaluate stage so the worker and the editor read the same words; behavioural twin of the
 * editor's `docToPlainText` (`packages/editor/src/text/static.ts`), kept here because the domain
 * package depends on `zod` only.
 */
export function richDocToPlainText(doc: RichDoc | RichNode): string {
  const out: string[] = [];
  const walk = (node: RichNode) => {
    if (node.text) out.push(node.text);
    for (const child of node.content ?? []) walk(child);
    if (node.type === "paragraph" || node.type === "listItem") out.push("\n");
  };
  walk(doc as RichNode);
  return out.join("").replace(/\n+$/, "");
}
