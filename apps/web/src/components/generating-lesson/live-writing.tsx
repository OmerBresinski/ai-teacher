import { SLIDE_H, SLIDE_W, type Slide } from "@tj/domain/documents";
import { type JobEvent, LIVE_BLANK } from "@tj/domain/jobs";
import type { getTheme } from "@tj/editor";
import { SlideStatic } from "@tj/editor/thumb";
import { cn, Skeleton } from "@tj/ui";
import { type ReactNode, useEffect, useState } from "react";
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

type Box = { x: number; y: number; w: number; h: number; kind: "text" | "picture" };
type Node = { text?: string; content?: Node[]; [k: string]: unknown };

const BLANK_RUN = new RegExp(`${LIVE_BLANK}+`, "g");
const PLACEHOLDER_FILL = "%23E9E8E3";
const isPlaceholderPhoto = (src: string) =>
  src.startsWith("data:image/svg+xml") && src.includes(PLACEHOLDER_FILL);

function textOf(node: Node): string {
  return (node.text ?? "") + (node.content ?? []).map(textOf).join("");
}

/** The doc with every blank run removed and the words cut to `limit` characters (typing). */
function cutDoc(node: Node, budget: { left: number }): Node {
  if (typeof node.text === "string") {
    const clean = node.text.replace(BLANK_RUN, "").replace(/\s{2,}/g, " ");
    const kept = clean.slice(0, Math.max(0, budget.left));
    budget.left -= kept.length;
    return { ...node, text: kept };
  }
  if (!node.content) return node;
  return {
    ...node,
    content: node.content.map((c) => cutDoc(c, budget)).filter((c) => c.text !== ""),
  };
}

type El = Slide["elements"][number];

/**
 * The slide as it can be shown now and the boxes still to be written. `chars` cuts every text to
 * that many characters (the paced title and objectives); unset shows every written word.
 */
export function liveView(slide: Slide, chars?: number): { slide: Slide; blanks: Box[] } {
  const blanks: Box[] = [];
  // One budget for the whole slide, so the texts type one after another in reading order.
  const budget = { left: chars ?? Number.POSITIVE_INFINITY };
  const walk = (el: El): El => {
    if (el.type === "text") {
      const doc = el.doc as unknown as Node;
      const raw = textOf(doc);
      const written = raw.replace(BLANK_RUN, "").trim();
      if (raw.includes(LIVE_BLANK) && written === "") {
        blanks.push({ x: el.x, y: el.y, w: el.w, h: el.h, kind: "text" });
      }
      return { ...el, doc: cutDoc(doc, budget) as unknown as typeof el.doc };
    }
    if (el.type === "image") {
      if (isPlaceholderPhoto(el.src)) {
        blanks.push({ x: el.x, y: el.y, w: el.w, h: el.h, kind: "picture" });
        return el;
      }
      // A new id when the photo lands, so its view mounts again and fades in.
      return { ...el, id: `${el.id}~${el.src.length}` };
    }
    if (el.type === "group") {
      return { ...el, children: el.children.map((c) => walk(c as El)) } as El;
    }
    return el;
  };
  return { slide: { ...slide, elements: slide.elements.map(walk) }, blanks };
}

/** Skeleton bars and picture zones over the slide, in the theme's ink, at the elements' boxes. */
export function BlankLayer({ blanks, theme }: { blanks: Box[]; theme: Theme }) {
  const tone = { backgroundColor: `color-mix(in srgb, ${theme.colors.ink} 12%, transparent)` };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-live-blanks>
      {blanks.map((b) => {
        const style = {
          left: `${(b.x / SLIDE_W) * 100}%`,
          top: `${(b.y / SLIDE_H) * 100}%`,
          width: `${(b.w / SLIDE_W) * 100}%`,
          height: `${(b.h / SLIDE_H) * 100}%`,
        };
        if (b.kind === "picture") {
          return (
            <Skeleton
              key={`${b.x}-${b.y}`}
              className="absolute rounded-[3%]"
              style={{ ...style, ...tone }}
            />
          );
        }
        const lines = Math.max(1, Math.min(4, Math.round(b.h / 44)));
        return (
          <div
            key={`${b.x}-${b.y}`}
            className="absolute flex flex-col justify-center gap-[12%]"
            style={style}
          >
            {Array.from({ length: lines }, (_, i) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars, never reordered
                key={i}
                className="rounded-full"
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

/** A live or typing slide in the navigator: the thumb with its blanks. */
export function LiveThumb({
  slide,
  theme,
  width,
  chars,
}: {
  slide: Slide;
  theme: Theme;
  width: number;
  chars?: number;
}) {
  const view = liveView(slide, chars);
  return (
    <span className="relative block" data-live-thumb>
      <SlideStatic slide={view.slide} theme={theme} width={width} />
      <BlankLayer blanks={view.blanks} theme={theme} />
    </span>
  );
}

/** A slide not reached yet: the thumb's box in the theme's background with two quiet bars. */
export function ThemedSkeleton({ theme, width }: { theme: Theme; width: number }) {
  const tone = { backgroundColor: `color-mix(in srgb, ${theme.colors.ink} 9%, transparent)` };
  return (
    <span
      className="relative block aspect-video overflow-hidden rounded-chip ring-1 ring-border"
      style={{ width, backgroundColor: theme.colors.background }}
      data-live-skeleton
    >
      <Skeleton className="absolute top-[18%] left-[8%] h-[11%] w-[58%]" style={tone} />
      <Skeleton className="absolute top-[40%] left-[8%] h-[7%] w-[80%]" style={tone} />
      <Skeleton className="absolute top-[54%] left-[8%] h-[7%] w-[70%]" style={tone} />
    </span>
  );
}

/** Wraps a canvas slide so its blanks sit over it at the same scale. */
export function LiveFrame({
  blanks,
  theme,
  className,
  children,
}: {
  blanks: Box[];
  theme: Theme;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative [&_img]:motion-safe:animate-arrive", className)} data-live-frame>
      {children}
      <BlankLayer blanks={blanks} theme={theme} />
    </div>
  );
}

/** Title over the first 3 s, objectives over the next 7 s: the typing while Sol thinks. */
const PACE = [
  { from: 0, ms: 3000 },
  { from: 2500, ms: 7000 },
] as const;

/**
 * How many characters of slide 1 and slide 2 to show, from when each landed. Real content is
 * never held back: once `done` (the first streamed slide is here) the whole text shows.
 */
export function usePacedIntro(slides: readonly Slide[], done: boolean): (index: number) => number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  const lengths = slides
    .slice(0, 2)
    .map((s) =>
      s.elements.reduce(
        (n, el) => n + (el.type === "text" ? textOf(el.doc as unknown as Node).length : 0),
        0,
      ),
    );
  const finished = done || now - start > PACE[1].from + PACE[1].ms;
  useEffect(() => {
    if (finished) return;
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [finished]);
  return (index) => {
    const pace = PACE[index];
    const total = lengths[index];
    if (finished || !pace || total === undefined) return Number.POSITIVE_INFINITY;
    const t = Math.min(1, Math.max(0, (now - start - pace.from) / pace.ms));
    return Math.round(total * t);
  };
}
