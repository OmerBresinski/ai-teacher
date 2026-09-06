import type { RichDoc, RichNode } from "@tj/domain/documents";
import { serializeDoc } from "./serialize";

const cache = new WeakMap<RichDoc, string>();

/**
 * Render a rich doc to HTML with no editor instance. Pure TypeScript (`./serialize`), so the
 * viewer, present, print and thumbnail chunks carry no Tiptap; parity with `@tiptap/html` is held
 * by `serialize.test.ts`. A doc the serialiser does not understand falls back to escaped plain text.
 */
export function renderDocHTML(doc: RichDoc): string {
  const hit = cache.get(doc);
  if (hit) return hit;
  let html = "";
  try {
    html = serializeDoc(doc);
  } catch {
    html = `<p>${escapeHtml(docToPlainText(doc))}</p>`;
  }
  cache.set(doc, html);
  return html;
}

export function docToPlainText(doc: RichDoc | RichNode): string {
  const out: string[] = [];
  const walk = (n: RichNode, depth: number) => {
    if (n.text) out.push(n.text);
    for (const c of n.content ?? []) walk(c, depth + 1);
    if (n.type === "paragraph" || n.type === "listItem") out.push("\n");
  };
  walk(doc as RichNode, 0);
  return out.join("").replace(/\n+$/, "");
}

export function isDocEmpty(doc: RichDoc | undefined): boolean {
  return !doc || docToPlainText(doc).trim().length === 0;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
