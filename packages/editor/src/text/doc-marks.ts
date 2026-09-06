import type { RichDoc, RichNode } from "@tj/domain/documents";

/**
 * Whole-element text formatting for when no Tiptap editor is mounted (TeachDeck
 * `components/editor/toolbar/doc-marks.ts`, verbatim).
 *
 * The toolbar has two modes: with a caret it drives the live editor, and with a text box merely
 * selected it rewrites the stored JSON. Both end in the same document shape, so a run of bold
 * survives the round trip either way.
 *
 * Everything here is pure and rebuilds the doc rather than cloning or mutating it: the cache hands
 * these functions a frozen object, and both cloning (structuredClone of a Proxy throws) and
 * mutating one would kill the buttons.
 */

export type DocMark = "bold" | "italic" | "underline";
export type ListType = "bulletList" | "orderedList";

const walkText = (node: RichNode | RichDoc, fn: (n: RichNode) => void) => {
  for (const child of node.content ?? []) {
    if (child.type === "text") fn(child);
    else walkText(child, fn);
  }
};

/** True when every text run already carries the mark (and there is text at all). */
export function docHasMark(doc: RichDoc | undefined, mark: DocMark): boolean {
  if (!doc) return false;
  let any = false;
  let all = true;
  walkText(doc, (n) => {
    any = true;
    if (!n.marks?.some((m) => m.type === mark)) all = false;
  });
  return any && all;
}

/** A fresh node with the mark added to, or removed from, every text run below it. */
function withMark(node: RichNode, mark: DocMark, on: boolean): RichNode {
  if (node.type === "text") {
    const kept = (node.marks ?? []).filter((m) => m.type !== mark);
    const marks = on ? [...kept, { type: mark }] : kept;
    const next: RichNode = { ...node };
    // An empty array reads as "explicitly unmarked" to Tiptap's schema, so drop the key.
    if (marks.length > 0) next.marks = marks;
    else delete next.marks;
    return next;
  }
  if (!node.content) return { ...node };
  return { ...node, content: node.content.map((child) => withMark(child, mark, on)) };
}

export function toggleDocMark(doc: RichDoc, mark: DocMark): RichDoc {
  const on = !docHasMark(doc, mark);
  if (!doc.content) return { ...doc };
  return { ...doc, content: doc.content.map((node) => withMark(node, mark, on)) };
}

export function docListType(doc: RichDoc | undefined): ListType | null {
  const first = doc?.content?.[0]?.type;
  return first === "bulletList" || first === "orderedList" ? first : null;
}

/** Wrap every paragraph in a list, or unwrap the list back into paragraphs. */
export function setDocList(doc: RichDoc, type: ListType | null): RichDoc {
  const paragraphs: RichNode[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === "bulletList" || node.type === "orderedList") {
      for (const item of node.content ?? []) paragraphs.push(...(item.content ?? []));
    } else {
      paragraphs.push(node);
    }
  }
  if (!type) return { type: "doc", content: paragraphs };
  return {
    type: "doc",
    content: [{ type, content: paragraphs.map((p) => ({ type: "listItem", content: [p] })) }],
  };
}
