import { hasEditableSlides, type Lesson } from "@tj/domain/documents";
import { useCallback, useEffect, useRef } from "react";

type Row = { slides?: unknown; generation?: unknown } | null | undefined;

/** Whether the row's slides are all still the job's (ADR 0037): the server refuses a save then. */
function allTheJobs(row: Row): boolean {
  return !!row && "slides" in row && !hasEditableSlides(row as Lesson);
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
        return Promise.resolve();
      }
      return save(document);
    },
    [save],
  );
}
