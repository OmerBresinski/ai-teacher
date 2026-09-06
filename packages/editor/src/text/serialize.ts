import type { RichDoc, RichNode } from "@tj/domain/documents";

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
 * `baseExtensions` adds after it (underline, textStyle).
 */
const MARK_ORDER = ["link", "bold", "italic", "strike", "code", "underline", "textStyle"];

/** Link attributes in the order Tiptap writes them; `undefined` falls back, `null` is omitted. */
const LINK_ATTRS: [name: string, fallback: string | null][] = [
  ["target", "_blank"],
  ["rel", "noopener noreferrer"],
  ["class", null],
  ["href", null],
  ["title", null],
];

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
      // Tiptap emits the span even with no colour set.
      const color = typeof attrs.color === "string" ? attrs.color : null;
      return [color ? `<span style="color: ${escapeAttr(color)};">` : "<span>", "</span>"];
    }
    case "link": {
      const parts = LINK_ATTRS.flatMap(([name, fallback]) => {
        const raw = name in attrs ? attrs[name] : fallback;
        return typeof raw === "string" ? [`${name}="${escapeAttr(raw)}"`] : [];
      });
      return [`<a ${parts.join(" ")}>`, "</a>"];
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
 * Serialise a paragraph's inline children, keeping a mark open across consecutive nodes while it
 * is unchanged and closing from the innermost down to the first difference (ProseMirror's rule).
 */
function inline(children: RichNode[]): string {
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

function blocks(node: RichNode | RichDoc): string {
  return (node.content ?? []).map(render).join("");
}

function render(node: RichNode): string {
  switch (node.type) {
    case "paragraph": {
      // Tiptap writes the attribute whenever it is set, `left` included.
      const align = node.attrs?.textAlign;
      const style = typeof align === "string" ? ` style="text-align: ${escapeAttr(align)};"` : "";
      return `<p${style}>${inline(node.content ?? [])}</p>`;
    }
    case "bulletList":
      return `<ul>${blocks(node)}</ul>`;
    case "orderedList": {
      const start = node.attrs?.start;
      const attr = typeof start === "number" && start !== 1 ? ` start="${start}"` : "";
      return `<ol${attr}>${blocks(node)}</ol>`;
    }
    case "listItem":
      return `<li>${blocks(node)}</li>`;
    default:
      throw new UnknownRichNodeError(node.type);
  }
}

/** Serialise a rich doc to the HTML Tiptap would emit for it. Throws on unknown node types. */
export function serializeDoc(doc: RichDoc): string {
  return blocks(doc);
}
