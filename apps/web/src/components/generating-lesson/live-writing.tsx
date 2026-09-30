import { SLIDE_H, SLIDE_W, type Slide } from "@tj/domain/documents";
import { type JobEvent, LIVE_BLANK, LIVE_PENDING } from "@tj/domain/jobs";
import type { getTheme } from "@tj/editor";
import { SlideView } from "@tj/editor";
import { SlideStatic } from "@tj/editor/thumb";
import { cn, Skeleton } from "@tj/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { env } from "@/env";

/*
 * Live writing in the generating editor (spike/live-writing, VITE_LIVE_WRITING=1). The worker's
 * stream sends the slide it is writing as it stands (`progress.live`): drawn in its real layout,
 * every word still to come a run of `LIVE_BLANK`. Here the blanks become skeleton bars in the
 * theme's ink, placeholder photos a picture zone, and the written words sit where they will stay.
 * The saved document wins: a slide that has been saved never shows its live copy again.
 */

export const liveWritingEnabled = (): boolean => env.VITE_LIVE_WRITING === "1";

type Theme = ReturnType<typeof getTheme>;

export type LiveSlides = ReadonlyMap<number, { kind: string; slide?: Slide }>;

/** The newest live copy of each slide the stream has reached. */
export function latestLive(events: readonly JobEvent[]): LiveSlides {
  const out = new Map<number, { kind: string; slide?: Slide }>();
  for (const event of events) {
    if (event.type !== "progress" || !event.progress.live) continue;
    const { index, kind, slide } = event.progress.live;
    out.set(index, { kind, ...(slide ? { slide: slide as Slide } : {}) });
  }
  return out;
}

type Box = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "text" | "picture";
  visible: boolean;
};
type Node = { text?: string; content?: Node[]; marks?: { type: string }[]; [k: string]: unknown };

const DIAGRAM_SLOT = "Diagram placeholder";

/** A saved slide the stream has written, not a `LIVE_PENDING` place holder. */
export const isWritten = (slide: Slide): boolean => !slide.id.startsWith(LIVE_PENDING);

const BLANK_RUN = new RegExp(`${LIVE_BLANK}+`, "g");
const PLACEHOLDER_FILL = "%23E9E8E3";
const isPlaceholderPhoto = (src: string) =>
  src.startsWith("data:image/svg+xml") && src.includes(PLACEHOLDER_FILL);

const cleanLeaf = (t: string) => {
  const clean = t.replace(BLANK_RUN, "").replace(/\s{2,}/g, " ");
  // A run of blanks leaves only its spaces behind: that is no word yet.
  return clean !== t && clean.trim() === "" ? "" : clean;
};
const leafNodes = (node: Node): Node[] =>
  typeof node.text === "string" ? [node] : (node.content ?? []).flatMap(leafNodes);
/** The words a text holds, the blanks taken out. */
function textOf(node: Node): string {
  return leafNodes(node)
    .map((l) => cleanLeaf(l.text ?? ""))
    .join("");
}

type El = Slide["elements"][number];

/** Characters shown per text box, by the box's place in reading order; "all" shows every word. */
export type Shown = "all" | ReadonlyMap<number, number>;

/** The text boxes (and shapes with words) of a slide in reading order, with their words. */
export function docTexts(slide: Slide): string[] {
  const out: string[] = [];
  const walk = (el: El) => {
    const d = (el as El & { doc?: unknown }).doc;
    if (d && typeof d === "object") out.push(textOf(d as Node));
    if (el.type === "group") for (const c of el.children) walk(c as El);
  };
  for (const el of slide.elements) walk(el);
  return out;
}

/** Spread a character budget over the boxes in reading order (the paced title and objectives). */
export function shownFromChars(slide: Slide, chars: number): Shown {
  if (!Number.isFinite(chars)) return "all";
  let left = chars;
  return new Map(
    docTexts(slide).map((t, i) => {
      const n = Math.max(0, Math.min(t.length, left));
      left -= n;
      return [i, n] as const;
    }),
  );
}

const rgba = (hex: string, alpha: number): string | undefined => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return undefined;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number.parseInt(x as string, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
};

/** The doc cut to `len` characters, the words from `fadeFrom` on in the fading colour. */
function cutTyped(doc: Node, len: number, fadeFrom: number, fade: string | undefined): Node {
  let at = 0;
  const cut = (node: Node): Node[] => {
    if (typeof node.text === "string") {
      const t = cleanLeaf(node.text);
      const a = at;
      at += t.length;
      const keep = t.slice(0, Math.max(0, len - a));
      if (!keep) return [];
      const split = fadeFrom - a;
      if (!fade || split >= keep.length) return [{ ...node, text: keep }];
      const marks = (node.marks ?? []).filter((m) => m.type !== "textStyle");
      const faded = { ...node, text: keep.slice(Math.max(0, split)) };
      faded.marks = [...marks, { type: "textStyle", attrs: { color: fade } } as { type: string }];
      return split > 0 ? [{ ...node, text: keep.slice(0, split) }, faded] : [faded];
    }
    if (!node.content) return [node];
    return [{ ...node, content: node.content.flatMap(cut) }];
  };
  return cut(doc)[0] ?? doc;
}

/**
 * The slide as the teacher sees it while it is typed: each box shows `shown` characters, rounded
 * up to whole words, the newest word fading in; a box with nothing shown yet is a skeleton bar in
 * its final place (the layout is the whole slide's, so nothing moves as the words arrive). Open
 * diagram slots and placeholder photos are picture zones.
 */
export function typedView(
  slide: Slide,
  shown: Shown,
  theme: Theme,
): { slide: Slide; blanks: Box[] } {
  const blanks: Box[] = [];
  let pos = 0;
  const walk = (el: El): El | undefined => {
    if (el.name === DIAGRAM_SLOT) {
      blanks.push({
        key: el.id,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
        kind: "picture",
        visible: true,
      });
      return undefined;
    }
    const withDoc = el as El & { doc?: unknown; style?: { color?: string } };
    if (withDoc.doc && typeof withDoc.doc === "object") {
      const doc = withDoc.doc as Node;
      const text = textOf(doc);
      const n = shown === "all" ? Number.POSITIVE_INFINITY : (shown.get(pos) ?? 0);
      const inset = el.type === "text" ? 0 : Math.min(56, el.w * 0.12);
      const empty = shown === "all" ? text.trim() === "" : n < 1;
      blanks.push({
        key: `t${pos}`,
        x: el.x + inset,
        y: el.y,
        w: el.w - inset * 1.5,
        h: el.h,
        kind: "text",
        visible: empty,
      });
      pos += 1;
      let len = text.length;
      let fadeFrom = len;
      let alpha = 1;
      if (n < 1) len = 0;
      else if (n < text.length) {
        const i = Math.floor(n);
        const start = text.lastIndexOf(" ", i - 1) + 1;
        const next = text.indexOf(" ", i);
        const end = next === -1 ? text.length : next;
        len = end;
        fadeFrom = start;
        alpha = Math.min(1, Math.max(0.15, (n - start) / Math.max(3, end - start)));
      }
      const color = withDoc.style?.color ?? theme.colors.ink;
      const fade = alpha < 1 ? rgba(color, alpha) : undefined;
      return { ...el, doc: cutTyped(doc, len, fadeFrom, fade) } as unknown as El;
    }
    if (el.type === "image") {
      if (isPlaceholderPhoto(el.src)) {
        blanks.push({
          key: el.id,
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          kind: "picture",
          visible: true,
        });
        return undefined;
      }
      // A new id when the photo lands, so its view mounts again and fades in.
      return { ...el, id: `${el.id}~${el.src.length}` };
    }
    if (el.type === "group") {
      return { ...el, children: el.children.flatMap((c) => walk(c as El) ?? []) } as El;
    }
    return el;
  };
  return { slide: { ...slide, elements: slide.elements.flatMap((e) => walk(e) ?? []) }, blanks };
}

/** The slide with every written word showing (the pass-1 name, kept for the editable slide). */
export function liveView(slide: Slide, chars?: number, theme?: Theme) {
  const t = theme ?? ({ colors: { ink: "#000000" } } as Theme);
  return typedView(slide, chars === undefined ? "all" : shownFromChars(slide, chars), t);
}

/** Reading pace in characters a second, faster the further the typing is behind the stream. */
export const typingRate = (backlog: number): number =>
  Math.min(90, 45 + Math.max(0, backlog - 200) * 0.25);

/**
 * The client-side typist (ruling 138): server chunks are never shown as they land. Each slide the
 * stream reaches is typed in index order, one box at a time in reading order, at `typingRate`;
 * a box waits for its words while the stream is still writing it, and a slide is done once it is
 * closed (saved, or the stream has moved past it) and every box is typed.
 */
export function useTypewriter(targets: ReadonlyMap<number, { slide: Slide; closed: boolean }>): {
  index: number | undefined;
  shown: ReadonlyMap<number, number>;
  done: ReadonlySet<number>;
} {
  const state = useRef({
    index: -1,
    shown: new Map<number, number>(),
    done: new Set<number>(),
    last: 0,
  });
  const [, setTick] = useState(0);
  const index = [...targets.keys()]
    .filter((i) => !state.current.done.has(i))
    .sort((a, b) => a - b)[0];
  const target = index === undefined ? undefined : targets.get(index);
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    if (index === undefined) return;
    let frame = 0;
    const step = (now: number) => {
      const s = state.current;
      const t = latest.current;
      const dt = s.last === 0 ? 0 : Math.min(0.1, (now - s.last) / 1000);
      s.last = now;
      if (!t) return;
      if (s.index !== index) {
        s.index = index;
        s.shown = new Map();
      }
      const texts = docTexts(t.slide);
      const total = texts.reduce((n, x) => n + x.length, 0);
      const typed = texts.reduce((n, _, i) => n + Math.min(s.shown.get(i) ?? 0, _.length), 0);
      let budget = typingRate(total - typed) * dt;
      let changed = false;
      for (let i = 0; i < texts.length; i++) {
        const len = (texts[i] as string).length;
        const cur = s.shown.get(i) ?? 0;
        if (cur < len && budget > 0) {
          const next = Math.min(len, cur + budget);
          budget -= next - cur;
          s.shown.set(i, next);
          changed = true;
        }
        if ((s.shown.get(i) ?? 0) < len) break;
        const later = texts.slice(i + 1).some((x) => x.length > 0);
        if (!later && !t.closed) break;
      }
      if (t.closed && texts.every((x, i) => (s.shown.get(i) ?? 0) >= x.length)) {
        s.done.add(index);
        s.last = 0;
        setTick((n) => n + 1);
        return;
      }
      if (changed) setTick((n) => n + 1);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [index]);
  return {
    index,
    shown: state.current.index === index ? new Map(state.current.shown) : new Map(),
    done: state.current.done,
  };
}

/** Skeleton bars and picture zones over the slide, in the theme's ink, at the boxes' places. */
export function BlankLayer({
  blanks,
  theme,
  active = false,
}: {
  blanks: Box[];
  theme: Theme;
  /** Only the slide being written (or about to be) shimmers; the rest wait still. */
  active?: boolean;
}) {
  const tone = { backgroundColor: `color-mix(in srgb, ${theme.colors.ink} 15%, transparent)` };
  const still = active ? undefined : "motion-safe:animate-none";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-live-blanks>
      {blanks.map((b) => {
        const style = {
          left: `${(b.x / SLIDE_W) * 100}%`,
          top: `${(b.y / SLIDE_H) * 100}%`,
          width: `${(b.w / SLIDE_W) * 100}%`,
          height: `${(b.h / SLIDE_H) * 100}%`,
          opacity: b.visible ? 1 : 0,
          transition:
            "opacity 450ms ease, left 300ms ease, top 300ms ease, width 300ms ease, height 300ms ease",
        };
        if (b.kind === "picture") {
          return (
            <Skeleton
              key={b.key}
              className={cn("absolute rounded-[3%]", still)}
              style={{ ...style, ...tone }}
            />
          );
        }
        const lines = Math.max(1, Math.min(4, Math.round(b.h / 44)));
        return (
          <div
            key={b.key}
            className="absolute flex flex-col justify-center gap-[12%]"
            style={style}
          >
            {Array.from({ length: lines }, (_, i) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars, never reordered
                key={i}
                className={cn("rounded-full", still)}
                style={{
                  ...tone,
                  height: `${Math.min(60, 70 / lines)}%`,
                  width: `${i === lines - 1 && lines > 1 ? 62 : 92 - i * 6}%`,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** A slide in the navigator as the teacher sees it now: typed so far, skeletons for the rest. */
export function LiveThumb({
  slide,
  theme,
  width,
  shown = "all",
  active = false,
}: {
  slide: Slide;
  theme: Theme;
  width: number;
  shown?: Shown;
  active?: boolean;
}) {
  const view = typedView(slide, shown, theme);
  return (
    <span className="relative block" data-live-thumb>
      <SlideStatic slide={view.slide} theme={theme} width={width} />
      <BlankLayer blanks={view.blanks} theme={theme} active={active} />
    </span>
  );
}

/** A slide not reached yet: the thumb's box in the theme's background with two quiet bars. */
export function ThemedSkeleton({
  theme,
  width,
  active = false,
}: {
  theme: Theme;
  width: number;
  active?: boolean;
}) {
  const tone = { backgroundColor: `color-mix(in srgb, ${theme.colors.ink} 9%, transparent)` };
  const still = active ? undefined : "motion-safe:animate-none";
  return (
    <span
      className="relative block aspect-video overflow-hidden"
      style={{ width, backgroundColor: theme.colors.background }}
      data-live-skeleton
    >
      <Skeleton
        className={cn("absolute top-[18%] left-[8%] h-[11%] w-[58%]", still)}
        style={tone}
      />
      <Skeleton className={cn("absolute top-[40%] left-[8%] h-[7%] w-[80%]", still)} style={tone} />
      <Skeleton className={cn("absolute top-[54%] left-[8%] h-[7%] w-[70%]", still)} style={tone} />
    </span>
  );
}

/** Wraps a canvas slide so its blanks sit over it at the same scale; boxes glide, never jump. */
export function LiveFrame({
  blanks,
  theme,
  className,
  children,
  active = true,
}: {
  blanks: Box[];
  theme: Theme;
  className?: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative [&_img]:motion-safe:animate-arrive",
        "[&_[data-element-id]]:motion-safe:transition-[left,top,width,height] [&_[data-element-id]]:duration-300",
        className,
      )}
      data-live-frame
    >
      {children}
      <BlankLayer blanks={blanks} theme={theme} active={active} />
    </div>
  );
}

/**
 * The reveal that fills Sol's thinking time (ruling 138): the title types over about 1–4 s after
 * generate, then the objectives slide over about 4–10 s, one objective after another. Times are
 * from when the editor mounts (about 0.5 s after the click).
 */
const PACE = [
  { from: 400, ms: 3000 },
  { from: 3500, ms: 6000 },
] as const;

/**
 * How many characters of slide 1 and slide 2 to show, and which of them is on the canvas. Real
 * content is never held back: once `done` (the first streamed slide is here) everything shows.
 */
export function usePacedIntro(
  slides: readonly Slide[],
  done: boolean,
): { chars: (index: number) => number; phase: 0 | 1 | null; finished: boolean } {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  const lengths = slides.slice(0, 2).map((s) => docTexts(s).reduce((n, t) => n + t.length, 0));
  const elapsed = now - start;
  const finished = done || elapsed > PACE[1].from + PACE[1].ms + 400;
  useEffect(() => {
    if (finished) return;
    const timer = window.setInterval(() => setNow(Date.now()), 40);
    return () => window.clearInterval(timer);
  }, [finished]);
  return {
    chars: (index) => {
      const pace = PACE[index];
      const total = lengths[index];
      if (finished || !pace || total === undefined) return Number.POSITIVE_INFINITY;
      const t = Math.min(1, Math.max(0, (elapsed - pace.from) / pace.ms));
      return total * t;
    },
    phase: finished ? null : elapsed < PACE[1].from || slides.length < 2 ? 0 : 1,
    finished,
  };
}

/** A navigator row for a slide not saved yet: typed, a shaped skeleton, or a plain skeleton. */
export function LiveSlot({
  position,
  slide,
  theme,
  width,
  shown,
  active,
}: {
  position: number;
  slide: Slide | undefined;
  theme: Theme;
  width: number;
  shown: Shown;
  /** The slide about to be written: its skeleton is the one that shimmers. */
  active?: boolean;
}) {
  return (
    <li
      aria-hidden="true"
      data-live-slot={position}
      data-live-state={slide && isWritten(slide) ? "writing" : slide ? "shaped" : "waiting"}
      data-live-active={active || undefined}
      className="flex w-full items-center px-1 py-0.5"
    >
      <span className="w-[18px] shrink-0 pr-1 text-right text-meta text-ink-3 tabular-nums">
        {position + 1}
      </span>
      <span
        className={cn(
          "block shrink-0 overflow-hidden rounded-chip ring-1 transition-shadow duration-300",
          active ? "ring-primary" : "ring-border",
        )}
      >
        {slide ? (
          <LiveThumb slide={slide} theme={theme} width={width} shown={shown} active={active} />
        ) : (
          <ThemedSkeleton theme={theme} width={width} active={active} />
        )}
      </span>
    </li>
  );
}

type Leaf = { text?: string; content?: Leaf[] };
const leaves = (node: Leaf): Leaf[] =>
  typeof node.text === "string" ? [node] : (node.content ?? []).flatMap(leaves);

/** The doc with its lines replaced in order, keeping its paragraphs, lists and marks. */
function withLines(doc: unknown, text: string): unknown {
  const copy = structuredClone(doc) as Leaf;
  const ls = leaves(copy);
  const lines = text.split("\n");
  ls.forEach((leaf, i) => {
    leaf.text = i === ls.length - 1 ? lines.slice(i).join(" ") : (lines[i] ?? "");
  });
  return copy;
}

/**
 * A finished slide the teacher can edit while the rest are written: a click on a text opens it in
 * place; leaving it saves the slide with that element marked as the teacher's.
 */
export function EditableSlide({
  slide,
  theme,
  onSave,
}: {
  slide: Slide;
  theme: Theme;
  onSave: (slide: Slide) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const view = liveView(slide, undefined, theme);
  const texts = slide.elements.filter((e) => e.type === "text");
  const box = (e: { x: number; y: number; w: number; h: number }) => ({
    left: `${(e.x / SLIDE_W) * 100}%`,
    top: `${(e.y / SLIDE_H) * 100}%`,
    width: `${(e.w / SLIDE_W) * 100}%`,
    height: `${(e.h / SLIDE_H) * 100}%`,
  });
  const save = () => {
    const el = texts.find((e) => e.id === open);
    setOpen(null);
    if (el?.type !== "text") return;
    const before = leaves(el.doc as unknown as Leaf)
      .map((l) => l.text)
      .join("\n");
    if (draft === before) return;
    const next = {
      ...slide,
      elements: slide.elements.map((e) =>
        e.id === el.id
          ? ({ ...e, doc: withLines(el.doc, draft), authoredBy: "teacher" } as unknown as El)
          : e,
      ),
    };
    onSave(next);
  };
  return (
    <LiveFrame blanks={view.blanks} theme={theme}>
      <SlideView slide={view.slide} theme={theme} mode="view" />
      <div className="pointer-events-auto absolute inset-0 z-10" data-live-editable>
        {texts.map((e) =>
          open === e.id ? (
            <textarea
              key={e.id}
              // biome-ignore lint/a11y/noAutofocus: the teacher just clicked this text to edit it
              autoFocus
              aria-label="Edit text"
              className="absolute resize-none rounded-sm bg-card p-1 text-[1.4em] text-foreground shadow-focus outline-none"
              style={box(e)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(null);
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
              }}
            />
          ) : (
            <button
              key={e.id}
              type="button"
              aria-label="Edit this text"
              data-live-edit={e.id}
              className="absolute cursor-text rounded-sm hover:ring-2 hover:ring-primary"
              style={box(e)}
              onClick={() => {
                setDraft(
                  leaves(e.doc as unknown as Leaf)
                    .map((l) => l.text)
                    .join("\n"),
                );
                setOpen(e.id);
              }}
            />
          ),
        )}
      </div>
    </LiveFrame>
  );
}

/** Live writing: save the teacher's edit of one finished slide while the job holds the lesson. */
export async function saveLiveSlide(lessonId: string, slide: Slide): Promise<void> {
  const res = await fetch(`${env.VITE_API_URL}/documents/${lessonId}/live-slides/${slide.id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slide }),
  });
  if (!res.ok) console.warn("live writing: the slide edit was not saved", res.status);
}
