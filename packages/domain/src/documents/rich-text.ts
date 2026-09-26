import { z } from "zod";
import { normaliseHref } from "./links";

/*
 * Rich text (ADR 0021, amended by TEACH-277). A ProseMirror/Tiptap JSON document. The schema is
 * closed: only the node and mark types `packages/editor/src/text/extensions.ts` produces are
 * accepted, and every attribute the static serialiser writes into HTML (`href`, `target`, `rel`,
 * `title`, `color`, `textAlign`, `start`) is validated here, at the Import / POST / PUT boundary.
 * Attribute keys the serialiser never emits are tolerated (Tiptap adds inert ones such as
 * `orderedList.type: null` between versions) but never reach markup. Behavioural reference:
 * TeachDeck `lib/model/types.ts` `RichDoc`/`RichNode` and `lib/model/schema.ts:17-37`.
 *
 * Audit F01 (13 September 2026): a link mark with `href: "javascript:…"` and `target: "_self"`
 * passed the previous opaque schema, was stored by POST /documents and executed on click in the
 * viewer. The renderer (`packages/editor/src/text/serialize.ts`) validates the same attributes
 * again with the helpers below, so Documents stored before this change are also safe.
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

/** Node types `baseExtensions` produces (StarterKit minus heading/codeBlock/blockquote/hr). */
export const RICH_NODE_TYPES = [
  "paragraph",
  "text",
  "hardBreak",
  "bulletList",
  "orderedList",
  "listItem",
] as const;

/** Mark types `baseExtensions` produces. */
export const RICH_MARK_TYPES = [
  "link",
  "bold",
  "italic",
  "strike",
  "code",
  "underline",
  "textStyle",
] as const;

/** Nesting deeper than this is refused before any recursive parse (lists nest ~3 deep). */
export const RICH_DOC_MAX_DEPTH = 64;

export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;

/** ASCII control characters (incl. NUL and TAB/LF/CR, which URL parsers silently strip). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to refuse them.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A stored `href` that is safe to hang off an `<a>`: it already carries an allowed scheme
 * literally (so nothing is prepended and no destination is invented), contains no control
 * characters (which `new URL` would strip, turning `java\tscript:` into `javascript:`) and parses
 * under `normaliseHref`'s rules. Returns the value verbatim (trimmed) or null.
 */
export function safeLinkHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || CONTROL.test(value)) return null;
  if (!/^(https?|mailto):/i.test(value)) return null;
  return normaliseHref(value) === null ? null : value;
}

/**
 * A CSS colour the `textStyle` mark may carry: a hex triplet/sextet(/octet), a `rgb()`/`hsl()`
 * function of digits, percentages, dots, commas, spaces and slashes, or a bare keyword. Nothing
 * that can close the declaration or reach `url(`/`expression(`.
 */
const CSS_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|rgba|hsl|hsla)\([\d\s.,%/-]*\))$/i;
export const safeCssColor = (raw: unknown): string | null =>
  typeof raw === "string" && CSS_COLOR.test(raw.trim()) ? raw.trim() : null;

const REL_TOKEN = /^(noopener|noreferrer|nofollow|external)$/;
/** `rel` is a space-separated list of a few known tokens; anything else is dropped. */
export const safeLinkRel = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => REL_TOKEN.test(t)) ? tokens.join(" ") : null;
};

export const safeTextAlign = (raw: unknown): (typeof TEXT_ALIGNS)[number] | null =>
  typeof raw === "string" && (TEXT_ALIGNS as readonly string[]).includes(raw)
    ? (raw as (typeof TEXT_ALIGNS)[number])
    : null;

const nullish = <T extends z.ZodTypeAny>(inner: T) => inner.nullable().optional();

/** Attribute objects: known keys validated, unknown keys tolerated (never rendered). */
const LinkAttrsSchema = z
  .object({
    href: z.string().refine((v) => safeLinkHref(v) !== null, {
      message: "Link addresses must be http(s) or mailto",
    }),
    // Tiptap always writes `_blank`; an imported `_self`/`_parent`/`_top` is refused.
    target: nullish(z.literal("_blank")),
    rel: nullish(z.string().refine((v) => safeLinkRel(v) !== null, { message: "Unknown rel" })),
    class: nullish(z.string().max(200)),
    title: nullish(z.string().max(500)),
  })
  .loose();

const TextStyleAttrsSchema = z
  .object({
    color: nullish(
      z.string().refine((v) => safeCssColor(v) !== null, { message: "Not a CSS colour" }),
    ),
  })
  .loose();

const EmptyAttrsSchema = z.object({}).loose().optional();

const MarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link"), attrs: LinkAttrsSchema }),
  z.object({ type: z.literal("textStyle"), attrs: TextStyleAttrsSchema.optional() }),
  z.object({ type: z.literal("bold"), attrs: EmptyAttrsSchema }),
  z.object({ type: z.literal("italic"), attrs: EmptyAttrsSchema }),
  z.object({ type: z.literal("strike"), attrs: EmptyAttrsSchema }),
  z.object({ type: z.literal("code"), attrs: EmptyAttrsSchema }),
  z.object({ type: z.literal("underline"), attrs: EmptyAttrsSchema }),
]);

const ParagraphAttrsSchema = z.object({ textAlign: nullish(z.enum(TEXT_ALIGNS)) }).loose();
const OrderedListAttrsSchema = z
  .object({ start: nullish(z.number().int().min(0).max(1_000_000)) })
  .loose();

const TextNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(MarkSchema).optional(),
  attrs: EmptyAttrsSchema,
});

const HardBreakSchema = z.object({
  type: z.literal("hardBreak"),
  marks: z.array(MarkSchema).optional(),
  attrs: EmptyAttrsSchema,
});

const InlineSchema = z.union([TextNodeSchema, HardBreakSchema]);

const ParagraphSchema = z.object({
  type: z.literal("paragraph"),
  attrs: ParagraphAttrsSchema.optional(),
  content: z.array(InlineSchema).optional(),
});

type ListNode = RichNode;

/**
 * A list item may name the fact it stands for (ruling 96): each line of the objectives slide
 * carries its objective's id, so an edit on the line is an edit to that objective. Never rendered.
 */
const ListItemAttrsSchema = z.object({ factId: nullish(z.string().min(1).max(64)) }).loose();

const ListItemSchema: z.ZodType<ListNode> = z.lazy(() =>
  z.object({
    type: z.literal("listItem"),
    attrs: ListItemAttrsSchema.optional(),
    content: z.array(BlockSchema).optional(),
  }),
) as z.ZodType<ListNode>;

const BlockSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.union([
    ParagraphSchema,
    z.object({
      type: z.literal("bulletList"),
      attrs: EmptyAttrsSchema,
      content: z.array(ListItemSchema).optional(),
    }),
    z.object({
      type: z.literal("orderedList"),
      attrs: OrderedListAttrsSchema.optional(),
      content: z.array(ListItemSchema).optional(),
    }),
  ]),
) as z.ZodType<RichNode>;

/**
 * Depth of the deepest `content` chain, computed iteratively so hostile input cannot blow the
 * stack. Stops counting past `RICH_DOC_MAX_DEPTH`. Renderers use it too: a Document stored before
 * the schema was closed may nest deeper than any recursive walk can afford.
 */
export function richDocDepth(root: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const [node, depth] = next;
    if (depth > max) max = depth;
    if (depth > RICH_DOC_MAX_DEPTH) return depth;
    if (typeof node !== "object" || node === null) continue;
    const content = (node as { content?: unknown }).content;
    if (Array.isArray(content)) for (const child of content) stack.push([child, depth + 1]);
  }
  return max;
}

const withDepthBound = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .unknown()
    .superRefine((value, ctx) => {
      if (richDocDepth(value) > RICH_DOC_MAX_DEPTH) {
        ctx.addIssue({
          code: "custom",
          message: `Rich text nests deeper than ${RICH_DOC_MAX_DEPTH}`,
        });
      }
    })
    .pipe(schema);

/** Any single node of the closed schema (block or inline). */
export const RichNodeSchema: z.ZodType<RichNode> = withDepthBound(
  z.union([BlockSchema, ListItemSchema, InlineSchema]),
) as z.ZodType<RichNode>;

export const RichDocSchema: z.ZodType<RichDoc> = withDepthBound(
  z.object({
    type: z.literal("doc"),
    content: z.array(BlockSchema).optional(),
  }),
) as z.ZodType<RichDoc>;

/**
 * The plain-text projection of a rich doc (ADR 0025 §10): text nodes joined in order, a line
 * break after every paragraph and list item, trailing breaks trimmed. Shared by `checkLesson` and
 * the Evaluate stage so the worker and the editor read the same words; behavioural twin of the
 * editor's `docToPlainText` (`packages/editor/src/text/static.ts`), kept here because the domain
 * package depends on `zod` only.
 */
export function richDocToPlainText(doc: RichDoc | RichNode): string {
  const out: string[] = [];
  // Iterative (explicit stack) so a deeply nested legacy doc cannot overflow the call stack.
  const stack: (RichNode | { after: RichNode })[] = [doc as RichNode];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    if ("after" in item) {
      const { after } = item;
      if (after.type === "paragraph" || after.type === "listItem") out.push("\n");
      continue;
    }
    if (item.text) out.push(item.text);
    stack.push({ after: item });
    const children = item.content ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
  return out.join("").replace(/\n+$/, "");
}
