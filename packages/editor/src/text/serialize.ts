import {
  type RichDoc,
  type RichNode,
  safeCssColor,
  safeHighlightSlot,
  safeLinkHref,
  safeLinkRel,
  safeRunFont,
  safeStrikeStep,
  safeTextAlign,
} from "@tj/domain/documents";
import { findFractions } from "./fractions";

/*
 * Pure HTML serialiser for the rich-text schema `baseExtensions` produces (ADR 0022 §8, amended
 * TEACH-99): the viewer, present mode, print and the library's thumbnails render text through this
 * so none of them carries Tiptap or ProseMirror. `serialize.test.ts` holds it to byte parity with
 * `@tiptap/html`'s `generateHTML` over the same extension set, so a document written in the editor
 * reads back identically here.
 *
 * Node types: doc, paragraph (textAlign), text, hardBreak, bulletList, orderedList (start),
 * listItem. Marks, in the schema's order (link outermost): link, bold, italic, strike, code,
 * underline, textStyle. Inline marks are serialised the way ProseMirror's `DOMSerializer` does it:
 * a mark that continues unchanged onto the next inline node stays open, so `<strong>a<br>b</strong>`
 * rather than one wrapper per node. Anything unknown throws so the caller falls back.
 *
 * Security (TEACH-277, audit F01): this is the last line before `dangerouslySetInnerHTML`, so it
 * does not trust stored attributes even though `RichDocSchema` validates them on the way in — a
 * Document stored before that schema existed may carry `href: "javascript:…"`. A link whose href
 * is not an http(s)/mailto address renders as its text with no `<a>`; `target` is always `_blank`;
 * `rel` and `color`/`text-align` values outside their allow-lists are dropped.
 */

export class UnknownRichNodeError extends Error {
  constructor(type: string) {
    super(`Unknown rich-text node or mark "${type}"`);
  }
}

const escapeText = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

const escapeAttr = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

type Mark = NonNullable<RichNode["marks"]>[number];

/**
 * Tiptap wraps marks outermost-first in this order — the mark *schema* order, which is the
 * StarterKit's registration order (link, bold, italic, strike, code, …) followed by the extensions
 * `baseExtensions` adds after it (underline, textStyle). Kept as stored lessons have always
 * serialised it, so old coloured bold stays byte-identical (TEACH-205 part c review): a run with
 * both bold and a textStyle is `<strong><span …>`, where the live editor would nest the span
 * outside. Only the textStyle span's new data attributes are new bytes.
 */
const MARK_ORDER = ["link", "bold", "italic", "strike", "code", "underline", "textStyle"];

const DEFAULT_REL = "noopener noreferrer";

/**
 * `<a …>` for a link mark, in the attribute order Tiptap writes (target, rel, class, href, title),
 * or null when the href is not safe to emit. `undefined` falls back, `null` is omitted.
 */
function linkOpenTag(attrs: Record<string, unknown>): string | null {
  const href = safeLinkHref(attrs.href);
  if (href === null) return null;
  const parts = [`target="_blank"`];
  const rel = "rel" in attrs ? attrs.rel : DEFAULT_REL;
  if (rel !== null) parts.push(`rel="${escapeAttr(safeLinkRel(rel) ?? DEFAULT_REL)}"`);
  if (typeof attrs.class === "string") parts.push(`class="${escapeAttr(attrs.class)}"`);
  parts.push(`href="${escapeAttr(href)}"`);
  if (typeof attrs.title === "string") parts.push(`title="${escapeAttr(attrs.title)}"`);
  return `<a ${parts.join(" ")}>`;
}

function markTag(mark: Mark): [open: string, close: string] {
  const attrs = mark.attrs ?? {};
  switch (mark.type) {
    case "bold":
      return ["<strong>", "</strong>"];
    case "italic":
      return ["<em>", "</em>"];
    case "underline":
      return ["<u>", "</u>"];
    case "strike":
      return ["<s>", "</s>"];
    case "code":
      return ["<code>", "</code>"];
    case "textStyle": {
      // Tiptap emits the span even with no colour set; the run attributes follow the colour in
      // extension order (`run-style.ts`, TEACH-205 part c), as data attributes only.
      const color = safeCssColor(attrs.color);
      const parts = color ? [`style="color: ${escapeAttr(color)};"`] : [];
      // A live slide's laid-out words not typed yet (transparent) are not read out either.
      if (color === "transparent") parts.push('aria-hidden="true"');
      const font = safeRunFont(attrs.font);
      if (font) parts.push(`data-font="${font}"`);
      const slot = safeHighlightSlot(attrs.highlight);
      if (slot !== null) parts.push(`data-hl="${slot}"`);
      const strike = safeStrikeStep(attrs.strikeStep);
      if (strike !== null) parts.push(`data-strike="${strike}"`);
      return [parts.length ? `<span ${parts.join(" ")}>` : "<span>", "</span>"];
    }
    case "link": {
      const open = linkOpenTag(attrs);
      // An unsafe address (javascript:, data:, a control character in the scheme, …) is not a
      // link: the text stays, the anchor goes.
      return open === null ? ["", ""] : [open, "</a>"];
    }
    default:
      throw new UnknownRichNodeError(mark.type);
  }
}

const sortMarks = (marks: Mark[] | undefined): Mark[] =>
  [...(marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));

const sameMark = (a: Mark, b: Mark): boolean =>
  a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});

function inlineContent(node: RichNode): string {
  if (node.type === "text") return escapeText(node.text ?? "");
  if (node.type === "hardBreak") return "<br>";
  throw new UnknownRichNodeError(node.type);
}

/**
 * Serialise inline children, keeping a mark open across consecutive nodes while it
 * is unchanged and closing from the innermost down to the first difference (ProseMirror's rule).
 */
function runs(children: RichNode[]): string {
  let out = "";
  let open: Mark[] = [];
  for (const node of children) {
    const next = sortMarks(node.marks);
    let keep = 0;
    while (keep < open.length && keep < next.length) {
      const a = open[keep];
      const b = next[keep];
      if (!a || !b || !sameMark(a, b)) break;
      keep += 1;
    }
    for (let i = open.length - 1; i >= keep; i -= 1) {
      const mark = open[i];
      if (mark) out += markTag(mark)[1];
    }
    for (let i = keep; i < next.length; i += 1) {
      const mark = next[i];
      if (mark) out += markTag(mark)[0];
    }
    open = next;
    out += inlineContent(node);
  }
  for (let i = open.length - 1; i >= 0; i -= 1) {
    const mark = open[i];
    if (mark) out += markTag(mark)[1];
  }
  return out;
}

/** The inline nodes covering characters `[a, b)` of their text (a hard break is one character). */
function slice(children: RichNode[], a: number, b: number): RichNode[] {
  const out: RichNode[] = [];
  let at = 0;
  for (const node of children) {
    const len = node.type === "text" ? (node.text ?? "").length : 1;
    const from = Math.max(a, at);
    const to = Math.min(b, at + len);
    if (from < to) {
      if (node.type !== "text") out.push(node);
      else out.push({ ...node, text: (node.text ?? "").slice(from - at, to - at) });
    }
    at += len;
  }
  return out;
}

/** The colour every run of a fraction shares, so its bar is drawn in it; else none. */
function sharedColour(nodes: RichNode[]): string | null {
  const colours = new Set(
    nodes.map(
      (n) => safeCssColor(n.marks?.find((m) => m.type === "textStyle")?.attrs?.color) ?? null,
    ),
  );
  const [only] = colours;
  return colours.size === 1 && only ? only : null;
}

const SR = (s: string) => `<span class="td-frac-sr">${s}</span>`;

/**
 * One side of a fraction. A bracketed side drops its brackets from view, as a stacked fraction
 * needs none (`(x + 2)/3` is x + 2 over 3); they stay for reading like the slash.
 */
function fractionPart(nodes: RichNode[], cls: string): string {
  const text = nodes.map((n) => (n.type === "text" ? (n.text ?? "") : "\n")).join("");
  const bracketed = text.length > 2 && text.startsWith("(") && text.endsWith(")");
  const body = bracketed ? SR("(") + runs(slice(nodes, 1, text.length - 1)) + SR(")") : runs(nodes);
  return `<span class="${cls}">${body}</span>`;
}

/**
 * A fraction set stacked (`fractions.ts`): numerator over a bar over denominator. The slash stays
 * in the DOM, visually hidden, so a screen reader reads and a copy carries "x/4" as written.
 */
function fraction(num: RichNode[], den: RichNode[]): string {
  const colour = sharedColour([...num, ...den]);
  const style = colour ? ` style="color: ${escapeAttr(colour)};"` : "";
  return (
    `<span class="td-frac"${style}>${fractionPart(num, "td-frac-num")}` +
    `${SR("/")}${fractionPart(den, "td-frac-den")}</span>`
  );
}

/**
 * A paragraph's inline children. With `fractions` (the renderer, not the Tiptap parity path) a
 * fraction in maths is set stacked; marks close before it and reopen inside each part.
 */
function inline(children: RichNode[], fractions: boolean, maths = false): string {
  if (!fractions) return runs(children);
  const text = children
    .map((n) => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : "\uFFFC"))
    .join("");
  const found = findFractions(text, { maths });
  if (!found.length) return runs(children);
  let out = "";
  let at = 0;
  for (const f of found) {
    out += runs(slice(children, at, f.start));
    out += fraction(slice(children, f.start, f.slash), slice(children, f.slash + 1, f.end));
    at = f.end;
  }
  return out + runs(slice(children, at, text.length));
}

/** `maths`: the box holds maths (`@tj/slides/maths-text` `mathsElement`), its fractions found as such. */
type Options = { fractions: boolean; maths?: boolean };

function blocks(node: RichNode | RichDoc, o: Options): string {
  return (node.content ?? []).map((n) => render(n, o)).join("");
}

function render(node: RichNode, o: Options): string {
  switch (node.type) {
    case "paragraph": {
      // Tiptap writes the attribute whenever it is set, `left` included.
      const align = safeTextAlign(node.attrs?.textAlign);
      const style = align ? ` style="text-align: ${align};"` : "";
      return `<p${style}>${inline(node.content ?? [], o.fractions, o.maths)}</p>`;
    }
    case "bulletList":
      return `<ul>${blocks(node, o)}</ul>`;
    case "orderedList": {
      const start = node.attrs?.start;
      const attr =
        typeof start === "number" && Number.isInteger(start) && start !== 1
          ? ` start="${start}"`
          : "";
      return `<ol${attr}>${blocks(node, o)}</ol>`;
    }
    case "listItem":
      return `<li>${blocks(node, o)}</li>`;
    default:
      throw new UnknownRichNodeError(node.type);
  }
}

/**
 * Serialise a rich doc to the HTML Tiptap would emit for it. Throws on unknown node types. With
 * `fractions`, maths fractions are set stacked (`fractions.ts`), which Tiptap does not do: the
 * renderer asks for it, the parity tests do not.
 */
export function serializeDoc(doc: RichDoc, options: Partial<Options> = {}): string {
  return blocks(doc, { fractions: options.fractions ?? false, maths: options.maths ?? false });
}

/**
 * One line of plain text (a worksheet answer-key line, which is a string, not a doc) as inline
 * HTML: escaped, with its maths fractions set stacked by the same finder and markup as a doc's
 * paragraphs, so a key line and a question stem draw 3/4 the same way.
 */
export function plainLineHTML(text: string): string {
  return text ? inline([{ type: "text", text }], true) : "";
}
