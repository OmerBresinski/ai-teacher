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
 * Floor first, then proportional: every Source gets `min(size, floor)`; what is left of `maxChars`
 * is shared among the Sources still short of their size in proportion to their remaining size.
 * When even the floors do not fit, `maxChars` is split evenly. No Source is ever allocated zero
 * while the budget is positive, and the sum never exceeds `maxChars`.
 */
function allocate(sizes: Map<string, number>, maxChars: number): Map<string, number> {
  const ids = [...sizes.keys()];
  const out = new Map<string, number>();
  if (ids.length === 0 || maxChars <= 0) return out;

  const floorTotal = ids.reduce(
    (n, id) => n + Math.min(sizes.get(id) ?? 0, SOURCE_TEXT_MIN_CHARS),
    0,
  );
  if (floorTotal >= maxChars) {
    const each = Math.floor(maxChars / ids.length);
    for (const id of ids) out.set(id, Math.min(sizes.get(id) ?? 0, each));
    return out;
  }

  for (const id of ids) out.set(id, Math.min(sizes.get(id) ?? 0, SOURCE_TEXT_MIN_CHARS));
  let remaining = maxChars - floorTotal;
  const wanting = ids.filter((id) => (sizes.get(id) ?? 0) > (out.get(id) ?? 0));
  const wantTotal = wanting.reduce((n, id) => n + (sizes.get(id) ?? 0) - (out.get(id) ?? 0), 0);
  for (const id of wanting) {
    const want = (sizes.get(id) ?? 0) - (out.get(id) ?? 0);
    const share = Math.min(want, Math.floor((remaining * want) / wantTotal));
    out.set(id, (out.get(id) ?? 0) + share);
  }
  // Rounding leaves a few characters; give them to the first Source still short, in order.
  remaining = maxChars - [...out.values()].reduce((a, b) => a + b, 0);
  for (const id of wanting) {
    if (remaining <= 0) break;
    const room = (sizes.get(id) ?? 0) - (out.get(id) ?? 0);
    const give = Math.min(room, remaining);
    out.set(id, (out.get(id) ?? 0) + give);
    remaining -= give;
  }
  return out;
}
