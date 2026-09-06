/**
 * Undo/redo and transactions over the TanStack Query cache (ADR 0022 §4: "TanStack Query is the
 * only store"). The document being edited is the query's data; every committed change is a
 * `setQueryData`, and the history is two arrays of previous documents held in refs. Undo scope is
 * the hook's lifetime — the editor session.
 *
 * TeachDeck kept the same model in zundo (`lesson-store.ts`, `limit: 200`, transactions pausing
 * tracking so a drag is one entry); this is that contract without the store.
 */

import { type QueryFunction, type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { useCallback, useMemo, useRef, useState } from "react";
import { isSilentReducer } from "./reducers/core";

/** Matches zundo's `limit` in TeachDeck's store. */
export const HISTORY_LIMIT = 200;

/** A reducer result: the next lesson, or the next lesson plus the id(s) it minted. */
export type ReducerResult = Lesson | { lesson: Lesson };

// biome-ignore lint/suspicious/noExplicitAny: variadic reducer arguments are typed per call site
export type AnyReducer = (lesson: Lesson, ...args: any[]) => ReducerResult;

export type DocumentHistoryOptions<TData = unknown> = {
  /** The cache entry that holds the document (e.g. `queryKeys.libraryDocument(id)`). */
  queryKey: QueryKey;
  /**
   * The query's fetcher; the cache entry may hold a summary or `null` until it resolves. Optional
   * because `queryOptions()` types its own as optional — the route loader has filled the cache.
   */
  queryFn?: QueryFunction<TData, QueryKey>;
  /** Called after every committed change — once per transaction, not per dispatch inside it. */
  onChange?: (lesson: Lesson) => void;
};

export type DocumentHistory = {
  /** The lesson in the cache, or `undefined` while it is loading / not a lesson. */
  lesson: Lesson | undefined;
  /** Apply a reducer to the cached lesson; returns what the reducer returned. */
  dispatch: <R extends AnyReducer>(
    reducer: R,
    ...args: R extends (lesson: Lesson, ...rest: infer A) => ReducerResult ? A : never
  ) => ReturnType<R> | undefined;
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

/**
 * Shape check, not `isLesson` from `@tj/domain/documents`: that one runs the Zod schema and this
 * runs on every render and every dispatch of a drag. The cache holds a lesson, a worksheet, a
 * summary or `null`; only a lesson has `slides`.
 */
export function isLessonData(data: unknown): data is Lesson {
  return (
    typeof data === "object" &&
    data !== null &&
    "version" in data &&
    "slides" in data &&
    Array.isArray((data as { slides: unknown }).slides)
  );
}

const lessonOf = (result: ReducerResult): Lesson => ("slides" in result ? result : result.lesson);

export function useDocumentHistory<TData = unknown>({
  queryKey,
  queryFn,
  onChange,
}: DocumentHistoryOptions<TData>): DocumentHistory {
  const queryClient = useQueryClient();
  const { data: lesson } = useQuery({
    queryKey,
    queryFn,
    staleTime: Number.POSITIVE_INFINITY,
    // The lesson handed out must be the very object in the cache: reducers and the canvas compare
    // slides by identity, and structural sharing would hand out a rebuilt copy after each write.
    structuralSharing: false,
    select: (data: TData): Lesson | undefined => (isLessonData(data) ? data : undefined),
  });

  const past = useRef<Lesson[]>([]);
  const future = useRef<Lesson[]>([]);
  /** Open transaction tokens, outermost first; the snapshot is taken when the first opens. */
  const txStack = useRef<number[]>([]);
  const txSeq = useRef(0);
  const txPre = useRef<Lesson | null>(null);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  // Stable across renders so the callbacks below never change identity.
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const read = useCallback((): Lesson | undefined => {
    const data = queryClient.getQueryData(keyRef.current);
    return isLessonData(data) ? data : undefined;
  }, [queryClient]);

  const write = useCallback(
    (next: Lesson) => {
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
    (previous: Lesson) => {
      past.current.push(previous);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current = [];
      sync();
    },
    [sync],
  );

  const dispatch = useCallback(
    <R extends AnyReducer>(reducer: R, ...args: unknown[]): ReturnType<R> | undefined => {
      const current = read();
      if (!current) return undefined;
      const result = reducer(current, ...args) as ReturnType<R>;
      const next = lessonOf(result);
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
      lesson,
      dispatch: dispatch as DocumentHistory["dispatch"],
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
      lesson,
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
