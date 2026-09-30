import { SLIDE_H, SLIDE_W, type Slide } from "@tj/domain/documents";
import { type JobEvent, LIVE_BLANK, LIVE_PENDING } from "@tj/domain/jobs";
import type { getTheme } from "@tj/editor";
import { SlideView } from "@tj/editor";
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

const DIAGRAM_SLOT = "Diagram placeholder";

/** A saved slide the stream has written, not a `LIVE_PENDING` place holder. */
export const isWritten = (slide: Slide): boolean => !slide.id.startsWith(LIVE_PENDING);

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
  const walk = (el: El): El | undefined => {
    // An open diagram slot is a picture zone until the diagram is drawn; taken out here, so the
    // view keeps the words where the slot leaves them rather than laying them out again.
    if (el.name === DIAGRAM_SLOT) {
      blanks.push({ x: el.x, y: el.y, w: el.w, h: el.h, kind: "picture" });
      return undefined;
    }
    // Text boxes and shapes with words (answer cards) alike: blanks are cut, and a box with no
    // written word yet is a skeleton bar.
    const withDoc = el as El & { doc?: unknown };
    if (withDoc.doc && typeof withDoc.doc === "object") {
      const doc = withDoc.doc as Node;
      const raw = textOf(doc);
      const written = raw.replace(BLANK_RUN, "").trim();
      if (raw.includes(LIVE_BLANK) && written === "") {
        const inset = el.type === "text" ? 0 : Math.min(56, el.w * 0.12);
        blanks.push({ x: el.x + inset, y: el.y, w: el.w - inset * 1.5, h: el.h, kind: "text" });
      }
      return { ...el, doc: cutDoc(doc, budget) } as unknown as El;
    }
    if (el.type === "image") {
      if (isPlaceholderPhoto(el.src)) {
        blanks.push({ x: el.x, y: el.y, w: el.w, h: el.h, kind: "picture" });
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

/**
 * The reveal that fills Sol's thinking time (ruling 138): the title types over about 1–4 s after
 * generate, then the objectives slide over about 4–10 s, one objective after another. Times are
 * from when the editor mounts (about 0.7 s after the click).
 */
const PACE = [
  { from: 300, ms: 3000 },
  { from: 3300, ms: 6000 },
] as const;

/**
 * How many characters of slide 1 and slide 2 to show, and which of them is on the canvas. Real
 * content is never held back: once `done` (the first streamed slide is here) everything shows.
 */
export function usePacedIntro(
  slides: readonly Slide[],
  done: boolean,
): { chars: (index: number) => number; phase: 0 | 1 | null } {
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
  const elapsed = now - start;
  const finished = done || elapsed > PACE[1].from + PACE[1].ms + 400;
  useEffect(() => {
    if (finished) return;
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [finished]);
  return {
    chars: (index) => {
      const pace = PACE[index];
      const total = lengths[index];
      if (finished || !pace || total === undefined) return Number.POSITIVE_INFINITY;
      const t = Math.min(1, Math.max(0, (elapsed - pace.from) / pace.ms));
      return Math.round(total * t);
    },
    phase: done ? null : elapsed < PACE[1].from || slides.length < 2 ? 0 : 1,
  };
}

/** A navigator row for a slide not saved yet: its live copy, its place holder, or a skeleton. */
export function LiveSlot({
  position,
  slide,
  theme,
  width,
}: {
  position: number;
  slide: Slide | undefined;
  theme: Theme;
  width: number;
}) {
  return (
    <li
      aria-hidden="true"
      data-live-slot={position}
      data-live-state={slide && isWritten(slide) ? "writing" : slide ? "shaped" : "waiting"}
      className="flex w-full items-center px-1 py-0.5"
    >
      <span className="w-[18px] shrink-0 pr-1 text-right text-meta text-ink-3 tabular-nums">
        {position + 1}
      </span>
      {slide ? (
        <span className="block shrink-0 overflow-hidden rounded-chip ring-1 ring-border motion-safe:animate-arrive">
          <LiveThumb slide={slide} theme={theme} width={width} />
        </span>
      ) : (
        <ThemedSkeleton theme={theme} width={width} />
      )}
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
  const view = liveView(slide);
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
