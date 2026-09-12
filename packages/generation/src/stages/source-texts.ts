import type { SourceLocator } from "@tj/domain/documents";
import type { SourceText } from "../types";

/*
 * The Source text budget (ADR 0027 §6): Plan shows the model at most `maxChars` of extracted text
 * per lesson. The budget is shared across the lesson's Sources in proportion to their size, with a
 * floor so a small Source is never starved by a large one; each Source keeps whole chunks from its
 * start (a chapter's opening, a deck's first slides) and drops the tail, and says so with one
 * marker chunk so the model knows the material continues.
 */

export type SourceUnit = "pages" | "slides" | "sections";

export interface TruncatedSource {
  sourceId: string;
  omitted: number;
  total: number;
  unit: SourceUnit;
}

export interface SelectedSourceTexts {
  selected: SourceText[];
  truncated: TruncatedSource[];
}

/** No Source gets less than this while the total allows it. */
export const SOURCE_TEXT_MIN_CHARS = 4_000;

/** `pages` when any chunk is located by page, `slides` by slide, otherwise `sections`. */
export function sourceUnitOf(refs: readonly SourceLocator[]): SourceUnit {
  if (refs.some((r) => r.page !== undefined)) return "pages";
  if (refs.some((r) => r.slide !== undefined)) return "slides";
  return "sections";
}

export function selectSourceTexts(
  texts: readonly SourceText[],
  opts: { maxChars: number },
): SelectedSourceTexts {
  const groups = new Map<string, SourceText[]>();
  for (const t of texts) {
    const list = groups.get(t.sourceId);
    if (list) list.push(t);
    else groups.set(t.sourceId, [t]);
  }
  const sizes = new Map<string, number>();
  let total = 0;
  for (const [id, list] of groups) {
    const chars = list.reduce((n, t) => n + t.text.length, 0);
    sizes.set(id, chars);
    total += chars;
  }
  if (total <= opts.maxChars) return { selected: [...texts], truncated: [] };

  const budgets = allocate(sizes, opts.maxChars);
  const selected: SourceText[] = [];
  const truncated: TruncatedSource[] = [];
  for (const [id, list] of groups) {
    const budget = budgets.get(id) ?? 0;
    let used = 0;
    let kept = 0;
    for (const chunk of list) {
      if (used + chunk.text.length > budget) break;
      selected.push(chunk);
      used += chunk.text.length;
      kept++;
    }
    if (kept < list.length) {
      const unit = sourceUnitOf(list.map((t) => t.ref));
      const omitted = list.length - kept;
      const last = list[kept - 1] ?? list[0];
      truncated.push({ sourceId: id, omitted, total: list.length, unit });
      selected.push({
        sourceId: id,
        ref: last?.ref ?? {},
        text: `[truncated: ${omitted} of ${list.length} ${unit} omitted]`,
      });
    }
  }
  return { selected, truncated };
}

/**
 * Proportional shares with a floor: every Source gets `max(floor, share)`, then the largest
 * allocations are trimmed until the sum fits `maxChars`. A Source smaller than its allocation
 * simply keeps its size; the surplus is not redistributed (whole chunks rarely fill a budget
 * exactly anyway).
 */
function allocate(sizes: Map<string, number>, maxChars: number): Map<string, number> {
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  const out = new Map<string, number>();
  for (const [id, chars] of sizes) {
    const share = Math.floor((maxChars * chars) / total);
    out.set(id, Math.min(chars, Math.max(SOURCE_TEXT_MIN_CHARS, share)));
  }
  let sum = [...out.values()].reduce((a, b) => a + b, 0);
  while (sum > maxChars) {
    let largestId: string | undefined;
    let largest = -1;
    for (const [id, b] of out) {
      if (b > largest) {
        largest = b;
        largestId = id;
      }
    }
    if (largestId === undefined || largest <= 0) break;
    const cut = Math.min(sum - maxChars, largest);
    out.set(largestId, largest - cut);
    sum -= cut;
  }
  return out;
}
