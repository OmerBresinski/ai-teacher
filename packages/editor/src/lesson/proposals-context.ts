import type { Id, RichDoc, Slide } from "@tj/domain/documents";
import { createContext, useContext } from "react";
import type { RegenerateTarget } from "./use-editor-session";

/*
 * What the app wires for the proposal jobs (TEACH-134, ADR 0025 §18): the editor never speaks
 * HTTP or SSE, so the facts panel and the regenerate dialog call back through this context and
 * the app enqueues, follows and applies (through `LessonEditorHandle`). `busySlideIds` paints the
 * "changing…" overlay on the navigator thumbs while a job is in flight; `busy` the panel's spinner.
 */

/**
 * What the editor sends for an edit with a prompt (TEACH-97): the slide as it is now and the
 * selected text box, or no box for the whole slide.
 */
export type PromptEditRequest = {
  slide: Slide;
  elementId?: Id | undefined;
  instruction: string;
  /** The thread's last 3 turns, oldest first; `slides` are the changed slides' paths (`s4`). */
  history?: { instruction: string; summary: string; slides: string[] }[] | undefined;
};

/**
 * The answer: each changed box's new doc and a one-line summary to apply as one undo step, or a
 * reason in teacher words and no change (rulings 172, 173). `need` says why an escalation could
 * not be a text edit (the agent path's reasons, `routeEdit` in `@tj/generation`).
 */
export type PromptEditAnswer =
  | { action: "edit"; changes: { elementId: Id; doc: RichDoc }[]; summary: string }
  | {
      action: "refuse" | "escalate" | "no-change" | "failed";
      reason: string;
      need?: string | undefined;
      /** Which check refused ("fit", "leak", …), when code refused. */
      check?: string | undefined;
      /** A refusal's one-tap offer: an instruction the teacher can send instead. */
      offer?: string | undefined;
    };

/**
 * An answer as it streams in (TEACH-97): the summary so far and each box's new text so far.
 * Unchecked and for display only; only the final answer is ever applied.
 */
export type PromptEditPartial = { summary: string; texts: { elementId: Id; text: string }[] };

export type ProposalsApi = {
  /**
   * Edit with a prompt: the app calls `POST /lessons/:id/edit`. Absent → no chat pane. With
   * `onPartial` the answer streams: partials arrive while the model writes, then the promise
   * resolves with the checked answer.
   */
  onPromptEdit?: (
    request: PromptEditRequest,
    signal?: AbortSignal,
    onPartial?: (partial: PromptEditPartial) => void,
  ) => Promise<PromptEditAnswer>;
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
