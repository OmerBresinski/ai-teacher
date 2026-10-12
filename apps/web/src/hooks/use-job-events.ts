import type { QueryClient } from "@tanstack/react-query";
import { jobEventsUrl } from "@tj/api-client";
import {
  isTerminalJobEvent,
  type JobEvent,
  JobEventSchema,
  type SlideDraftPayload,
} from "@tj/domain/jobs";
import type { DraftStore } from "@tj/editor/live-draft";
import { useEffect, useReducer } from "react";
import { env } from "@/env";
import { sessionBoundary, sessionSignal } from "@/lib/session-boundary";

export type JobStreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

/** One received event plus the SSE `id` (the `job_events` row id; falls back to a counter). */
export interface JobEventRecord {
  id: string;
  event: JobEvent;
}

export interface JobEventsState {
  events: JobEventRecord[];
  status: JobStreamStatus;
  /** 0–100 derived from the latest `progress` event; `100` once completed. */
  percent: number | null;
  terminal: JobEvent | null;
  /**
   * Live writing (ADR 0039): the newest `slide-draft` per slide id. Drafts are not appended to
   * `events` (a lesson streams a few hundred); a replay after a reconnect only overwrites them, and
   * the job's end clears them (the saved slides are the record).
   */
  drafts: Readonly<Record<string, SlideDraftPayload & { seq?: number }>>;
}

const NO_DRAFTS: Readonly<Record<string, SlideDraftPayload & { seq?: number }>> = {};
const INITIAL: JobEventsState = {
  events: [],
  status: "idle",
  percent: null,
  terminal: null,
  drafts: NO_DRAFTS,
};
/** The API names SSE events by type (`event: progress`); derived once from the schema. */
const EVENT_TYPES = JobEventSchema.options.map((option) => option.shape.type.value);
let seq = 0;

type Action =
  | { type: "reset"; status: JobStreamStatus }
  | { type: "status"; status: JobStreamStatus }
  | { type: "event"; event: JobEvent; id: string };

export function reduceJobEvents(state: JobEventsState, action: Action): JobEventsState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL, status: action.status };
    case "status":
      return { ...state, status: action.status };
    case "event": {
      const { event } = action;
      if (event.type === "slide-draft") {
        if (state.terminal) return state;
        const seq = Number(action.id) || undefined;
        const draft = { ...event.draft, ...(seq ? { seq } : {}) };
        return { ...state, drafts: { ...state.drafts, [event.draft.slideId]: draft } };
      }
      const terminal = isTerminalJobEvent(event) ? event : state.terminal;
      const percent =
        event.type === "completed"
          ? 100
          : event.type === "progress"
            ? (event.progress.percent ?? state.percent)
            : state.percent;
      return {
        events: [...state.events, { id: action.id || `local-${++seq}`, event }],
        status: terminal ? "closed" : state.status,
        percent,
        terminal,
        drafts: terminal ? NO_DRAFTS : state.drafts,
      };
    }
  }
}

/**
 * Follow one job's events over SSE (ADR 0012). Opens `EventSource(jobEventsUrl(env.VITE_API_URL,
 * jobId), { withCredentials: true })`; each `message` is validated with `JobEventSchema`
 * (unknown/invalid payloads are logged with `console.warn` and ignored). Closes the stream on the
 * first terminal event (`completed` | `failed` | `cancelled`) and on unmount / `jobId` change.
 * The server replays missed events (`Last-Event-ID`), so reconnecting after a reload is safe.
 *
 * The API names its SSE events by type (`event: progress`), so we listen to every known type
 * rather than only the default `message` event.
 */
export function useJobEvents(
  jobId: string | undefined,
  client: QueryClient = sessionBoundary.getSnapshot().client,
): JobEventsState {
  const [state, dispatch] = useReducer(reduceJobEvents, INITIAL);

  useEffect(() => {
    const signal = sessionSignal(client);
    if (!jobId || signal.aborted) {
      dispatch({ type: "reset", status: "idle" });
      return;
    }
    dispatch({ type: "reset", status: "connecting" });
    const source = new EventSource(jobEventsUrl(env.VITE_API_URL, jobId), {
      withCredentials: true,
    });
    let closed = false;
    const close = () => {
      closed = true;
      source.close();
    };
    const onAbort = () => {
      close();
      dispatch({ type: "reset", status: "idle" });
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const onMessage = (message: MessageEvent<string>) => {
      if (closed || signal.aborted) return;
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        console.warn("job events: ignoring non-JSON payload", message.data);
        return;
      }
      const parsed = JobEventSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn("job events: ignoring unknown event", raw);
        return;
      }
      dispatch({ type: "event", event: parsed.data, id: message.lastEventId });
      if (isTerminalJobEvent(parsed.data)) close();
    };

    for (const type of EVENT_TYPES) source.addEventListener(type, onMessage as EventListener);
    source.addEventListener("message", onMessage as EventListener);
    source.onopen = () => {
      if (!closed) dispatch({ type: "status", status: "open" });
    };
    source.onerror = () => {
      if (closed) return;
      // `EventSource` retries automatically while `readyState` is CONNECTING; only a CLOSED
      // stream (e.g. 401/404) is a real error for the UI.
      if (source.readyState === EventSource.CLOSED) dispatch({ type: "status", status: "error" });
      // A dropped stream reconnects as `connecting` then `open`, so callers can re-check on reconnect.
      else dispatch({ type: "status", status: "connecting" });
    };

    return () => {
      signal.removeEventListener("abort", onAbort);
      close();
    };
  }, [jobId, client]);

  return state;
}

/**
 * Live writing (ADR 0039): hands a job stream's drafts to the canvas's store. A fresh stream (the
 * editor opening mid-job, a reconnect) starts with none until its replay arrives, so an empty set
 * never clears the store while the job runs: the slide on screen keeps its draft. The job's end
 * clears it, and the saved slides are all that shows.
 */
/** How long a finished job's drafts stay for the last save to reach the document. */
export const DRAFTS_AFTER_END_MS = 1500;

export function useFeedDrafts(
  store: DraftStore | undefined,
  drafts: JobEventsState["drafts"],
  ended: boolean,
): void {
  useEffect(() => {
    if (!store) return;
    const list = Object.values(drafts);
    if (!ended) {
      if (list.length === 0) return;
      // A fresh stream replays oldest first: a draft the store already holds a newer copy of (a
      // later row) keeps the newer one, so the slide on screen never steps back.
      const merged = new Map<string, (typeof list)[number]>();
      for (const d of list) {
        const held = store.get(d.slideId);
        merged.set(d.slideId, held && (held.seq ?? 0) > (d.seq ?? 0) ? held : d);
      }
      store.set(merged.values());
      return;
    }
    // The job's end lands a moment before its last save reaches the open document: the drafts
    // stay for that moment, so the last slide never flashes an older copy, then go.
    const timer = setTimeout(() => store.set([]), DRAFTS_AFTER_END_MS);
    return () => clearTimeout(timer);
  }, [store, drafts, ended]);
}
