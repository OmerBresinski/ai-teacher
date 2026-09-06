import type { RichDoc, RichNode } from "@tj/domain/documents";

/**
 * A stored `RichDoc` is opaque to the domain schema (ADR 0021), which accepts what ProseMirror
 * would not: an empty text node throws `RangeError: Empty text nodes are not allowed` when it is
 * handed to Tiptap, and the editor would mount empty over a document that had words in it. This
 * is the boundary: strip empty text runs (and the empty arrays they leave behind), so what the
 * editor is given is what the static renderer drew. Pure; returns the same object when nothing
 * needed doing.
 */
export function normaliseDoc(doc: RichDoc): RichDoc {
  const content = normaliseChildren(doc.content);
  if (content === doc.content) return doc;
  return content ? { ...doc, content } : { type: "doc", content: [{ type: "paragraph" }] };
}

function normaliseChildren(nodes: RichNode[] | undefined): RichNode[] | undefined {
  if (!nodes) return nodes;
  let changed = false;
  const out: RichNode[] = [];
  for (const node of nodes) {
    const next = normaliseNode(node);
    if (next !== node) changed = true;
    if (next) out.push(next);
  }
  if (!changed) return nodes;
  return out.length ? out : undefined;
}

function normaliseNode(node: RichNode): RichNode | null {
  if (node.type === "text") return node.text ? node : null;
  if (!node.content) return node;
  const content = normaliseChildren(node.content);
  if (content === node.content) return node;
  if (!content) {
    // A text container with nothing left keeps its place as an empty node; ProseMirror accepts
    // `{ type: "paragraph" }` and draws a blank line, which is what the words leaving it left.
    const { content: _dropped, ...rest } = node;
    return rest;
  }
  return { ...node, content };
}
