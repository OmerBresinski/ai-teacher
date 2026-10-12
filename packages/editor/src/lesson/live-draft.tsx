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
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type LiveDraft = { index: number; slideId: string; slide: Slide; final?: boolean };

/** The drafts of one generating job, newest per slide. Stable for the job; components subscribe. */
export type DraftStore = {
  get: (slideId: string) => LiveDraft | undefined;
  /** The draft of the slide with the highest index (the one being written now). */
  latest: () => LiveDraft | undefined;
  subscribe: (fn: () => void) => () => void;
  set: (drafts: Iterable<LiveDraft>) => void;
};

export function createDraftStore(): DraftStore {
  let byId = new Map<string, LiveDraft>();
  const subs = new Set<() => void>();
  return {
    get: (id) => byId.get(id),
    latest: () => {
      let best: LiveDraft | undefined;
      for (const d of byId.values()) if (!best || d.index > best.index) best = d;
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
const TYPE_MS = 240;
/** Fewest milliseconds between two shown steps: a step is a word or two, at most three. */
const STEP_MS = 30;

/**
 * Types a draft's new words out over about `TYPE_MS`, a word or two per step, never more than
 * three; with reduced motion it shows each draft's words at once. Returns the words to show.
 */
function useTypewriter(target: number, key: string, reduced: boolean): number {
  const [shown, setShown] = useState(target);
  const ref = useRef({ shown: target, key });
  /** Words already typed per slide: a slide seen again (its draft back after a gap) resumes. */
  const typed = useRef(new Map<string, number>([[key, target]]));
  useEffect(() => {
    const s = ref.current;
    if (s.key) typed.current.set(s.key, s.shown);
    // A new slide starts from its first draft's words, never from another slide's count.
    if (s.key !== key) {
      s.key = key;
      s.shown = reduced ? target : (typed.current.get(key) ?? 0);
      setShown(s.shown);
    }
    if (reduced || s.shown >= target) {
      s.shown = Math.min(s.shown, target);
      if (reduced) s.shown = target;
      setShown(s.shown);
      return;
    }
    // Words per step so the gap types out in about TYPE_MS (one step per STEP_MS): one word when
    // the writer is slow, up to three when it races ahead; never more than three at once.
    const per = Math.min(3, Math.max(1, Math.ceil(((target - s.shown) * STEP_MS) / TYPE_MS)));
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (now - last >= STEP_MS) {
        s.shown = Math.min(target, s.shown + per);
        typed.current.set(key, s.shown);
        last = now;
        setShown(s.shown);
      }
      if (s.shown < target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, key, reduced]);
  // On the render where the slide changes the effect has not run yet: never show the last slide's
  // count for the new one (that flashed the new slide's whole text for a frame).
  if (ref.current.key !== key)
    return reduced ? target : Math.min(typed.current.get(key) ?? 0, target);
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
  render,
}: {
  store: DraftStore | undefined;
  slideId: string | undefined;
  /** The saved copy, when there is one yet. */
  slide: Slide | undefined;
  /** The slide is still being written: only then can a draft show. */
  writing: boolean;
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
    if (prev.writing && !writing && prev.id === slideId && slideId && prev.words > savedWords) {
      setHold({ id: slideId, until: performance.now() + CATCH_UP_MS, words: prev.words });
      const t = setTimeout(() => setHold(null), CATCH_UP_MS);
      return () => clearTimeout(t);
    }
  }, [writing, slideId, savedWords]);
  const holding =
    !writing &&
    hold?.id === slideId &&
    savedWords < (hold?.words ?? 0) &&
    performance.now() < (hold?.until ?? 0);
  const draft = (writing || holding) && slideId ? store?.get(slideId) : undefined;
  if (draft && writing) was.current.words = wordCount(draft.slide);
  const target = draft ? wordCount(draft.slide) : 0;
  const words = useTypewriter(target, draft ? (slideId ?? "") : "", reduced);
  const host = useRef<HTMLDivElement | null>(null);
  const shown = !draft
    ? { slide }
    : reduced
      ? { slide: draft.slide }
      : revealSlide(draft.slide, words);
  const at = draft && !reduced && "at" in shown ? shown.at : undefined;
  // One tree whatever is shown, so the canvas never remounts when the saved slide takes over.
  return (
    <div ref={host} data-live-slide={draft ? slideId : undefined} className="contents">
      {render(shown.slide, !!draft)}
      {at ? <Caret key={word(words)} host={host.current} at={at} word={words} /> : null}
    </div>
  );
}
