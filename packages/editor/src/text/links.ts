import type { RichDoc, RichNode } from "@tj/domain/documents";

/**
 * The link mark, off the editor (TeachDeck `lib/text/links.ts`). `normaliseHref` itself lives in
 * `@tj/domain/documents` (ADR 0021); these are the doc-rewriting halves. Pure, like `doc-marks`.
 */

export { isLinkableHref, normaliseHref } from "@tj/domain/documents";

const walkText = (node: RichNode | RichDoc, fn: (n: RichNode) => void) => {
  for (const child of node.content ?? []) {
    if (child.type === "text") fn(child);
    else walkText(child, fn);
  }
};

/** The address of the first link in the doc, for seeding the field. */
export function docLinkHref(doc: RichDoc | undefined): string | null {
  if (!doc) return null;
  let href: string | null = null;
  walkText(doc, (n) => {
    if (href) return;
    const mark = n.marks?.find((m) => m.type === "link");
    const value = mark?.attrs?.href;
    if (typeof value === "string" && value) href = value;
  });
  return href;
}

function withLink(node: RichNode, href: string | null): RichNode {
  if (node.type === "text") {
    const kept = (node.marks ?? []).filter((m) => m.type !== "link");
    const marks = href ? [...kept, { type: "link", attrs: { href } }] : kept;
    const next: RichNode = { ...node };
    // An empty array reads as "explicitly unmarked" to Tiptap's schema, so drop the key.
    if (marks.length > 0) next.marks = marks;
    else delete next.marks;
    return next;
  }
  if (!node.content) return { ...node };
  return { ...node, content: node.content.map((child) => withLink(child, href)) };
}

/** Link the whole box, or strip every link in it. */
export function setDocLink(doc: RichDoc, href: string | null): RichDoc {
  if (!doc.content) return { ...doc };
  return { ...doc, content: doc.content.map((node) => withLink(node, href)) };
}
