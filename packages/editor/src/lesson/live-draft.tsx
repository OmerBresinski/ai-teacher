/*
 * Live writing (TEACH-202 part f, ADR 0039): the slide the writer is writing, shown as it grows.
 *
 * The worker streams `slide-draft` job events: the slide laid out as it stands, a few times a
 * second. They live in a `DraftStore` beside the document, never in it: a draft is not the
 * teacher's copy, not in undo history and never saved. `LiveSlide` shows a slide's newest draft in
 * place of its saved copy only while the slide is still being written, types the words out between
 * two drafts (`revealSlide`) with a caret after the last word, and otherwise shows the saved slide
 * untouched. The saved slide always wins: once the slide is not writing, the draft is ignored.
 */
import type { Slide } from "@tj/domain/documents";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { FirstSlidesReveal } from "./first-slides-reveal";
import { useProposals } from "./proposals-context";

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

/** Words of `slideId` the first-slides reveal shows now; undefined shows the whole slide. */
export function useRevealed(
  reveal: FirstSlidesReveal | undefined,
  slideId: string | undefined,
): number | undefined {
  return useSyncExternalStore(
    reveal?.subscribe ?? NO_SUBSCRIBE,
    () => reveal?.words(slideId),
    () => undefined,
  );
}
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
 * The newest draft of `slideId` (undefined when there is none, or no id): a thumbnail of a slide
 * being written shows what the canvas shows rather than its blank saved copy (UX audit J6).
 * Re-renders only when that slide's draft changes.
 */
export function useSlideDraft(
  store: DraftStore | undefined,
  slideId: string | undefined,
): Slide | undefined {
  return useSyncExternalStore(
    store?.subscribe ?? NO_SUBSCRIBE,
    () => (slideId ? store?.get(slideId)?.slide : undefined),
    () => undefined,
  );
}

/**
 * What a small picture of `slide` (a strip thumbnail, a mobile card) draws while the job writes it,
 * as the canvas does: its newest draft (`withDraft`), else its outline while it is only planned,
 * else, on a new lesson's first two slides, the words the reveal has typed so far. Otherwise the
 * slide itself (TEACH-202 part f, amended 20 Oct 2026).
 */
export function useWritingPicture(slide: Slide, withDraft = true): Slide {
  const { drafts, reveal, writingSlideIds } = useProposals();
  const writing = writingSlideIds?.has(slide.id) ?? false;
  const draft = useSlideDraft(withDraft ? drafts : undefined, writing ? slide.id : undefined);
  const paced = useRevealed(reveal, writing && !draft ? slide.id : undefined);
  const outline = writing && !draft && isPlannedBlank(slide);
  return useMemo(
    () =>
      draft ??
      (outline
        ? skeletonSlide(slide)
        : paced !== undefined
          ? revealSlide(slide, paced).slide
          : slide),
    [draft, outline, paced, slide],
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
const PLANNED_VISUAL = "Planned visual";

/**
 * A slide waiting for its words (live writing): a soft heading bar and three text lines, so the
 * canvas shows where the slide will be rather than an empty page. Never saved.
 */
export function skeletonSlide(slide: Slide): Slide {
  // A slide that will show a picture or a diagram keeps its text to the left of that column, as its
  // layout will: the skeleton has the slide's shape, so the words arrive into it without a jump.
  const visual = slide.elements.find((e) => (e as { name?: string }).name === PLANNED_VISUAL);
  const room = visual ? Math.max(200, visual.x - 64 - 48) : Number.POSITIVE_INFINITY;
  const bar = (id: string, y: number, w: number, h: number) =>
    ({
      id: `skeleton-${id}`,
      type: "shape",
      shape: "rounded",
      x: 64,
      y,
      w,
      h,
      radius: h / 2,
      fill: "rgba(128, 128, 128, 0.14)",
    }) as Slide["elements"][number];
  return {
    ...slide,
    elements: [
      ...slide.elements.filter((e) => isPlannedBlank({ elements: [e] })),
      bar("h", 56, 520, 44),
      bar("l1", 160, Math.min(760, room), 18),
      bar("l2", 200, Math.min(700, room - 30), 18),
      bar("l3", 240, Math.min(560, room - 80), 18),
    ],
  };
}

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

/** `text` cut after its `n`th word (whitespace before that word kept, after it dropped). */
function cutWords(text: string, n: number): { text: string; used: number } {
  const re = /\S+/g;
  let used = 0;
  let end = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (used === n) return { text: text.slice(0, end), used };
    used++;
    end = m.index + m[0].length;
  }
  return { text, used };
}

/**
 * The slide with only its first `words` words of text showing, in reading order; boxes, shapes and
 * picture placeholders all show (the layout comes first). Returns the slide and the id of the text
 * element the last shown word is in (where the caret goes), if any text is cut.
 */
export function revealSlide(slide: Slide, words: number): { slide: Slide; at?: string } {
  let left = words;
  let at: string | undefined;
  const cutNode = (node: Node): Node | undefined => {
    if (node.type === "text") {
      if (left <= 0) return undefined;
      const c = cutWords(node.text ?? "", left);
      left -= c.used;
      return c.text ? { ...node, text: c.text } : undefined;
    }
    if (!node.content) return node;
    const content = node.content.map(cutNode).filter((x): x is Node => x !== undefined);
    return { ...node, content };
  };
  const walk = (els: readonly El[]): El[] =>
    els.map((e) => {
      if (e.type === "text") {
        const before = left;
        const doc = cutNode(e.doc as Node);
        if (left < before || (before > 0 && left === 0)) at = e.id;
        return { ...e, doc } as El;
      }
      const kids = (e as { children?: El[] }).children;
      return kids ? ({ ...e, children: walk(kids) } as El) : e;
    });
  const elements = walk(slide.elements);
  return { slide: { ...slide, elements }, ...(at && words < wordCount(slide) ? { at } : {}) };
}

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** How long the words between two drafts take to type out (a draft comes about every 200 ms). */
/** Fewest milliseconds between two shown steps: a step is a word or two, at most three. */
const STEP_MS = 70;
/** A step while a done slide's typing catches up before its saved copy shows. */
const RUSH_MS = 30;

/**
 * Types a draft's new words out at a steady pace (`STEP_MS` a step), a word a step, never more than
 * three; with reduced motion it shows each draft's words at once. Returns the words to show.
 */
function useTypewriter(
  target: number,
  key: string,
  reduced: boolean,
  rush = false,
  /** Words already on screen for a slide new to the typewriter (the first-slides reveal's count). */
  start?: number,
): number {
  const [shown, setShown] = useState(target);
  const ref = useRef({ shown: target, key });
  /** Words already typed per slide: a slide seen again (its draft back after a gap) resumes. */
  const typed = useRef(new Map<string, number>([[key, target]]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `start` only seeds a slide new to the typewriter (read when `key` changes); it never restarts the typing.
  useEffect(() => {
    const s = ref.current;
    if (s.key) typed.current.set(s.key, s.shown);
    // A new slide starts from its first draft's words, never from another slide's count.
    if (s.key !== key) {
      s.key = key;
      s.shown = reduced ? target : (typed.current.get(key) ?? Math.min(target, start ?? 1));
      setShown(s.shown);
    }
    if (reduced || s.shown >= target) {
      s.shown = Math.min(s.shown, target);
      if (reduced) s.shown = target;
      setShown(s.shown);
      return;
    }
    // A steady pace (a word about every 70 ms, near reading speed), so words that arrive in a burst
    // (the writer streams a slide's text, then its figure spec) type across the slide's window
    // rather than all at once; two or three words a step only when far behind, and the view moves
    // on with the next slide, so the typing is never more than a slide behind.
    // Rushing (the slide is done and its saved copy waits): three words a fast step to the end.
    const backlog = target - s.shown;
    const per = rush || backlog > 40 ? 3 : backlog > 20 ? 2 : 1;
    const step = rush ? RUSH_MS : STEP_MS;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (now - last >= step) {
        s.shown = Math.min(target, s.shown + per);
        typed.current.set(key, s.shown);
        last = now;
        setShown(s.shown);
      }
      if (s.shown < target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, key, reduced, rush]);
  // On the render where the slide changes the effect has not run yet: never show the last slide's
  // count for the new one (that flashed the new slide's whole text for a frame).
  if (ref.current.key !== key)
    return reduced ? target : Math.min(typed.current.get(key) ?? 1, target);
  return Math.min(shown, target);
}

/** How long a slide that stopped writing keeps its last draft while its saved copy catches up. */
const CATCH_UP_MS = 1500;

/** The caret remounts on every step, so its blink restarts: solid while typing, blinking at rest. */
const word = (n: number) => `w${n}`;

/** A thin caret after the last shown word, over the slide (fixed to the viewport, no layout). */
function Caret({ host, at, word }: { host: HTMLElement | null; at: string; word: number }) {
  const [box, setBox] = useState<{ x: number; y: number; h: number; c: string } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `word` re-measures as the text grows.
  useLayoutEffect(() => {
    const el = host?.querySelector(`[data-element-id="${CSS.escape(at)}"]`);
    if (!el) return setBox(null);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let lastText: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if ((n.textContent ?? "").trim()) lastText = n as Text;
    if (!lastText) return setBox(null);
    const range = document.createRange();
    const len = (lastText.textContent ?? "").replace(/\s+$/, "").length;
    range.setStart(lastText, Math.max(0, len - 1));
    range.setEnd(lastText, len);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1];
    if (!r) return setBox(null);
    setBox({
      x: r.right + 1,
      y: r.top,
      h: r.height,
      c: getComputedStyle(lastText.parentElement ?? el).color,
    });
  }, [host, at, word]);
  const blink = useRef<HTMLSpanElement | null>(null);
  // Solid while words arrive (each step remounts it); after half a second at rest it blinks.
  // biome-ignore lint/correctness/useExhaustiveDependencies: starts once the caret is on screen.
  useEffect(() => {
    const a = blink.current?.animate?.(
      [
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: 0.5 },
        { opacity: 0, offset: 0.5 },
        { opacity: 0, offset: 1 },
      ],
      { duration: 1000, delay: 500, iterations: Number.POSITIVE_INFINITY },
    );
    return () => a?.cancel();
  }, [box !== null]);
  if (!box) return null;
  return createPortal(
    <span
      ref={blink}
      aria-hidden
      data-live-caret
      style={{
        position: "fixed",
        left: box.x,
        top: box.y,
        height: box.h,
        width: Math.max(2, Math.round(box.h / 18)),
        background: box.c,
        pointerEvents: "none",
        zIndex: 30,
      }}
    />,
    document.body,
  );
}

/**
 * Shows `slide` (the saved copy) or, while it is being written, its newest draft typed out with a
 * caret. `render` draws whichever slide is shown, so the same tree draws the draft and the saved
 * copy and nothing remounts at the hand-over (ADR 0039: the final draft is laid exactly as the
 * saved slide, ids and all).
 */
export function LiveSlide({
  store,
  slideId,
  slide,
  writing,
  reveal,
  render,
}: {
  store: DraftStore | undefined;
  slideId: string | undefined;
  /** The saved copy, when there is one yet. */
  slide: Slide | undefined;
  /** The slide is still being written: only then can a draft show. */
  writing: boolean;
  /** A new lesson's title and objectives typing out (presentation only, never the document). */
  reveal?: FirstSlidesReveal;
  render: (slide: Slide | undefined, live: boolean) => ReactNode;
}) {
  const [, bump] = useState(0);
  useEffect(() => store?.subscribe(() => bump((n) => n + 1)), [store]);
  const reduced = useReducedMotion();
  // The hand-over: the slide's state can turn `done` a moment before its saved words reach the
  // open document (two reads of one save). Until the saved copy holds the draft's words, or for
  // `CATCH_UP_MS` at most, the last draft stays, so the slide never flashes an older copy. The
  // saved copy wins the moment it has caught up.
  const was = useRef<{ id?: string; writing: boolean; words: number }>({ writing, words: 0 });
  const [hold, setHold] = useState<{ id: string; until: number; words: number } | null>(null);
  const savedWords = slide ? wordCount(slide) : 0;
  // Before paint, so the older copy never shows for a frame.
  useLayoutEffect(() => {
    const prev = was.current;
    was.current = { id: slideId, writing, words: prev.id === slideId ? prev.words : 0 };
    if (prev.id !== slideId) typedNow.current = 0;
    if (
      prev.writing &&
      !writing &&
      prev.id === slideId &&
      slideId &&
      prev.words > Math.min(savedWords, typedNow.current)
    ) {
      setHold({ id: slideId, until: performance.now() + CATCH_UP_MS, words: prev.words });
      const t = setTimeout(() => setHold(null), CATCH_UP_MS);
      return () => clearTimeout(t);
    }
  }, [writing, slideId, savedWords]);
  // Words typed on this slide at the last render: a done slide finishes typing (fast) first.
  const typedNow = useRef(0);
  const holding =
    !writing &&
    hold !== null &&
    hold.id === slideId &&
    (savedWords < hold.words || typedNow.current < hold.words) &&
    performance.now() < hold.until;
  const draft = (writing || holding) && slideId ? store?.get(slideId) : undefined;
  if (draft && writing) was.current.words = wordCount(draft.slide);
  const target = draft ? wordCount(draft.slide) : 0;
  // The first two slides of a new lesson type out from their saved copy (first-slides-reveal.ts).
  const paced = useRevealed(reveal, writing && !draft && !reduced ? slideId : undefined);
  // A draft that takes over from that reveal carries on from the words already typed, never from
  // the first word again (review of UX-C: slides 1-2 typed twice on the phone).
  const pacedWas = useRef<{ id?: string; words: number }>({ words: 0 });
  if (paced !== undefined) pacedWas.current = { id: slideId, words: paced };
  const start = pacedWas.current.id === slideId ? pacedWas.current.words : undefined;
  const words = useTypewriter(target, draft ? (slideId ?? "") : "", reduced, holding, start);
  // Kept while the draft is off screen, so a released hold never flips back on.
  if (draft) typedNow.current = words;
  const host = useRef<HTMLDivElement | null>(null);
  // A writing slide with nothing on it yet and no draft: its outline, until its layout arrives.
  const waiting = writing && !draft && slide !== undefined && isPlannedBlank(slide);
  const shown = !draft
    ? waiting && slide
      ? { slide: skeletonSlide(slide) }
      : paced !== undefined && slide
        ? revealSlide(slide, paced)
        : { slide }
    : reduced
      ? { slide: draft.slide }
      : revealSlide(draft.slide, words);
  const at = (draft || paced !== undefined) && !reduced && "at" in shown ? shown.at : undefined;
  // A card or line that joins a slide already on screen slides in gently; a slide's first draft
  // shows at once (fading it in would read as a blank canvas when the view moves on).
  // A box the next draft moves glides from where it stood by a transform (FLIP), never by animating
  // its left/top/size, so the settling is not a layout shift (UX audit, 20 Oct: CLS at 1440).
  const joined = useRef<{ slide?: string; ids: Set<string>; at: Map<string, [number, number]> }>({
    ids: new Set(),
    at: new Map(),
  });
  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    const seen = joined.current;
    if (seen.slide !== slideId) {
      seen.slide = slideId;
      seen.ids = new Set();
      seen.at = new Map();
    }
    const first = seen.ids.size === 0;
    for (const el of root.querySelectorAll<HTMLElement>('[data-element-id^="d-"]')) {
      const id = el.dataset.elementId ?? "";
      const was = seen.at.get(id);
      const now: [number, number] = [el.offsetLeft, el.offsetTop];
      seen.at.set(id, now);
      if (was && !reduced && (was[0] !== now[0] || was[1] !== now[1]))
        el.animate?.(
          [{ translate: `${was[0] - now[0]}px ${was[1] - now[1]}px` }, { translate: "0 0" }],
          { duration: 220, easing: "ease" },
        );
      if (seen.ids.has(id)) continue;
      seen.ids.add(id);
      if (!first && !reduced)
        el.animate?.(
          [
            { opacity: 0, translate: "0 6px" },
            { opacity: 1, translate: "0 0" },
          ],
          { duration: 240, easing: "ease-out" },
        );
    }
  });
  const caretWord = draft ? words : (paced ?? 0);
  // One tree whatever is shown, so the canvas never remounts when the saved slide takes over.
  return (
    <div ref={host} data-live-slide={draft ? slideId : undefined} className="contents">
      {render(shown.slide, !!draft)}
      {at ? <Caret key={word(caretWord)} host={host.current} at={at} word={caretWord} /> : null}
    </div>
  );
}
