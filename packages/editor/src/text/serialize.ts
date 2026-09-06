import type { RichDoc, RichNode } from "@tj/domain/documents";

/*
 * Pure HTML serialiser for the rich-text schema `baseExtensions` produces (ADR 0022 §8, amended
 * TEACH-99): the viewer, present mode, print and the library's thumbnails render text through this
 * so none of them carries Tiptap or ProseMirror. `serialize.test.ts` holds it to byte parity with
 * `@tiptap/html`'s `generateHTML` over the same extension set, so a document written in the editor
 * reads back identically here.
 *
 * Node types: doc, paragraph (textAlign), text, hardBreak, bulletList, orderedList (start),
 * listItem. Marks (wrapped in Tiptap's schema order, link outermost): link (target, rel, href), bold,
 * italic, strike, code, underline, textStyle (color). Anything unknown throws so the caller falls back.
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
 * `baseExtensions` adds after it (underline, textStyle). `serialize.test.ts` pins it.
 */
const MARK_ORDER = ["link", "bold", "italic", "strike", "code", "underline", "textStyle"];

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
      const href = typeof attrs.href === "string" ? attrs.href : "";
      const target = typeof attrs.target === "string" ? attrs.target : "_blank";
      const rel = typeof attrs.rel === "string" ? attrs.rel : "noopener noreferrer";
      const cls = typeof attrs.class === "string" ? ` class="${escapeAttr(attrs.class)}"` : "";
      return [
        `<a target="${escapeAttr(target)}" rel="${escapeAttr(rel)}"${cls} href="${escapeAttr(href)}">`,
        "</a>",
      ];
    }
    default:
      throw new UnknownRichNodeError(mark.type);
  }
}

function text(node: RichNode): string {
  let html = escapeText(node.text ?? "");
  const marks = [...(node.marks ?? [])].sort(
    (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
  );
  // Innermost last: wrap from the end of the order outwards.
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const mark = marks[i];
    if (!mark) continue;
    const [open, close] = markTag(mark);
    html = open + html + close;
  }
  return html;
}

function children(node: RichNode | RichDoc): string {
  return (node.content ?? []).map(render).join("");
}

function render(node: RichNode): string {
  switch (node.type) {
    case "text":
      return text(node);
    case "hardBreak":
      return "<br>";
    case "paragraph": {
      // Tiptap writes the attribute whenever it is set, `left` included.
      const align = node.attrs?.textAlign;
      const style = typeof align === "string" ? ` style="text-align: ${escapeAttr(align)};"` : "";
      return `<p${style}>${children(node)}</p>`;
    }
    case "bulletList":
      return `<ul>${children(node)}</ul>`;
    case "orderedList": {
      const start = node.attrs?.start;
      const attr = typeof start === "number" && start !== 1 ? ` start="${start}"` : "";
      return `<ol${attr}>${children(node)}</ol>`;
    }
    case "listItem":
      return `<li>${children(node)}</li>`;
    default:
      throw new UnknownRichNodeError(node.type);
  }
}

/** Serialise a rich doc to the HTML Tiptap would emit for it. Throws on unknown node types. */
export function serializeDoc(doc: RichDoc): string {
  return children(doc);
}
