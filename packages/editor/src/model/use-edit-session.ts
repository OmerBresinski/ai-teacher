import { useCallback, useEffect, useRef } from "react";

/**
 * One undo step per gesture or typing session (TeachDeck `use-edit-session.ts`; SPEC §4, §7).
 *
 * Number scrubs, slider drags and every free-text field fire continuously, so a single opacity
 * drag or a typed sentence would otherwise land dozens of history entries. Route those writes
 * through `run`: the first one opens a transaction, and the transaction closes once the writes
 * stop for `idleMs` — or immediately, when the caller knows the gesture is over (`end`, wired to a
 * blur or a slider's commit).
 *
 * `beginTransaction`/`endTransaction` nest, so overlapping sessions from two fields still collapse
 * to one entry. The pair is passed in rather than read from a store (ADR 0022 §4).
 */
export const IDLE_MS = 500;

export type Transactions = {
  beginTransaction: () => number | undefined;
  endTransaction: (token?: number) => void;
};

export type EditSession = {
  /** Run a document write inside the open session, opening one if needed. */
  run: (write: () => void) => void;
  /** Close the session now — the gesture or the typing run is over. */
  end: () => void;
};

export function useEditSession(tx: Transactions, idleMs: number = IDLE_MS): EditSession {
  /** The token of the opening this session owns, while one is open. */
  const open = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const txRef = useRef(tx);
  txRef.current = tx;

  const end = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (open.current === null) return;
    const token = open.current;
    open.current = null;
    // Passed back so an end that arrives after the idle window — when a dialog may have flushed
    // this session and opened a transaction of its own — cannot close the wrong one.
    txRef.current.endTransaction(token);
  }, []);

  const run = useCallback(
    (write: () => void) => {
      if (open.current === null) open.current = txRef.current.beginTransaction() ?? -1;
      if (timer.current) clearTimeout(timer.current);
      write();
      timer.current = setTimeout(end, idleMs);
    },
    [end, idleMs],
  );

  // A toolbar unmounts the moment the selection changes: commit, never strand.
  useEffect(() => end, [end]);

  return { run, end };
}
