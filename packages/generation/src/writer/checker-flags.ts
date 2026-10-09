/*
 * The checker's flags (CHECKER-AUDIT, 9 Oct 2026): each change to the writer stage's post-call
 * checking sits behind its own flag, default off, so every one is measured alone against the
 * same recorded writer outputs before any ships on.
 */
export const CHECKER_FLAGS = [
  /** A diagram that drew but did not fit its slot is laid out full width before any fallback. */
  "fallbackOnlyOnFailure",
  /** No `table-text` fallback: its rows lose a table's grouped cells (y10 "Formed 1882: Members: …"). */
  "fixTableToText",
  /** The duplicate check is logged, never sent to repair (fault-ledger #7). */
  "duplicateLogOnly",
  /** pointGuard logs what it would strip and leaves the slide as it is (D48). */
  "pointGuardLogOnly",
  /** Objective coverage: a task on a picture or diagram slide checks its objectives. */
  "coverageCountsPictureTasks",
  /** Objective coverage: a discussion slide does not check (D36). */
  "coverageExcludesDiscussion",
  /** Objective coverage: a check before the objective's first teaching slide does not count (Greg, 9 Oct). */
  "coverageExcludesPrediction",
] as const;

export type CheckerFlag = (typeof CHECKER_FLAGS)[number];
export type CheckerFlags = Partial<Record<CheckerFlag, boolean>>;

/** Flags from a comma-separated list (`WRITER_CHECKER_FLAGS`); unknown names are refused. */
export function parseCheckerFlags(list: string | undefined): CheckerFlags {
  const out: CheckerFlags = {};
  for (const raw of (list ?? "").split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (!(CHECKER_FLAGS as readonly string[]).includes(name))
      throw new Error(`unknown checker flag "${name}"`);
    out[name as CheckerFlag] = true;
  }
  return out;
}
