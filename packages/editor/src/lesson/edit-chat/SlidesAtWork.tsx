import { SLIDE_W, type Slide, type Theme } from "@tj/domain/documents";
import { useCallback, useMemo, useRef } from "react";
import { SlideStatic } from "../../slide/SlideStatic";
import { type FrameInfo, SlidesActor } from "./cast/SlidesActor";
import type { CastState } from "./cast/slides";
import { inkAt } from "./cast/slides";

/*
 * The top of the open "Edit with Dayback" pane (TEACH-97): Slides at 112 px beside a miniature of
 * the slide being edited (the real slide, drawn by `SlideStatic`). While working, Slides touches
 * it up with its pencil: one text line at a time is covered as the pencil pulls back, then redrawn
 * left to right as it sweeps. Done: a nod, and the miniature settles. Failed or stopped: a
 * sheepish pose; the miniature is left as it is (nothing changed).
 *
 * The miniature's lines follow the cast clock (`onFrame`), written straight into the DOM: no
 * React render per frame.
 */

const MINI = 200;
const LINE = 44; // slide units: about one line of body text

export type Band = { x: number; y: number; w: number; h: number };
/** The text lines of a slide, top to bottom, at most six, in miniature pixels. */
export function bandsOf(slide: Slide | undefined, width = MINI): Band[] {
  if (!slide) return [];
  const k = width / SLIDE_W;
  const out: Band[] = [];
  const texts = slide.elements
    .filter((e) => e.type === "text")
    .slice()
    .sort((a, b) => a.y - b.y);
  for (const e of texts) {
    const lines = Math.max(1, Math.min(4, Math.round(e.h / LINE)));
    const h = e.h / lines;
    for (let i = 0; i < lines; i++)
      out.push({ x: e.x * k, y: (e.y + i * h) * k, w: e.w * k, h: h * k });
  }
  return out.slice(0, 6);
}

export function SlidesAtWork({
  state,
  slide,
  theme,
}: {
  state: CastState;
  slide: Slide | undefined;
  theme: Theme;
}) {
  const bands = useMemo(() => bandsOf(slide), [slide]);
  const covers = useRef<(HTMLSpanElement | null)[]>([]);
  const mini = useRef<HTMLDivElement | null>(null);
  const settled = useRef(true);
  const onFrame = useCallback(
    ({ clip, t }: FrameInfo) => {
      const n = bands.length;
      const ink = clip === "touchUp" && n > 0 ? inkAt(t) : null;
      covers.current.forEach((el, i) => {
        if (!el) return;
        const on = ink && ink.pass % n === i && ink.wipe < 1;
        el.style.opacity = on ? String(ink.cover) : "0";
        // Uncovered from the left: the cover's left edge moves right with the pencil.
        el.style.transform = on ? `scaleX(${1 - ink.wipe})` : "scaleX(0)";
      });
      // Done: the miniature settles, a 2 px drop that comes back once.
      const box = mini.current;
      if (!box) return;
      if (clip === "nod") {
        settled.current = false;
        const u = Math.min(1, t / 520);
        const y = u < 0.35 ? (u / 0.35) * 2 : 2 * (1 - (u - 0.35) / 0.65) ** 2;
        box.style.transform = `translateY(${y.toFixed(2)}px)`;
      } else if (!settled.current) {
        settled.current = true;
        box.style.transform = "";
      }
    },
    [bands],
  );
  return (
    <div
      data-edit-chat-cast={state}
      aria-hidden="true"
      className="flex shrink-0 items-center gap-4 border-border border-b px-3 py-3"
    >
      <SlidesActor
        context="pane"
        state={state}
        onFrame={onFrame}
        className="h-[100px] w-[112px] shrink-0 text-foreground"
      />
      <div
        ref={mini}
        className="relative overflow-hidden rounded-[6px] shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_2px_6px_rgb(0_0_0/0.08)]"
        style={{ width: MINI }}
      >
        {slide ? (
          <SlideStatic slide={slide} theme={theme} width={MINI} />
        ) : (
          <div style={{ height: (MINI * 9) / 16, background: theme.colors.background }} />
        )}
        {bands.map((b, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: bands are positional
            key={i}
            ref={(el) => {
              covers.current[i] = el;
            }}
            data-edit-chat-ink
            className="pointer-events-none absolute"
            style={{
              left: b.x - 1,
              top: b.y - 1.5,
              width: b.w + 2,
              height: b.h + 3,
              background: theme.colors.background,
              opacity: 0,
              transform: "scaleX(0)",
              transformOrigin: "right center",
            }}
          />
        ))}
      </div>
    </div>
  );
}
