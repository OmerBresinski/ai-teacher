/**
 * Reorder the stored `lessonIds` of a series from a move between *visible* rows.
 *
 * `visibleIds` are the rows in display order (trashed lessons stay in `lessonIds` but are not
 * shown), `from` is the row that moved and `insertion` is the gap it was dropped into: `0` is above
 * the first row, `visibleIds.length` is below the last. Returns `null` when the move is a no-op so
 * the caller writes nothing. Ported from TeachDeck `persist-series.ts` `reorderVisible`.
 */
export function reorderVisible(
  lessonIds: readonly string[],
  visibleIds: readonly string[],
  from: number,
  insertion: number,
): string[] | null {
  const moved = visibleIds[from];
  if (moved === undefined) return null;
  const before = insertion >= visibleIds.length ? null : visibleIds[insertion];
  if (before === moved) return null;

  const rest = lessonIds.filter((id) => id !== moved);
  const at = before ? rest.indexOf(before) : -1;
  const next = at === -1 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
  // Dropping into the gap just below the moved row usually reproduces the stored order — unless a
  // hidden id sits in that gap, in which case the move is real. Compare, do not guess.
  return next.every((id, index) => id === lessonIds[index]) ? null : next;
}

/** Move the visible row at `from` one step; `null` at the edges. */
export function stepVisible(
  lessonIds: readonly string[],
  visibleIds: readonly string[],
  from: number,
  direction: -1 | 1,
): string[] | null {
  const to = from + direction;
  if (to < 0 || to >= visibleIds.length) return null;
  // Moving down by one lands in the gap *after* the next row.
  return reorderVisible(lessonIds, visibleIds, from, direction === 1 ? to + 1 : to);
}
