-- TEACH-82: at most one terminal event (completed / failed / cancelled) per job.
--
-- Before this index nothing prevented two terminal rows for one job_id (a retry after a failed
-- terminal write could re-run the handler and write a second one). If any such duplicates exist
-- when this migration runs, the index creation would fail, so first keep the EARLIEST terminal
-- row per job and delete the rest. Earliest (lowest id) is the one SSE clients already streamed —
-- `id` is the SSE event id and the replay cursor — so removing later rows changes nothing a
-- client has seen; keeping a later one would leave a replay cursor pointing past a gap.
DELETE FROM "job_events" AS later
USING "job_events" AS earliest
WHERE later."job_id" = earliest."job_id"
  AND later."type" IN ('completed', 'failed', 'cancelled')
  AND earliest."type" IN ('completed', 'failed', 'cancelled')
  AND later."id" > earliest."id";--> statement-breakpoint
CREATE UNIQUE INDEX "job_events_one_terminal_per_job_uidx" ON "job_events" USING btree ("job_id") WHERE "job_events"."type" in ('completed', 'failed', 'cancelled');
