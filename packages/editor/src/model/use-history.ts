/**
 * Undo/redo and transactions over the TanStack Query cache (ADR 0022 §4: "TanStack Query is the
 * only store"), parameterised by document type. The document being edited is the query's data;
 * every committed change is a `setQueryData`, and the history is two arrays of previous documents
 * held in refs. Undo scope is the hook's lifetime — the editor session.
 *
 * `useDocumentHistory` (lessons) and `worksheet/use-worksheet-history.ts` (worksheets) are thin
 * wrappers: they supply the shape check and the reducer-result unwrapping and rename `document`
 * to `lesson` / `worksheet`. There is one implementation of undo and transactions.
 *
 * TeachDeck kept the same model in zundo (`lesson-store.ts` and `worksheet-store.ts`, `limit:
 * 200`, transactions pausing tracking so a drag is one entry); this is that contract without the
 * store.
 */

import { type QueryFunction, type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { isSilentReducer } from "./reducers/core";

/** Matches zundo's `limit` in TeachDeck's stores. */
export const HISTORY_LIMIT = 200;

/** A reducer over document `D` whose result is `R` (the document, or the document plus ids). */
// biome-ignore lint/suspicious/noExplicitAny: variadic reducer arguments are typed per call site
export type ReducerOf<D, R> = (document: D, ...args: any[]) => R;

/** The arguments after the document, taken off the reducer's own signature. */
export type ReducerArgs<D, R, F> = F extends (document: D, ...rest: infer A) => R ? A : never;

export type HistoryOptions<D, R, TData = unknown> = {
  /** The cache entry that holds the document (e.g. `queryKeys.libraryDocument(id)`). */
  queryKey: QueryKey;
  /**
   * The query's fetcher; the cache entry may hold a summary or `null` until it resolves. Optional
   * because `queryOptions()` types its own as optional — the route loader has filled the cache.
   */
  queryFn?: QueryFunction<TData, QueryKey>;
  /** Called after every committed change — once per transaction, not per dispatch inside it. */
  onChange?: (document: D) => void;
  /** Cheap shape check (not the Zod schema): runs on every render and every dispatch of a drag. */
  isDocument: (data: unknown) => data is D;
  /** The next document out of a reducer result. */
  documentOf: (result: R) => D;
};

export type History<D, R> = {
  /** The document in the cache, or `undefined` while it is loading / not this kind. */
  document: D | undefined;
  /** Apply a reducer to the cached document; returns what the reducer returned. */
  dispatch: <F extends ReducerOf<D, R>>(
    reducer: F,
    ...args: ReducerArgs<D, R, F>
  ) => ReturnType<F> | undefined;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Wrap a pointer drag: dispatches inside record nothing; `endTransaction` commits one step. The
   * returned token names this opening; an owner whose end may arrive late (an idle-timer edit
   * session) passes it back so a stale end cannot close a transaction someone else has since opened.
   */
  beginTransaction: () => number;
  /** Without a token, closes the innermost opening; with one, closes that opening if still open. */
  endTransaction: (token?: number) => void;
  /**
   * Abandon every open transaction: the cache goes back to what it held when the outermost began,
   * nothing is recorded and nothing is saved. A preview the teacher cancelled (the theme dialog).
   * With a token, only if that opening is still open — and it is the caller's job to have
   * `flushTransactions()` first so it is the only one.
   */
  rollbackTransaction: (token?: number) => void;
  /** Commit every open transaction now — the teacher moved on to something else. */
  flushTransactions: () => void;
  /** True while a transaction is open (the fit migration waits for the teacher's edit to land). */
  isTransactionInFlight: () => boolean;
};

export function useHistory<D, R, TData = unknown>({
  queryKey,
  queryFn,
  onChange,
  isDocument,
  documentOf,
}: HistoryOptions<D, R, TData>): History<D, R> {
  const queryClient = useQueryClient();
  const { data: document } = useQuery({
    queryKey,
    queryFn,
    staleTime: Number.POSITIVE_INFINITY,
    // The document handed out must be the very object in the cache: reducers and the canvas
    // compare parts by identity, and structural sharing would hand out a rebuilt copy after each write.
    structuralSharing: false,
    select: (data: TData): D | undefined => (isDocument(data) ? data : undefined),
  });

  const past = useRef<D[]>([]);
  const future = useRef<D[]>([]);
  /** Open transaction tokens, outermost first; the snapshot is taken when the first opens. */
  const txStack = useRef<number[]>([]);
  const txSeq = useRef(0);
  const txPre = useRef<D | null>(null);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  // Stable across renders so the callbacks below never change identity.
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isDocumentRef = useRef(isDocument);
  isDocumentRef.current = isDocument;
  const documentOfRef = useRef(documentOf);
  documentOfRef.current = documentOf;

  const read = useCallback((): D | undefined => {
    const data = queryClient.getQueryData(keyRef.current);
    return isDocumentRef.current(data) ? data : undefined;
  }, [queryClient]);

  const write = useCallback(
    (next: D) => {
      queryClient.setQueryData(keyRef.current, next);
    },
    [queryClient],
  );

  const sync = useCallback(() => {
    const canUndo = past.current.length > 0;
    const canRedo = future.current.length > 0;
    setFlags((prev) =>
      prev.canUndo === canUndo && prev.canRedo === canRedo ? prev : { canUndo, canRedo },
    );
  }, []);

  const record = useCallback(
    (previous: D) => {
      past.current.push(previous);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current = [];
      sync();
    },
    [sync],
  );

  const dispatch = useCallback(
    <F extends ReducerOf<D, R>>(reducer: F, ...args: unknown[]): ReturnType<F> | undefined => {
      const current = read();
      if (!current) return undefined;
      const result = reducer(current, ...args) as ReturnType<F>;
      const next = documentOfRef.current(result);
      if (next === current) return result;
      const inTransaction = txStack.current.length > 0;
      if (!inTransaction && !isSilentReducer(reducer)) record(current);
      write(next);
      if (!inTransaction) onChangeRef.current?.(next);
      return result;
    },
    [read, write, record],
  );

  const undo = useCallback(() => {
    if (txStack.current.length > 0) return;
    const current = read();
    const previous = past.current.pop();
    if (!current || !previous) return;
    future.current.push(current);
    write(previous);
    sync();
    onChangeRef.current?.(previous);
  }, [read, write, sync]);

  const redo = useCallback(() => {
    if (txStack.current.length > 0) return;
    const current = read();
    const next = future.current.pop();
    if (!current || !next) return;
    past.current.push(current);
    write(next);
    sync();
    onChangeRef.current?.(next);
  }, [read, write, sync]);

  const beginTransaction = useCallback(() => {
    const token = ++txSeq.current;
    if (txStack.current.length === 0) txPre.current = read() ?? null; // nested: keep the outer snapshot
    txStack.current.push(token);
    return token;
  }, [read]);

  /** The outermost owner has closed: one history step for everything since the snapshot. */
  const commit = useCallback(() => {
    const pre = txPre.current;
    txPre.current = null;
    const post = read();
    if (pre && post && pre !== post) {
      record(pre);
      onChangeRef.current?.(post);
    }
  }, [read, record]);

  const endTransaction = useCallback(
    (token?: number) => {
      const stack = txStack.current;
      if (stack.length === 0) return;
      if (token === undefined) stack.pop();
      else {
        const at = stack.indexOf(token);
        if (at === -1) return; // stale: this opening was already flushed or rolled back
        stack.splice(at, 1);
      }
      if (stack.length === 0) commit();
    },
    [commit],
  );

  const flushTransactions = useCallback(() => {
    if (txStack.current.length === 0) return;
    txStack.current = [];
    commit();
  }, [commit]);

  const rollbackTransaction = useCallback(
    (token?: number) => {
      if (txStack.current.length === 0) return;
      if (token !== undefined && !txStack.current.includes(token)) return;
      txStack.current = [];
      const pre = txPre.current;
      txPre.current = null;
      if (pre && pre !== read()) write(pre);
    },
    [read, write],
  );

  const isTransactionInFlight = useCallback(() => txStack.current.length > 0, []);

  return useMemo(
    () => ({
      document,
      dispatch: dispatch as History<D, R>["dispatch"],
      undo,
      redo,
      canUndo: flags.canUndo,
      canRedo: flags.canRedo,
      beginTransaction,
      endTransaction,
      rollbackTransaction,
      flushTransactions,
      isTransactionInFlight,
    }),
    [
      document,
      dispatch,
      undo,
      redo,
      flags,
      beginTransaction,
      endTransaction,
      rollbackTransaction,
      flushTransactions,
      isTransactionInFlight,
    ],
  );
}
