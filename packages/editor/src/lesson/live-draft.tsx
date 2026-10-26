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
export function skeletonSlide(slide: Slide, { line = true }: { line?: boolean } = {}): Slide {
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
      // On the canvas, the planned visual column only: the muted "Planned" line sat where the
      // slide's own words or footer go and vanished at the swap (judge 638). The strip keeps it.
      ...slide.elements.filter((e) => line || (e as { name?: string }).name === PLANNED_VISUAL),
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

/** A run laid out but not shown yet: transparent, with no highlight wash or strike. */
const UNTYPED = "transparent";
function hidden(node: Node): Node {
  const marks = ((node as { marks?: { type: string; attrs?: object }[] }).marks ?? []).filter(
    (m) => m.type !== "textStyle" && m.type !== "highlight",
  );
  return { ...node, marks: [...marks, { type: "textStyle", attrs: { color: UNTYPED } }] } as Node;
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

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (e: El, dx = 0, dy = 0): Box => {
  const g = e as unknown as Partial<Box>;
  return { x: (g.x ?? 0) + dx, y: (g.y ?? 0) + dy, w: g.w ?? 0, h: g.h ?? 0 };
};
const holds = (outer: Box, inner: Box) => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
};
/** The slide's title: its heading box (types first, whatever its place in the element list). */
const isTitle = (e: El) =>
  e.type === "text" && /^(heading|title)$/i.test(((e as { name?: string }).name ?? "").trim());

/**
 * The slide with only its first `words` words of text showing, and each region shown only once its
 * own content starts arriving (Greg 26 Oct: "the layouts seem to update before text comes in"):
 * - the title types first, wherever it sits in the element list; nothing shows before its first
 *   word (a draft with no words yet is a blank slide, never an empty layout);
 * - a text box shows with its first word;
 * - a box, card or answer area that holds text shows with the first word of the text inside it;
 * - a shape that holds no text (a rule, an accent) shows with the first word of the next text in
 *   reading order;
 * - a picture or diagram box shows with the slide's first word (the title), never before it.
 * Returns the slide and the id of the text element the last shown word is in (where the caret
 * goes), if any text is cut.
 */
export function revealSlide(slide: Slide, words: number): { slide: Slide; at?: string } {
  // Boxes in slide coordinates: a group lays its children relative to itself.
  type Item = { e: El; box: Box; texts: number };
  const order: Item[] = [];
  const flatten = (els: readonly El[], dx = 0, dy = 0) => {
    for (const e of els) {
      const box = boxOf(e, dx, dy);
      order.push({ e, box, texts: wordCount({ elements: [e] }) });
      const kids = (e as { children?: El[] }).children;
      if (kids) flatten(kids, box.x, box.y);
    }
  };
  flatten(slide.elements);
  const total = wordCount(slide);
  // Typing order: the title first, then every other text in reading order.
  const texts = order.filter((i) => i.e.type === "text");
  const title = texts.find((i) => isTitle(i.e));
  const typing = title ? [title, ...texts.filter((i) => i !== title)] : texts;
  const startOf = new Map<El, number>();
  let n = 0;
  for (const i of typing) {
    startOf.set(i.e, n);
    n += i.texts;
  }
  const shownOf = (e: El) =>
    Math.max(0, Math.min(words - (startOf.get(e) ?? 0), wordCount({ elements: [e] })));
  // A slide with no text box at all (a picture, a diagram, shapes) has no words to wait for: every
  // region shows at once.
  const all = (total > 0 && words >= total) || texts.length === 0;
  const inside = (outer: Item, inner: Item) => inner !== outer && holds(outer.box, inner.box);
  // Words before each element's next text in reading order (pre-order), for a shape with none in it.
  const reach = new Map<El, number>();
  let next = Number.POSITIVE_INFINITY;
  for (let k = order.length - 1; k >= 0; k--) {
    const item = order[k] as Item;
    if (item.e.type === "text") next = startOf.get(item.e) ?? next;
    reach.set(item.e, next);
  }
  const started = words > 0;
  /**
   * The text a picture or a badge belongs to: its caption or label, the nearest text just below it
   * (sharing its column) or just beside it (sharing its row). Judge 638: picture boxes and badges
   * stood empty, then the labels popped in as a group.
   */
  const own = new Map<El, Item | undefined>();
  const ownText = (item: Item): Item | undefined => {
    if (own.has(item.e)) return own.get(item.e);
    const b = item.box;
    let best: Item | undefined;
    let gap = Number.POSITIVE_INFINITY;
    for (const t of texts) {
      if (t.texts === 0 || isTitle(t.e) || t === item) continue;
      const tb = t.box;
      const xOver = Math.min(b.x + b.w, tb.x + tb.w) - Math.max(b.x, tb.x);
      const yOver = Math.min(b.y + b.h, tb.y + tb.h) - Math.max(b.y, tb.y);
      const below =
        tb.y >= b.y + b.h / 2 && xOver >= Math.min(b.w, tb.w) / 2 ? tb.y - (b.y + b.h) : Number.NaN;
      const beside =
        tb.x >= b.x + b.w / 2 && yOver >= Math.min(b.h, tb.h) / 2 ? tb.x - (b.x + b.w) : Number.NaN;
      for (const g of [below, beside])
        if (!Number.isNaN(g) && g <= OWN_GAP && Math.max(0, g) < gap) {
          gap = Math.max(0, g);
          best = t;
        }
    }
    own.set(item.e, best);
    return best;
  };
  /** A picture or a text-less box: with its own text, else the next text in reading order, else the title. */
  const withOwn = (item: Item): boolean => {
    const mine = ownText(item);
    if (mine) return shownOf(mine.e) > 0;
    const at = reach.get(item.e) ?? Number.POSITIVE_INFINITY;
    return Number.isFinite(at) ? words > at : true;
  };
  const showsItem = (item: Item): boolean => {
    const e = item.e;
    if (all) return true;
    if (!started) return false;
    if (e.type === "text") return shownOf(e) > 0;
    // The slide's visual zone (a big picture) comes with the title; an item's small picture with
    // its own label (judge 638b: the footer typed before the picture of "Four plant parts").
    if (e.type === "image")
      return item.box.w * item.box.h >= ZONE_SHARE * 960 * 540 ? true : withOwn(item);
    if (e.type === "shape") {
      const held = texts.filter((t) => t.texts > 0 && inside(item, t));
      if (held.length) return held.some((t) => shownOf(t.e) > 0);
      // A card round a picture comes with that picture.
      const pic = order.find((p) => p.e.type === "image" && inside(item, p));
      if (pic) return withOwn(pic);
      // A badge, rule or accent: with its own label, else the next text, else the title.
      return withOwn(item);
    }
    // Anything else (a table, a diagram, a chart) is a visual: it comes with the title.
    if (!(e as { children?: El[] }).children) return true;
    return false;
  };
  const itemOf = new Map(order.map((i) => [i.e, i]));
  const shows = (e: El) => showsItem(itemOf.get(e) as Item);
  let at: string | undefined;
  let atStart = -1;
  const cutDoc = (e: El): Node => {
    let left = shownOf(e);
    // The words of a line that has started are all laid out, the untyped ones transparent, so the
    // line breaks (and balanced wrapping) are those of the arrived text and never move as the typing
    // goes on (judge 638b: the quiz heading typed on one line, then jumped to two). A block with no
    // shown word yet is left out, as before.
    const cutNode = (node: Node, started: boolean): Node[] => {
      if (node.type === "text") {
        if (left <= 0) return started ? [hidden(node)] : [];
        const text = node.text ?? "";
        const c = cutWords(text, left);
        left -= c.used;
        if (c.text.length >= text.length) return [node];
        const rest = hidden({ ...node, text: text.slice(c.text.length) });
        return c.text ? [{ ...node, text: c.text }, rest] : [rest];
      }
      if (!node.content) return [node];
      const leaf = node.content.every((k) => k.type === "text" || !k.content);
      if (leaf && left <= 0) return [];
      return [{ ...node, content: node.content.flatMap((k) => cutNode(k, leaf || started)) }];
    };
    const doc = (e as { doc?: unknown }).doc as Node;
    return cutNode(doc, false)[0] ?? { ...doc, content: [] };
  };
  const walk = (els: readonly El[]): El[] =>
    els.flatMap((e) => {
      if (e.type === "text") {
        const shown = shownOf(e);
        const start = startOf.get(e) ?? 0;
        // The caret sits after the last word typed: in the box typed latest.
        if (shown > 0 && start > atStart) {
          at = e.id;
          atStart = start;
        }
        return shows(e) ? [{ ...e, doc: cutDoc(e) } as El] : [];
      }
      const kids = (e as { children?: El[] }).children;
      if (kids) {
        const shown = walk(kids);
        return shown.length || shows(e) ? [{ ...e, children: shown } as El] : [];
      }
      return shows(e) ? [e] : [];
    });
  const elements = walk(slide.elements);
  return { slide: { ...slide, elements }, ...(at && words < total ? { at } : {}) };
}

/**
 * Words to type out on a slide that is new to the view with all its words already there (the
 * writer finished it before the view arrived): a short catch-up typing animation, so a slide never
 * appears fully formed (Greg 26 Oct). Steps of `CATCH_UP_STEP_MS`, at most `CATCH_UP_STEPS` of them.
 */
export function catchUpStep(total: number): number {
  return Math.max(1, Math.ceil(total / CATCH_UP_STEPS));
}
export const CATCH_UP_STEPS = 18;
const SEEN = new WeakMap<object, Set<string>>();
const SEEN_LOOSE = new Set<string>();
/** The slides a view has shown whole, per draft store (one store per editor). */
function seenFor(store: object | undefined): Set<string> {
  if (!store) return SEEN_LOOSE;
  let s = SEEN.get(store);
  if (!s) {
    s = new Set();
    SEEN.set(store, s);
  }
  return s;
}

/** How far (slide px) a caption or label may sit from its picture or badge and still be its own. */
const OWN_GAP = 120;
/** How far apart items that join together fade in (a row of cards). */
const JOIN_STAGGER_MS = 140;
/** A picture at least this share of the slide is the slide's visual zone: it comes with the title. */
const ZONE_SHARE = 0.12;
export const CATCH_UP_STEP_MS = 35;

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
const RUSH_MS = 45;
/** A step while the view is two or more slides behind the writer: the typing speeds up to catch up. */
const HURRY_MS = 40;

/** How the typewriter goes: its steady pace, faster when behind, or a short catch-up animation. */
export type TypePace = "type" | "hurry" | "catch-up";

/**
 * Types a draft's new words out at a steady pace (`STEP_MS` a step), a word a step, never more than
 * three; with reduced motion it shows each draft's words at once. Returns the words to show.
 */
export function useTypewriter(
  target: number,
  key: string,
  reduced: boolean,
  rush = false,
  /** Words already on screen for a slide new to the typewriter (the first-slides reveal's count). */
  start?: number,
  pace: TypePace = "type",
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
    // Catching up (a slide written whole before the view reached it): the same number of steps
    // whatever its length, so it types in well under a second.
    const backlog = target - s.shown;
    const catchUp = !rush && pace === "catch-up";
    // Rushing (a done slide's last words before its saved copy) still types a word or two a step,
    // never a block of labels in one frame (judge 638).
    const per = catchUp
      ? catchUpStep(target)
      : rush
        ? backlog > 30
          ? 2
          : 1
        : backlog > 40
          ? 3
          : backlog > 20
            ? 2
            : 1;
    const step = rush
      ? RUSH_MS
      : catchUp
        ? CATCH_UP_STEP_MS
        : pace === "hurry"
          ? HURRY_MS
          : STEP_MS;
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
  }, [target, key, reduced, rush, pace]);
  // On the render where the slide changes the effect has not run yet: never show the last slide's
  // count for the new one (that flashed the new slide's whole text for a frame).
  if (ref.current.key !== key)
    return reduced ? target : Math.min(typed.current.get(key) ?? 1, target);
  return Math.min(shown, target);
}

/**
 * A draft still waiting for its first words: it has a text box, and its layout is not final (a
 * slide with no text, or a final draft with none, shows its regions rather than the outline).
 */
export function waitsForWords(draft: LiveDraft): boolean {
  if (draft.final) return false;
  const has = (els: readonly El[]): boolean =>
    els.some((e) => e.type === "text" || has(((e as { children?: El[] }).children ?? []) as El[]));
  return has(draft.slide.elements);
}

/** How long a slide that stopped writing keeps its last draft while its saved copy catches up. */
const CATCH_UP_MS = 1500;

/** The caret remounts on every step, so its blink restarts: solid while typing, blinking at rest. */
const word = (n: number) => `w${n}`;

/** Where the caret goes: just after the last visible character of box `at`, in viewport pixels. */
function caretBox(
  host: HTMLElement | null,
  at: string,
): { x: number; y: number; h: number; c: string } | null {
  const el = host?.querySelector(`[data-element-id="${CSS.escape(at)}"]`);
  if (!el) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let lastText: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // Laid-out words not typed yet (transparent) are never where the caret goes.
    const c = n.parentElement ? getComputedStyle(n.parentElement).color : "";
    if (c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c)) continue;
    if ((n.textContent ?? "").trim()) lastText = n as Text;
  }
  if (!lastText) return null;
  const range = document.createRange();
  const len = (lastText.textContent ?? "").replace(/\s+$/, "").length;
  range.setStart(lastText, Math.max(0, len - 1));
  range.setEnd(lastText, len);
  const rects = range.getClientRects();
  const r = rects[rects.length - 1];
  if (!r) return null;
  return {
    x: r.right + 1,
    y: r.top,
    h: r.height,
    c: getComputedStyle(lastText.parentElement ?? el).color,
  };
}

/** A thin caret after the last shown word, over the slide (fixed to the viewport, no layout). */
function Caret({ host, at, word }: { host: HTMLElement | null; at: string; word: number }) {
  const [box, setBox] = useState<{ x: number; y: number; h: number; c: string } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `word` re-measures as the text grows.
  useLayoutEffect(() => {
    // Measured before paint, then every frame while it is up: a box that glides into place (a
    // re-laid draft) carries its caret with it, so the caret never stands where the word was a
    // moment ago and then jumps (Greg 26 Oct: the caret started indented, then jumped left).
    let raf = 0;
    let last = "";
    const measure = () => {
      const next = caretBox(host, at);
      const key = next ? `${next.x},${next.y},${next.h},${next.c}` : "";
      if (key !== last) {
        last = key;
        setBox(next);
      }
    };
    measure();
    const loop = () => {
      measure();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
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
  onTyped,
  typeIn = false,
  hurry = false,
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
  /** The slide, once every word it has so far is on screen; undefined while words wait to type. */
  onTyped?: (slideId: string | undefined) => void;
  /**
   * The view is following the writer: a slide it opens with all its words already written types
   * them in (a short catch-up), so no slide appears fully formed (Greg 26 Oct).
   */
  typeIn?: boolean;
  /** The view is behind the writer: the typing goes faster so it keeps up. */
  hurry?: boolean;
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
  // A done slide the follow opened that this view never typed: it types in, from its title.
  // Kept per draft store (one per editor), not per mount: a canvas that remounts its slide when it
  // turns done must not forget the slide was already typed.
  const seen = useRef(seenFor(store));
  /** When the last staggered item of this slide finishes fading in. */
  const joinedAt = useRef(0);
  // A slide the first-slides reveal typed was typed here: when the reveal ends it stays whole,
  // never typed in again (judge 638b: the objectives cleared to "By the end" and retyped).
  if (paced !== undefined && slideId) seen.current.add(slideId);
  const catchUp =
    typeIn &&
    !reduced &&
    !draft &&
    paced === undefined &&
    slideId !== undefined &&
    slide !== undefined &&
    savedWords > 0 &&
    !isPlannedBlank(slide) &&
    !seen.current.has(slideId);
  const words = useTypewriter(
    draft ? target : catchUp ? savedWords : 0,
    draft ? (slideId ?? "") : catchUp ? `in:${slideId}` : "",
    reduced,
    holding,
    catchUp ? 1 : start,
    catchUp ? "catch-up" : hurry ? "hurry" : "type",
  );
  // Kept while the draft is off screen, so a released hold never flips back on.
  if (draft) typedNow.current = words;
  // The render where the slide stops writing comes before its hold is set (the layout effect
  // above): its words are not all shown yet, so it is not typed out.
  const handing =
    was.current.writing &&
    !writing &&
    was.current.id === slideId &&
    was.current.words > Math.min(savedWords, typedNow.current);
  const typed =
    !handing &&
    (draft
      ? words >= target
      : catchUp
        ? words >= savedWords
        : paced === undefined || paced >= savedWords);
  // Every slide this view has shown whole is never typed in again (a hand-over, a revisit).
  // A slide shown whole while still writing (its first-slides reveal over, or a reload) counts too:
  // when it turns done it never types in again (judge 638b: the objectives cleared to "By the end"
  // and retyped when the slide was redrawn as done). Text that changes later updates in place.
  if (typed && slideId && (draft ? words >= wordCount(draft.slide) : true)) {
    const blank = writing && !draft && slide !== undefined && isPlannedBlank(slide);
    if (!blank) seen.current.add(slideId);
  }
  if (draft && slideId) seen.current.add(slideId);
  // Typed means seen: a row whose items still fade in, staggered, reports once the last has landed,
  // so the read time starts from what the teacher sees (judge 638b: the quiz left 0.5 s after).
  useEffect(() => {
    if (!typed) {
      onTyped?.(undefined);
      return;
    }
    const left = joinedAt.current - performance.now();
    if (left <= 0) {
      onTyped?.(slideId);
      return;
    }
    const t = setTimeout(() => onTyped?.(slideId), left);
    return () => clearTimeout(t);
  }, [typed, slideId, onTyped]);
  const host = useRef<HTMLDivElement | null>(null);
  // A writing slide with nothing on it yet and no draft: its outline, until its layout arrives.
  const waiting = writing && !draft && slide !== undefined && isPlannedBlank(slide);
  const shown = !draft
    ? waiting && slide
      ? { slide: skeletonSlide(slide, { line: false }) }
      : paced !== undefined && slide
        ? revealSlide(slide, paced)
        : catchUp && slide
          ? revealSlide(slide, words)
          : { slide }
    : reduced || (!waitsForWords(draft) && wordCount(draft.slide) === 0)
      ? { slide: draft.slide }
      : words <= 0 && slide !== undefined && isPlannedBlank(slide) && waitsForWords(draft)
        ? // Its layout arrived but no word yet: the ruled outline stays (ruling 278), never an
          // empty layout or a blank slide.
          { slide: skeletonSlide(slide, { line: false }) }
        : revealSlide(draft.slide, words);
  const at =
    (draft || paced !== undefined || catchUp) && !reduced && "at" in shown ? shown.at : undefined;
  // A card or picture box that joins a slide already on screen fades in; a slide's first draft
  // shows at once (fading it in would read as a blank canvas when the view moves on).
  // A box the next draft moves glides from where it stood by a transform (FLIP), never by animating
  // its left/top/size, so the settling is not a layout shift (UX audit, 20 Oct: CLS at 1440).
  const joined = useRef<{
    slide?: string;
    ids: Set<string>;
    at: Map<string, [number, number]>;
    lastJoin: number;
  }>({
    lastJoin: 0,
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
      seen.lastJoin = 0;
    }
    const first = seen.ids.size === 0;
    const fresh: HTMLElement[] = [];
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
      if (!first && !reduced) fresh.push(el);
    }
    // A card, chip, badge or picture box that joins fades in, and the words inside it fade with it,
    // so a chip's word never shows on a bare slide before its chip (judge 638: "Stem" unstyled for a
    // frame). A text box on its own types in unfaded (a faint first word under a solid caret read
    // as a ghost, Greg 26 Oct).
    // Items that join a frame or two apart (a row of cards as their labels type) are staggered
    // JOIN_STAGGER_MS apart, each fading with its own words (judge 638b: four cards popped one
    // per frame).
    const now = performance.now();
    const boxes = fresh
      .filter((el) => el.dataset.elementType !== "text")
      .map((el) => ({ el, r: el.getBoundingClientRect(), delay: 0 }));
    const clip = host.current?.closest("[data-slide-clip]")?.getBoundingClientRect();
    const area = clip ? clip.width * clip.height : 0;
    const big = (r: DOMRect) => area > 0 && r.width * r.height >= ZONE_SHARE * area;
    for (const b of boxes) {
      if (big(b.r)) continue;
      b.delay = Math.max(0, seen.lastJoin + JOIN_STAGGER_MS - now);
      seen.lastJoin = now + b.delay;
      joinedAt.current = seen.lastJoin + 180;
    }
    const around = (r: DOMRect) =>
      boxes.find(({ r: c }) => {
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        return x >= c.left && x <= c.right && y >= c.top && y <= c.bottom;
      });
    for (const el of fresh) {
      const box =
        el.dataset.elementType === "text"
          ? around(el.getBoundingClientRect())
          : boxes.find((b) => b.el === el);
      if (box)
        el.animate?.([{ opacity: 0 }, { opacity: 1 }], {
          duration: 180,
          delay: box.delay,
          easing: "ease-out",
          fill: "backwards",
        });
    }
  });
  const caretWord = draft || catchUp ? words : (paced ?? 0);
  // One tree whatever is shown, so the canvas never remounts when the saved slide takes over.
  return (
    <div ref={host} data-live-slide={draft ? slideId : undefined} className="contents">
      {render(shown.slide, !!draft)}
      {at ? <Caret key={word(caretWord)} host={host.current} at={at} word={caretWord} /> : null}
    </div>
  );
}
