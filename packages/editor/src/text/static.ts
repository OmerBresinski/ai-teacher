import {
  RICH_DOC_MAX_DEPTH,
  type RichDoc,
  type RichNode,
  richDocDepth,
  richDocToPlainText,
} from "@tj/domain/documents";
import { serializeDoc } from "./serialize";

const cache = new WeakMap<RichDoc, string>();

/**
 * Render a rich doc to HTML with no editor instance. Pure TypeScript (`./serialize`), so the
 * viewer, present, print and thumbnail chunks carry no Tiptap; parity with `@tiptap/html` is held
 * by `serialize.test.ts`. A doc the serialiser does not understand falls back to escaped plain text.
 * A doc nested deeper than `RICH_DOC_MAX_DEPTH` (only possible for content stored before the
 * schema was closed, TEACH-277) takes the same fallback without entering the recursive serialiser.
 */
export function renderDocHTML(doc: RichDoc): string {
  const hit = cache.get(doc);
  if (hit) return hit;
  let html = "";
  try {
    if (richDocDepth(doc) > RICH_DOC_MAX_DEPTH) throw new RangeError("rich doc too deep");
    html = serializeDoc(doc);
  } catch {
    html = `<p>${escapeHtml(docToPlainText(doc))}</p>`;
  }
  cache.set(doc, html);
  return html;
}

/** The domain's iterative projection (ADR 0025 §10), re-exported under the editor's name. */
export const docToPlainText = (doc: RichDoc | RichNode): string => richDocToPlainText(doc);

export function isDocEmpty(doc: RichDoc | undefined): boolean {
  return !doc || docToPlainText(doc).trim().length === 0;
}

export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
