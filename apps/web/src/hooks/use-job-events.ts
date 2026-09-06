import { jobEventsUrl } from "@tj/api-client";
import { isTerminalJobEvent, type JobEvent, JobEventSchema } from "@tj/domain/jobs";
import { useEffect, useReducer } from "react";
import { env } from "@/env";

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
}

const INITIAL: JobEventsState = { events: [], status: "idle", percent: null, terminal: null };
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
export function useJobEvents(jobId: string | undefined): JobEventsState {
  const [state, dispatch] = useReducer(reduceJobEvents, INITIAL);

  useEffect(() => {
    if (!jobId) {
      dispatch({ type: "reset", status: "idle" });
      return;
    }
    dispatch({ type: "reset", status: "connecting" });
    const source = new EventSource(jobEventsUrl(env.VITE_API_URL, jobId), {
      withCredentials: true,
    });

    const onMessage = (message: MessageEvent<string>) => {
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
      if (isTerminalJobEvent(parsed.data)) source.close();
    };

    for (const type of EVENT_TYPES) source.addEventListener(type, onMessage as EventListener);
    source.addEventListener("message", onMessage as EventListener);
    source.onopen = () => dispatch({ type: "status", status: "open" });
    source.onerror = () => {
      // `EventSource` retries automatically while `readyState` is CONNECTING; only a CLOSED
      // stream (e.g. 401/404) is a real error for the UI.
      if (source.readyState === EventSource.CLOSED) dispatch({ type: "status", status: "error" });
    };

    return () => source.close();
  }, [jobId]);

  return state;
}
