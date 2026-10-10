# ADR 0037: Per-slide ownership while a lesson is generating

- Status: Accepted (9 Oct 2026)
- Amends: ADR 0024 §18 (lesson lock while generating); touches ADR 0025 §6–§7 (job writes,
  progress and persistence).
- Rulings: UX rulings 188 and 189 (Linear "UX rulings", UX Improvements).
- Ticket: TEACH-202 part b. (ADR 0036 is the slide-count ADR in #438.)

## Context

ADR 0024 §18 locks the whole lesson while a job generates into it: `PUT /documents/:id` answers
`409 generating`, the page shows the lesson read-only, and the worker writes whole documents
through `putDocumentAsJob` keyed on the lock. That kept the model simple ("no merge logic, no lost
teacher edits") but made the teacher wait for the slowest part of the job: on prod lesson 01a12146
the last slide's words were final at about 62 s while the lock was released at 121 s (pictures,
repairs and notes). #432 already writes `generation.slideStates` (`writing`, `done`) and saves
slides progressively; nothing in `apps/web` read them.

## Decision

1. **Ownership is per slide while a job runs.** A slide whose `generation.slideStates[id]` is
   `writing` is the job's. A `done` slide is the teacher's. `generating_job_id` stays, and is still
   cleared only in the worker's `finally` (`clearGenerating`), so retries and `releaseStaleLock`
   are unchanged; it simply stops being the editing gate.
2. **Teacher writes while generating** (`@tj/db` `putDocument`). A locked lesson with at least one
   `done` slide accepts the teacher's write under the usual `expectedUpdatedAt` check, with the
   lock as part of the predicate. `keepWritingSlides` keeps every `writing` slide and the
   `generation` field as stored, whatever the teacher's copy says (a writing slide removed from
   the copy is put back). A locked lesson with no `done` slide still answers `409 generating`.
3. **Job writes are three-way merges** (`putDocumentAsJob(…, { base })`). The worker's persist
   keeps its own previous copy as `base`; each write merges `mergeJobLesson(base, row, next)`
   onto the row under `generating_job_id = :job AND updated_at = :read`, retrying when the teacher
   wrote in between. A whole-document merge keyed on slides and elements replaces the draft's
   per-slide `rev` and slot patches: the job keeps writing whole lessons, and the merge decides
   what lands.
4. **The merge** (`@tj/domain` `generation-merge.ts`, pure):
   - `generation` is always the job's; any other top-level field the teacher changed keeps the
     teacher's value (title, theme);
   - a slide still `writing` at `base` is the job's;
   - a slide the teacher did not change takes the job's copy;
   - a slide the teacher changed (typing, moving, resizing, adding or deleting an element; ruling
     189) keeps the teacher's words; a late picture or diagram lands only in a slot the teacher
     left as it was (moving or resizing the slot is fine, the picture takes the teacher's place),
     and notes land only when the teacher has not edited them. Every other job change to that
     slide is dropped (ruling 189 option B; a suggestion chip, option A, comes later);
   - teacher-added slides stay, teacher-deleted slides stay deleted, in the teacher's order; new
     slides from the job land after the slide they follow in the job's copy.
5. **The web** opens the editor in place as soon as one slide is `done` (`lesson-editor.page.tsx`
   latches it per job). `writingSlideIds` makes those slides selectable but read-only: a "Writing…"
   badge on the filmstrip thumb, the canvas `inert` under a "Writing this slide…" pill.
   `FillingFollower` follows the job's events as the generating view did, but never refetches into
   the editor's working copy: it reads the row on the side and calls the editor handle's
   `receiveGenerated(base, theirs)`, which applies the same merge to the document and to every undo
   and redo step (`useHistory.rebase`), recording nothing. A `409 stale` save while filling folds
   the row in and saves the merged copy again instead of the Reload toast. The job's end is one
   last pull, which carries the released lock and turns the page into the plain editor without a
   remount.

## Consequences

- Teacher-editable time is per slide: the slide's `done` (#432's state: words written, checked and
  repaired), not the job's end.
- Two writers to one row, guarded by `updated_at` on both sides and a merge on both sides, with
  the job owning `writing` slides and `generation` at the database.
- The Present and Export controls stay available while filling; a writing slide shows as it is.
- A theme change re-fits slides, so after it a re-fitted done slide counts as edited and refuses
  later word changes from the job. The editor applies the theme picked while generating only at
  the job's end (ruling 123), which keeps this rare.
- A worker retry starts a new persist without a base, so its first write replaces the row (as
  before this ADR).

## Alternatives

- Keep the row lock and finish faster (TEACH-110 parts h and j): still makes the teacher wait for
  pictures and notes; rejected as the end state by ruling 188.
- Per-slide `rev` and slot patches (the draft): needs a patch emitter in `@tj/generation` for
  every late writer; rejected for a merge in the one place both writers already pass through.
