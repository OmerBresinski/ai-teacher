import { createHash } from "node:crypto";

/**
 * Text normalisation shared by every writer and reader of the store, so an alias written by the
 * importer and an objective hashed by the lookup meet on the same key. Purely mechanical:
 * lower-case, Unicode NFKC, curly quotes and dashes straightened, whitespace collapsed, trailing
 * sentence punctuation dropped. No stemming, no synonym handling — that is what embeddings and
 * the select call are for.
 */
export function normaliseText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;:,]+$/u, "")
    .trim();
}

/** `sha256(normaliseText(text))` as hex — the key of `kb_section_alias.text_hash`. */
export function hashText(text: string): string {
  return createHash("sha256").update(normaliseText(text)).digest("hex");
}

/** Stable sha256 over a JSON-serialisable value (keys sorted), for `built_from_hash`. */
export function hashValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}
