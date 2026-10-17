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

/*
 * Run attributes on `textStyle` beyond `color` (TEACH-205 part c; rulings 238, 248). A run may carry
 * any mix of them:
 * - `font: "quote"` sets the run in the theme's quote face (a worked example's `x`, a source's words);
 * - `highlight: n` washes the run in colour slot n (1-4), never a hex: the theme owns the colour;
 * - `strikeStep: n` is the myth strike, an offset line through the x-height (not the `strike`
 *   mark, which is the font's own strikeout), shown from reveal step n (0 = from the start).
 */
export const RUN_FONTS = ["quote"] as const;
export type RunFont = (typeof RUN_FONTS)[number];
/** Colour slots a highlight can name (ruling 248: four, in a fixed hue order). */
export const HIGHLIGHT_SLOTS = 4;
/** The latest reveal step a strike may name (as `ImageElement.buildFrom`). */
const MAX_STRIKE_STEP = 64;

export const safeRunFont = (raw: unknown): RunFont | null =>
  typeof raw === "string" && (RUN_FONTS as readonly string[]).includes(raw)
    ? (raw as RunFont)
    : null;
export const safeHighlightSlot = (raw: unknown): number | null =>
  Number.isInteger(raw) && (raw as number) >= 1 && (raw as number) <= HIGHLIGHT_SLOTS
    ? (raw as number)
    : null;
export const safeStrikeStep = (raw: unknown): number | null =>
  Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= MAX_STRIKE_STEP
    ? (raw as number)
    : null;

/** The run attributes `textStyle` carries, as the renderers read them. */
export type RunStyleAttrs = {
  color?: string;
  font?: RunFont;
  highlight?: number;
  strikeStep?: number;
};

/** `inner`, or undefined (with a warning) when the stored value does not parse. */
const lenient = <T extends z.ZodType>(name: string, inner: T) =>
  inner.catch((ctx) => {
    console.warn(`[rich-text] dropped a bad textStyle.${name}: ${JSON.stringify(ctx.value)}`);
    return undefined as z.output<T>;
  });

/**
 * A text node's marks. A mark of a type this schema does not know (a stored lesson from an older
 * or newer editor) is dropped with a warning and its text kept, rather than refusing the whole
 * document. Known marks are still validated strictly: a `javascript:` link is refused (F01).
 */
const MarksSchema = z
  .array(z.unknown())
  .transform((marks) =>
    marks.filter((m) => {
      const type = (m as { type?: unknown } | null)?.type;
      const known =
        typeof type === "string" && (RICH_MARK_TYPES as readonly string[]).includes(type);
      if (!known) console.warn(`[rich-text] dropped an unknown mark: ${JSON.stringify(type)}`);
      return known;
    }),
  )
  .pipe(z.array(z.lazy(() => MarkSchema)));

const TextStyleAttrsSchema = z
  .object({
    color: nullish(
      z.string().refine((v) => safeCssColor(v) !== null, { message: "Not a CSS colour" }),
    ),
    // A bad run attribute is dropped (the run stays plain text), never the document: these are
    // looks, not safety, and an old or hand-edited lesson must still open (TEACH-205 part c review).
    font: lenient("font", nullish(z.enum(RUN_FONTS))),
    highlight: lenient("highlight", nullish(z.number().int().min(1).max(HIGHLIGHT_SLOTS))),
    strikeStep: lenient("strikeStep", nullish(z.number().int().min(0).max(MAX_STRIKE_STEP))),
  })
  .loose();

/** A text node with one `textStyle` mark carrying `attrs` (templates and tests build runs with it). */
export function styledRun(text: string, attrs: RunStyleAttrs): RichNode {
  const clean = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
  return Object.keys(clean).length === 0
    ? { type: "text", text }
    : { type: "text", text, marks: [{ type: "textStyle", attrs: clean }] };
}

/**
 * `doc` with every run colour (a `textStyle` mark's `color`) passed through `to`: one definition of
 * "a run's colour" for re-theming a doc (`withThemeColours`) and recolouring one (the hinge's dim
 * options). Marks without a colour, and every other attribute, are kept as they are.
 */
export function mapRunColours(doc: RichDoc, to: (color: string) => string | undefined): RichDoc {
  const walk = (nodes: RichNode[] | undefined): RichNode[] | undefined =>
    nodes?.map((n) => ({
      ...n,
      ...(n.marks
        ? {
            marks: n.marks.map((m) =>
              m.type === "textStyle" && typeof m.attrs?.color === "string"
                ? { ...m, attrs: { ...m.attrs, color: to(m.attrs.color) } }
                : m,
            ),
          }
        : {}),
      ...(n.content ? { content: walk(n.content) } : {}),
    }));
  return { ...doc, content: walk(doc.content) ?? [] };
}

/** The latest step any myth strike in `doc` names (0 when none): it is a step of the slide. */
export function richDocMaxStrikeStep(doc: RichDoc | RichNode): number {
  let max = 0;
  const stack: RichNode[] = [doc as RichNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    for (const mark of node.marks ?? []) {
      const step = mark.type === "textStyle" ? safeStrikeStep(mark.attrs?.strikeStep) : null;
      if (step !== null && step > max) max = step;
    }
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return max;
}

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
  marks: MarksSchema.optional(),
  attrs: EmptyAttrsSchema,
});

const HardBreakSchema = z.object({
  type: z.literal("hardBreak"),
  marks: MarksSchema.optional(),
  attrs: EmptyAttrsSchema,
});

const InlineSchema = z.union([TextNodeSchema, HardBreakSchema]);

const ParagraphSchema = z.object({
  type: z.literal("paragraph"),
  attrs: ParagraphAttrsSchema.optional(),
  content: z.array(InlineSchema).optional(),
});

type ListNode = RichNode;

const ListItemSchema: z.ZodType<ListNode> = z.lazy(() =>
  z.object({
    type: z.literal("listItem"),
    attrs: EmptyAttrsSchema,
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
