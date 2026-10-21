# ADR 0039: Slide drafts as an ephemeral job-event side channel

- Status: Accepted (12 Oct 2026)
- Amends: ADR 0012 (job events), ADR 0025 §7 ("no content travels in an event"). Builds on
  ADR 0037 (per-slide ownership while generating).
- Ticket: TEACH-202 part f (live writing P5–P7, `HEART1/LIVE-WRITING.md`).

## Context

The writer streams one JSON document. Since #473 the stage peeks the open slide (`SlideDrafts`),
but the only path to the browser was the progressive save: a full-document three-way merge write
at most once a second, then a whole-row refetch. Words at 5 Hz through that path would multiply
writes and payloads by 5–10 and still land in steps of a whole save. A teacher saw each slide pop
in complete.

## Decision

1. **A new job event, `slide-draft`** (`JobSlideDraftEventSchema` in `@tj/domain`):
   `{ index, slideId, slide, final? }`. `slide` is a laid `Slide` (validated by `SlideSchema`);
   `slideId` is the id the slide has in the lesson (`s<index + 1>`). It is the only event that
   carries content. It is scoped to the workspace like every job event, so the per-job stream and
   the workspace firehose (`GET /events`) both carry slide words to every open tab of that
   workspace while the job runs.
2. **Never the document.** Drafts never touch the lesson row, the editor's document, its undo
   history or a save. The web keeps them in a `DraftStore` beside the document
   (`@tj/editor/live-draft`), newest per slide id, not appended to the event log.
3. **The persisted slide always wins.** A draft shows only on a slide whose state is `writing`
   (ADR 0037). When the slide closes, the stage sends a `final` draft that is exactly the slide
   handed to `onSlide` (same layout, same ids), so the hand-over has nothing to swap. If the state
   turns `done` before the saved words reach the open document (two reads of one save), the last
   draft is held until the saved copy has caught up, 1.5 s at most; the same after the job ends.
4. **Throttle and prune in the worker.** `JobContext.draft` is fire-and-forget: one burst per
   200 ms, newest per slide, a `final` never replaced by a words draft, serial writes.
   When the handler settles, pending drafts are dropped and the job's `slide-draft` rows are
   deleted (`pruneEphemeralJobEvents`, `JOB_EPHEMERAL_EVENT_TYPES`) before the terminal event.
   Drafts a killed worker left behind are deleted when the job starts again (before `started`),
   and when the API releases a dead job's stale lock (`releaseStaleLock`).
   This is the one exception to "job event rows are immutable". The SSE stream reads rows after
   its cursor, so a pruned row is simply never sent; a replay after a reconnect sends the newest
   drafts again and the client keeps only the latest per slide.
5. **A draft is laid cheaply in the worker** (`layDraft`): the recipe with the words so far and
   every visual a `pending` placeholder; no asks, diagrams, checks, table split or repairs. Ids are
   stable per slide (`d-<name>-<n>`) so the renderer updates boxes in place, type sizes only step
   down while a slide is written, and answer data is left off.
6. **The editor opens at once, with the whole lesson as placeholders.** When the writer starts,
   the stage saves the deck as the job's (title and objectives `writing`), so the editor opens on
   it (`opensFillingEditor` accepts a lesson whose slides are `writing`, not only one with a done
   slide; this amends the open rule of ADR 0037 §5). As each `flow` entry closes in the stream, its
   slide joins the next progressive save as a planned blank: `writing`, no words of its own, one
   muted "Planned" line with the flow's `does`. A slide's first draft adds the blank if the flow
   did not. The laid copy replaces the blank when the slide closes; on a failure it is rolled back
   like any writing slide. While no slide is done the server refuses saves, so the page holds a
   save and saves the editor's copy once a slide is done (`useHeldSave`).
7. **Typing is client-side.** The browser types a draft's new words out at a steady pace (a word
   about every 70 ms, two or three a step only when far behind), with a caret after the last word;
   the view moves on with the next slide, so typing is never more than a slide behind, and a slide
   that turns done mid-typing finishes fast before its saved copy shows. With
   `prefers-reduced-motion` each draft shows at once with no caret. A replayed older draft never
   replaces a newer one (drafts carry their row id).

## Consequences

- About 150–250 extra `job_events` rows per lesson while it runs (2–6 KB each), gone at job end.
  No extra document writes, merges or HTTP requests; drafts ride the SSE stream already open.
- A draft can differ from the final lay (table split, repairs, diagram restage run only at close),
  so a slide may settle once when it closes; the `final` draft makes that the last change.
- Planned slides reach the editor on the next progressive save after their flow entry closes
  (≤ 1 s plus the 250 ms refetch debounce), well before their own words.
- Superseded draft rows stay until the job ends (a reconnect replays them all); compacting them
  and a global cap across concurrent jobs are tracked as later parts of TEACH-202.
