import type { Id } from "@tj/domain/documents";
import { createContext, useContext } from "react";
import type { RegenerateTarget } from "./use-editor-session";

/*
 * What the app wires for the proposal jobs (TEACH-134, ADR 0025 §18): the editor never speaks
 * HTTP or SSE, so the facts panel and the regenerate dialog call back through this context and
 * the app enqueues, follows and applies (through `LessonEditorHandle`). `busySlideIds` paints the
 * "changing…" overlay on the navigator thumbs while a job is in flight; `busy` the panel's spinner.
 */

export type ProposalsApi = {
  /** The facts whose text changed, coalesced; the app enqueues `lesson.cascade`. */
  onFactsChanged?: (factIds: string[]) => void;
  /** The teacher confirmed the regenerate dialog; the app enqueues `lesson.regenerate`. */
  onRegenerate?: (target: RegenerateTarget, instruction: string | undefined) => void;
  /** Slides a job in flight will change (the impact set, or the regenerate target). */
  busySlideIds: ReadonlySet<Id>;
  /** A cascade or regenerate is in flight. */
  busy: boolean;
  /**
   * Fact ids the worksheet's blocks derive from; `addFact` never mints one of these again. `null`
   * while the lesson has a worksheet the app has not fetched yet — adding facts waits for it.
   */
  reservedFactIds: readonly string[] | null;
};

const EMPTY = new Set<Id>();
export const NO_PROPOSALS: ProposalsApi = { busySlideIds: EMPTY, busy: false, reservedFactIds: [] };

export const ProposalsContext = createContext<ProposalsApi>(NO_PROPOSALS);
export const useProposals = (): ProposalsApi => useContext(ProposalsContext);
