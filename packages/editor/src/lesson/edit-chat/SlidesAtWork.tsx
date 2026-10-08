import { SLIDE_W, type Slide, type Theme } from "@tj/domain/documents";
import { useCallback, useMemo, useRef } from "react";
import { SlideStatic } from "../../slide/SlideStatic";
import { type FrameInfo, SlidesActor } from "./cast/SlidesActor";
import type { CastState } from "./cast/slides";
import { inkAt } from "./cast/slides";

/*
 * The top of the open "Edit with Dayback" pane (TEACH-97): Slides at 112 px leaning on the edge
 * of a miniature of the slide being edited (the real slide with its pictures, `SlideStatic`).
 * While working, its pencil travels to one text line at a time and touches it, and a soft
 * highlight with a light shimmer sweeps along that line with the pencil. The slide's own text is
 * never hidden. Done: a nod, and the miniature settles. Failed or stopped: a sheepish pose; the
 * miniature is left as it is (nothing changed).
 *
 * The highlight and the pencil's target follow the cast clock, written straight into the DOM: no
 * React render per frame.
 */

const MINI = 236;
/** Where Slides stands: its 112 x 100 box, bottom-aligned with the miniature, which starts at
 * `MINI_LEFT` so Slides' raised hand overlaps its edge. */
const ACTOR = { w: 112, h: 100 } as const;
const MINI_LEFT = 100;
const MINI_H = (MINI * 9) / 16;
const ACTOR_TOP = MINI_H - ACTOR.h + 6;
/** px in the row -> Slides' art units (its view is 10 40 280 250 drawn at 0.4 px a unit). */
const toArt = (x: number, y: number) => ({ x: x / 0.4 + 10, y: (y - ACTOR_TOP) / 0.4 + 40 });
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
  const glows = useRef<(HTMLSpanElement | null)[]>([]);
  const shimmer = useRef<HTMLSpanElement | null>(null);
  const mini = useRef<HTMLDivElement | null>(null);
  const settled = useRef(true);
  const reach = useCallback(
    ({ clip, t }: FrameInfo) => {
      const n = bands.length;
      if (clip !== "touchUp" || n === 0) return null;
      const ink = inkAt(t);
      const band = (pass: number) => bands[((pass % n) + n) % n] as Band;
      const at = (b: Band, along: number, lift: number) =>
        toArt(MINI_LEFT + b.x + 4 + Math.min(b.w - 8, 56) * along, b.y + b.h * 0.62 - lift);
      const local = t % 700;
      const now = band(ink.pass);
      if (t % 2400 >= 2100) return at(band(ink.pass), 1, 8);
      // The approach: from the end of the last line (lifted) to the start of this one.
      if (local < 120) {
        const from = at(band(ink.pass - 1), 1, 8);
        const to = at(now, 0, 0);
        const u = local / 120;
        const e = u * u * (3 - 2 * u);
        return {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * u) * 10,
        };
      }
      if (local < 560) return at(now, ink.wipe, 0);
      return at(now, 1, ((local - 560) / 140) * 8);
    },
    [bands],
  );
  const onFrame = useCallback(
    ({ clip, t }: FrameInfo) => {
      const n = bands.length;
      const ink = clip === "touchUp" && n > 0 ? inkAt(t) : null;
      const local = t % 700;
      glows.current.forEach((el, i) => {
        if (!el) return;
        const current = ink !== null && ink.pass % n === i && ink.cover > 0 && t % 2400 < 2100;
        const last = ink !== null && (ink.pass - 1 + n) % n === i && !current && local < 420;
        const opacity = current
          ? ink.cover
          : last
            ? 1 - local / 420
            : ink && t % 2400 >= 2100 && ink.pass % n === i
              ? 1 - ((t % 2400) - 2100) / 300
              : 0;
        el.style.opacity = String(Math.max(0, opacity));
        el.style.transform = `scaleX(${current ? Math.max(0.02, ink.wipe) : 1})`;
      });
      const sh = shimmer.current;
      if (sh) {
        const b = ink && t % 2400 < 2100 ? bands[ink.pass % n] : undefined;
        if (b && ink && ink.wipe > 0 && ink.wipe < 1) {
          sh.style.opacity = "1";
          sh.style.left = `${b.x + b.w * ink.wipe - 9}px`;
          sh.style.top = `${b.y}px`;
          sh.style.height = `${b.h}px`;
        } else sh.style.opacity = "0";
      }
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
      className="shrink-0 border-border border-b px-3 py-3"
    >
      <div className="relative" style={{ height: MINI_H + 6 }}>
        <div
          ref={mini}
          className="absolute top-0 overflow-hidden rounded-[6px] shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_2px_6px_rgb(0_0_0/0.08)]"
          style={{ left: MINI_LEFT, width: MINI }}
        >
          {slide ? (
            <SlideStatic slide={slide} theme={theme} width={MINI} />
          ) : (
            <div style={{ height: MINI_H, background: theme.colors.background }} />
          )}
          {bands.map((b, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: bands are positional
              key={i}
              ref={(el) => {
                glows.current[i] = el;
              }}
              data-edit-chat-ink
              className="pointer-events-none absolute rounded-[2px] bg-[#f5c054]/35 mix-blend-multiply"
              style={{
                left: b.x - 1,
                top: b.y,
                width: b.w + 2,
                height: b.h,
                opacity: 0,
                transformOrigin: "left center",
              }}
            />
          ))}
          <span
            ref={shimmer}
            className="pointer-events-none absolute w-[18px] bg-gradient-to-r from-transparent via-white/80 to-transparent"
            style={{ opacity: 0 }}
          />
        </div>
        <SlidesActor
          context="pane"
          state={state}
          onFrame={onFrame}
          reach={reach}
          className="absolute left-0 text-foreground"
          style={{ top: ACTOR_TOP, width: ACTOR.w, height: ACTOR.h }}
        />
      </div>
    </div>
  );
}
