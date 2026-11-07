/*
 * Prompt budget (Greg, 6 Nov 2026: "find rules and systems that ensure we never ever bloat it").
 * `prompt-budget.json` holds a character ceiling for every prompt text the generation pipeline
 * sends that the budget covers: the writer's full system text as sent (template, code-built menus,
 * Fits lines, diagram kinds, library Models list), its user message and schema, and the notes,
 * repair, restage, pupil-objectives and picture-director prompts. `prompt-budget.test.ts` measures
 * each one and fails when:
 *   - a text is longer than its ceiling (growth needs a new history entry in the same diff);
 *   - a text is more than `maxSlack` characters under its ceiling (ceilings ratchet down);
 *   - a ceiling rose without a reason and a LOG.md, ruling or Gate B reference;
 *   - a history entry already on master was edited or removed (history is append-only).
 * A text that is no longer sent is retired by a last step with ceiling 0, never by deleting it.
 * Every entry's ceiling is the last entry of its history, so a raise is always a visible, dated,
 * reasoned line in review. Method: scratchpad/tuning/METHOD.md rule 7.
 */

export type BudgetStep = {
  /** The ceiling from this step on, in characters (String#length); 0 retires the text. */
  ceiling: number;
  /** ISO date of the change, YYYY-MM-DD. */
  date: string;
  /** Why the ceiling is this number. A raise says what the extra text buys. */
  reason: string;
  /** Where the decision is recorded: a LOG.md row, a UX ruling, a Gate B verdict, a PR. */
  ref: string;
};
export type PromptBudget = {
  /** Characters a text may sit under its ceiling before the test asks for the ceiling to drop. */
  maxSlack: number;
  entries: Record<string, { history: BudgetStep[] }>;
};

/** A raise must cite where its measured gain or decision is recorded. */
export const RAISE_REF = /LOG\.md|ruling \d+|Gate B|#\d+|TEACH-\d+/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ceilingOf = (b: PromptBudget, id: string): number | undefined =>
  b.entries[id]?.history.at(-1)?.ceiling;

/** The file's own rules: every step dated and reasoned, raises referenced, no reason reused. */
export function checkHistory(b: PromptBudget): string[] {
  const out: string[] = [];
  if (!Number.isInteger(b.maxSlack) || b.maxSlack < 0) out.push("maxSlack: a whole number >= 0");
  for (const [id, e] of Object.entries(b.entries)) {
    if (!e.history?.length) {
      out.push(`${id}: no history`);
      continue;
    }
    const seen = new Set<string>();
    e.history.forEach((s, i) => {
      const at = `${id} history[${i}]`;
      if (!Number.isInteger(s.ceiling) || s.ceiling < 0) out.push(`${at}: ceiling not a count`);
      if (s.ceiling === 0 && i < e.history.length - 1)
        out.push(`${at}: a retired text stays retired`);
      if (!ISO_DATE.test(s.date ?? "")) out.push(`${at}: date not YYYY-MM-DD`);
      if (i > 0 && s.date < (e.history[i - 1] as BudgetStep).date)
        out.push(`${at}: dated before the step it follows`);
      const reason = (s.reason ?? "").trim();
      if (reason.length < 10) out.push(`${at}: a reason of at least 10 characters`);
      if (seen.has(reason)) out.push(`${at}: reuses an earlier reason; say why this step`);
      seen.add(reason);
      if (!(s.ref ?? "").trim()) out.push(`${at}: no ref`);
      const before = i > 0 ? (e.history[i - 1] as BudgetStep).ceiling : undefined;
      if (before !== undefined && s.ceiling > before && !RAISE_REF.test(s.ref ?? ""))
        out.push(
          `${at}: raises ${before} -> ${s.ceiling}; ref must cite LOG.md, a ruling, Gate B, a PR or a ticket`,
        );
    });
  }
  return out;
}

/** History is append-only against the base (master): every base step is kept, unchanged. */
export function checkAppendOnly(base: PromptBudget, now: PromptBudget): string[] {
  const out: string[] = [];
  for (const [id, e] of Object.entries(base.entries)) {
    const cur = now.entries[id];
    if (!cur) {
      out.push(`${id}: removed; retire it with a last step of ceiling 0 instead`);
      continue;
    }
    e.history.forEach((s, i) => {
      if (JSON.stringify(cur.history[i]) !== JSON.stringify(s))
        out.push(`${id} history[${i}]: changed from master; append a new step instead`);
    });
  }
  return out;
}

/** Measured lengths against the ceilings. Every measured text needs an entry and vice versa. */
export function checkCounts(b: PromptBudget, measured: Record<string, number>, today: string) {
  const over: string[] = [];
  const slack: string[] = [];
  const missing: string[] = [];
  const suggest: Record<string, BudgetStep> = {};
  for (const [id, n] of Object.entries(measured)) {
    const c = ceilingOf(b, id);
    if (c === 0) {
      over.push(`${id}: ${n} chars, but the entry is retired (ceiling 0)`);
    } else if (c === undefined) {
      missing.push(`${id}: ${n} chars, no budget entry`);
      suggest[id] = { ceiling: n, date: today, reason: "<why this text is sent>", ref: "<ref>" };
    } else if (n > c) {
      over.push(`${id}: ${n} chars, ceiling ${c} (+${n - c})`);
      suggest[id] = {
        ceiling: n,
        date: today,
        reason: "<what the extra text buys>",
        ref: "<LOG.md row / ruling / Gate B>",
      };
    } else if (c - n > b.maxSlack) {
      slack.push(`${id}: ${n} chars, ceiling ${c} (-${c - n}); lower the ceiling to ${n}`);
      suggest[id] = { ceiling: n, date: today, reason: "<what was cut>", ref: "<ref>" };
    }
  }
  const stale = Object.keys(b.entries)
    .filter((id) => !(id in measured) && ceilingOf(b, id) !== 0)
    .map((id) => `${id}: in the budget but not measured`);
  return { over, slack, missing, stale, suggest };
}
