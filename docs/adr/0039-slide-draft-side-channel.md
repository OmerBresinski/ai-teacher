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
   carries content. It is scoped to the workspace like every job event.
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
   This is the one exception to "job event rows are immutable". The SSE stream reads rows after
   its cursor, so a pruned row is simply never sent; a replay after a reconnect sends the newest
   drafts again and the client keeps only the latest per slide.
5. **A draft is laid cheaply in the worker** (`layDraft`): the recipe with the words so far and
   every visual a `pending` placeholder; no asks, diagrams, checks, table split or repairs. Ids are
   stable per slide (`d-<name>-<n>`) so the renderer updates boxes in place, type sizes only step
   down while a slide is written, and answer data is left off.
6. **The writing slide joins the deck early as a blank.** On its first draft the stage patches a
   blank `writing` slide (no elements, no words) into the next progressive save, so the editor can
   open it and show its drafts. Its laid copy replaces the blank when it closes; on a failure it is
   rolled back like any writing slide.
7. **Typing is client-side.** Between two drafts the browser types the new words out over about
   240 ms, one to three words per step, with a caret after the last word; with
   `prefers-reduced-motion` each draft shows at once with no caret.

## Consequences

- About 150–250 extra `job_events` rows per lesson while it runs (2–6 KB each), gone at job end.
  No extra document writes, merges or HTTP requests; drafts ride the SSE stream already open.
- A draft can differ from the final lay (table split, repairs, diagram restage run only at close),
  so a slide may settle once when it closes; the `final` draft makes that the last change.
- The editor reaches a new slide only on the next progressive save after its template closes
  (≤ 1 s plus the 250 ms refetch debounce), so a short slide may show only its last draft or two
  being typed. Opening the editor before the first slide is done is a separate decision.
