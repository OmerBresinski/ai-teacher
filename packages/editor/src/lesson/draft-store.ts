/*
 * Live writing (TEACH-202 part f, ADR 0039): the drafts of a generating job, kept beside the
 * document. This is the small part every editor view needs while a lesson fills (the store, the
 * lead slide, word counts); the typing itself (`LiveSlide`, `./live-draft`) loads only while a
 * job is generating, so it stays out of the editor's first chunk and out of print.
 */
import type { Slide } from "@tj/domain/documents";
import { useSyncExternalStore } from "react";

export type LiveDraft = {
  index: number;
  slideId: string;
  slide: Slide;
  final?: boolean;
  /** The event's order on the job stream (its row id): a replayed older draft never wins. */
  seq?: number;
};

/** The drafts of one generating job, newest per slide. Stable for the job; components subscribe. */
export type DraftStore = {
  get: (slideId: string) => LiveDraft | undefined;
  /** The draft of the slide with the highest index (the one being written now). */
  latest: () => LiveDraft | undefined;
  /** The highest-index draft with words on it: the slide the view can open without a blank. */
  latestReady: () => LiveDraft | undefined;
  subscribe: (fn: () => void) => () => void;
  set: (drafts: Iterable<LiveDraft>) => void;
  /**
   * The job ended: the drafts go `afterMs` later (the last save reaches the document first). The
   * store owns the timer, so a view that unmounts at the job's end (the lock release) never keeps
   * them. Calling it again does not restart the wait.
   */
  end: (afterMs: number) => void;
};

export function createDraftStore(): DraftStore {
  let byId = new Map<string, LiveDraft>();
  const subs = new Set<() => void>();
  let ending: ReturnType<typeof setTimeout> | undefined;
  const store: DraftStore = {
    get: (id) => byId.get(id),
    latest: () => {
      let best: LiveDraft | undefined;
      for (const d of byId.values()) if (!best || d.index > best.index) best = d;
      return best;
    },
    latestReady: () => {
      let best: LiveDraft | undefined;
      for (const d of byId.values())
        if ((!best || d.index > best.index) && wordCount(d.slide) > 0) best = d;
      return best;
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set: (drafts) => {
      const next = new Map<string, LiveDraft>();
      for (const d of drafts) next.set(d.slideId, d);
      let same = next.size === byId.size;
      if (same) for (const [k, v] of next) if (byId.get(k) !== v) same = false;
      if (same) return;
      byId = next;
      for (const fn of subs) fn();
    },
    end: (afterMs) => {
      if (ending !== undefined) return;
      ending = setTimeout(() => store.set([]), afterMs);
    },
  };
  return store;
}

const NO_SUBSCRIBE = () => () => {};
/**
 * The id of the slide being written now, once it has words to show (a draft with only its layout
 * would open on an empty slide); re-renders only when it moves.
 */
export function useDraftLead(store: DraftStore | undefined): string | undefined {
  return useSyncExternalStore(
    store?.subscribe ?? NO_SUBSCRIBE,
    () => store?.latestReady()?.slideId,
    () => undefined,
  );
}

/**
 * A slide the writer has planned but not written yet (live writing, ADR 0039): blank, or holding
 * only its muted "Planned" line (what the slide will do, from the writer's flow).
 */
export function isPlannedBlank(slide: { elements?: readonly unknown[] }): boolean {
  const els = (slide.elements ?? []) as { name?: string }[];
  return els.every((e) => e.name === "Planned" || e.name === PLANNED_VISUAL);
}
/** The planned slide's visual column (the flow said the slide shows a picture or a diagram). */
export const PLANNED_VISUAL = "Planned visual";

const stores = new Map<string, DraftStore>();
/** The draft store of one job, the same object for every view that follows it (last few jobs). */
export function draftStoreFor(jobId: string): DraftStore {
  let store = stores.get(jobId);
  if (!store) {
    store = createDraftStore();
    stores.set(jobId, store);
    for (const k of [...stores.keys()].slice(0, -4)) stores.delete(k);
  }
  return store;
}

type El = Slide["elements"][number];
type Node = { type: string; text?: string; content?: Node[] };

/** Words of text on a slide, in reading order (the elements' order, then each doc's). */
export function wordCount(slide: Pick<Slide, "elements">): number {
  let n = 0;
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const visit = (node: Node) => {
    if (node.type === "text" && node.text) n += words(node.text);
    for (const c of node.content ?? []) visit(c);
  };
  const walk = (els: readonly El[]) => {
    for (const e of els) {
      if (e.type === "text") visit(e.doc as Node);
      const kids = (e as { children?: El[] }).children;
      if (kids) walk(kids);
    }
  };
  walk(slide.elements);
  return n;
}
