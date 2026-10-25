import { hasEditableSlides, type Lesson, sameJson } from "@tj/domain/documents";
import { SaveDeferredError, SaveHeldError } from "@tj/editor/autosave";
import { useCallback, useEffect, useRef } from "react";

type Row = { slides?: unknown; generation?: unknown } | null | undefined;

/** Whether the row's slides are all still the job's (ADR 0037): the server refuses a save then. */
function allTheJobs(row: Row): boolean {
  return !!row && "slides" in row && !hasEditableSlides(row as Lesson);
}

/**
 * Whether the editor's copy holds nothing of the teacher's beyond the row while every slide is the
 * job's: it differs only in the slides (the job's), the job's `generation` and the editor's own
 * stamps (`fitVersion`, `updatedAt`).
 */
function nothingOfTheTeachers(mine: object, row: Row): boolean {
  const bare = (d: object) => ({
    ...d,
    slides: undefined,
    generation: undefined,
    fitVersion: undefined,
    updatedAt: undefined,
  });
  return !!row && sameJson(bare(mine), bare(row));
}

/**
 * Live writing (ADR 0039): the editor opens while a job still owns every slide, and the server
 * refuses any save until one slide is done. A save in that window (a theme change, a title) is
 * held, not dropped: the moment a slide is done, the editor's current copy (the job's newest row
 * folded in by `pull`) is saved, so the held edit lands with everything since. The editor's copy is
 * saved rather than the held one, which predates the job's later slides.
 */
export function useHeldSave<D>(opts: {
  save: (document: D) => Promise<void>;
  /** The lesson row as the page last read it, with its slide states. */
  row: Row;
  /** A job holds the lesson. */
  generating: boolean;
  /** Folds the job's newest row into the editor and returns the editor's copy. */
  pull: () => Promise<D | undefined>;
}): (document: D) => Promise<void> {
  const { save, row, generating, pull } = opts;
  const held = useRef(false);
  const live = useRef({ row, generating });
  live.current = { row, generating };
  const editable = !allTheJobs(row);
  useEffect(() => {
    if (!held.current || !editable || !generating) return;
    held.current = false;
    void pull()
      .then((current) => (current ? save(current) : undefined))
      .catch(() => {
        held.current = true;
      });
  }, [editable, generating, pull, save]);
  return useCallback(
    (document: D) => {
      const { row: r, generating: g } = live.current;
      const mine = document as { slides?: unknown };
      if (g && allTheJobs(r) && allTheJobs(mine as Row)) {
        held.current = true;
        // Not written yet, so not "Saved": the indicator stays "Unsaved changes" until it lands.
        // Resolving here read as saved, and each row the job wrote then re-offered the change, so
        // the header flipped between the two over and over (P0 25 Oct 2026).
        // The editor's own stamps alone wait quietly ("Saved"): no unload warning for them.
        return Promise.reject(
          nothingOfTheTeachers(mine, r)
            ? new SaveHeldError("Only the editor's stamps wait for the first slide.")
            : new SaveDeferredError("Waiting for the first slide to be written."),
        );
      }
      return save(document);
    },
    [save],
  );
}
