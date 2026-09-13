/**
 * `GET /events` — the per-Workspace firehose (ADR 0012): every job event of the caller's
 * Workspace, replayed from `Last-Event-ID` (bounded by `EVENTS_REPLAY_LIMIT`) and then live.
 * Never closes on its own; the client reconnects with `Last-Event-ID` after any drop.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../context";
import type { EventsRuntime } from "../events/runtime";
import { parseLastEventId, streamJobEvents } from "../events/stream";
import { getWorkspaceId } from "../workspace";
import { acquireStreamOr429, requireRuntime } from "./jobs";

export function eventRoutes(runtime: EventsRuntime | undefined) {
  return new Hono<AppEnv>().get("/events", (c) => {
    const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
    const authorization = c.get("streamAuthorization");
    if (!authorization)
      throw new HTTPException(401, { message: "You need to sign in to do that." });
    const rt = requireRuntime(runtime);
    const release = acquireStreamOr429(rt, workspaceId);
    return streamJobEvents(c, rt, {
      workspaceId,
      authorization,
      lastEventId: parseLastEventId(c.req.header("Last-Event-ID")),
      closeOnTerminal: false,
      onClose: release,
    });
  });
}
