import type { RichDoc, RichNode } from "@tj/domain/documents";

/*
 * Running text as sentences, and back. The lead/card split (`look.ts`) and the sentence-by-sentence
 * continuation (`structure.ts`) both cut a paragraph at its sentence ends and join the pieces
 * again, so they share one reading of where a sentence ends: a stop, any closing quote or bracket
 * after it, then a space or the end ("… (power over others). A …", "… said "no." Then …"). A
 * decimal point or a stop inside a word ("3.5", "U.K") never ends one.
 */
const END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;

export function sentences(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const m of text.matchAll(END)) {
    const end = (m.index ?? 0) + m[0].length;
    out.push(text.slice(from, end));
    from = end;
  }
  out.push(text.slice(from));
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Sentences (or any pieces of running text) joined back into one paragraph, one space apart. */
export const joinSentences = (parts: string[]): string =>
  parts
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

const inline = (n: RichNode): string =>
  n.type === "text"
    ? (n.text ?? "")
    : n.type === "hardBreak"
      ? " "
      : (n.content ?? []).map(inline).join("");

/**
 * A doc's words as one run of text: text nodes inside a block join as they stand, blocks
 * (paragraphs, list items) join with a space. A generated body written as two paragraphs
 * ("… others).\n\nA successful …") no longer reads as "others).A successful".
 */
export function docPlainText(doc: RichDoc): string {
  const blocks: string[] = [];
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "paragraph" || n.type === "heading") blocks.push(inline(n));
      else walk(n.content);
    }
  };
  walk(doc.content);
  return joinSentences(blocks);
}
