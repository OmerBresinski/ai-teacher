/**
 * FIX1 (6 Oct 2026): short content sits balanced in its zone, at the deck's one type size (no
 * stretching). Run on a fitted slide; it only moves boxes within the room they already had, so it
 * never makes a slide overflow.
 *
 * - A speech bubble holds its prompt: the bubble is sized to the prompt (its tail kept clear of
 *   the talk line under it), the prompt stepped down a stop only when it cannot fit at its size.
 * - A card behind text (the key-idea side panel) hugs its words instead of running to the foot.
 * - Lists are not centred: a list starts under the heading at its normal spacing on every slide,
 *   so a short one sits at the same top as a long one (coordinator ruling, FIX1 round 2).
 */
import type { Slide, SlideElement, TextElement, Theme } from "@tj/domain/documents";
import { SAFE, SPACE } from "./grid";
import { HEADING_NAME } from "./reflow";
import { measureHeadless } from "./text-measure";

type Box = { x: number; y: number; w: number; h: number };
const BOTTOM = SAFE.y + SAFE.h;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;

export const SPEECH_BUBBLE_NAME = "Speech bubble";
export const SIDE_PANEL_NAME = "Side panel";
/** The tail a speech bubble draws under its body (`discussionSlide` in layouts.ts). */
const TAIL = SPACE[5];

function bubble(slide: Slide, theme: Theme): Slide {
  const b = slide.elements.find((e) => e.name === SPEECH_BUBBLE_NAME);
  if (!b) return slide;
  const prompt = slide.elements.find(
    (e): e is TextElement => e.type === "text" && overlaps(e, b) && e.y < b.y + b.h - TAIL,
  );
  if (!prompt) return slide;
  const below = slide.elements.filter(
    (e) => e !== b && e !== prompt && e.type === "text" && e.y >= prompt.y + prompt.h - 1,
  );
  const pad = prompt.y - b.y;
  const heading = slide.elements.find((e) => e.name === HEADING_NAME);
  const top = heading ? heading.y + heading.h + SPACE[4] : SAFE.y;
  const foot = below.length ? Math.min(...below.map((e) => e.y)) - SPACE[3] : BOTTOM;
  const room = foot - top;
  const measure = measureHeadless(theme);
  const heightAt = (fontSize?: number) =>
    measure({
      doc: prompt.doc,
      width: prompt.w,
      style: prompt.style,
      preset: prompt.style?.preset ?? "subtitle",
      ...(fontSize ? { fontSize } : {}),
      inset: 0,
      chrome: 0,
    });
  let style = prompt.style;
  let h = heightAt();
  if (h + 2 * pad + TAIL > room) {
    // One stop down the theme's ladder, then the next, never under the heading stop.
    for (const size of [theme.sizes.subtitle, theme.sizes.heading]) {
      if (size >= (prompt.style?.fontSize ?? theme.sizes[prompt.style?.preset ?? "subtitle"]))
        continue;
      style = { ...prompt.style, fontSize: size };
      h = heightAt(size);
      if (h + 2 * pad + TAIL <= room) break;
    }
  }
  const bh = Math.min(room, h + 2 * pad + TAIL);
  const by = Math.round(top + Math.max(0, (room - bh) / 2));
  return {
    ...slide,
    elements: slide.elements.map((e) =>
      e === b
        ? { ...b, y: by, h: bh }
        : e === prompt
          ? ({ ...prompt, style, y: by + pad, h } as TextElement)
          : e,
    ),
  };
}

function hugPanels(els: SlideElement[]): SlideElement[] {
  let out = els;
  for (const panel of els.filter((e) => e.name === SIDE_PANEL_NAME)) {
    const inner = out.filter((e) => e !== panel && e.type === "text" && inside(e, panel));
    if (inner.length === 0) continue;
    const pad = Math.min(...inner.map((e) => e.x)) - panel.x;
    const y0 = Math.min(...inner.map((e) => e.y));
    const y1 = Math.max(...inner.map((e) => e.y + e.h));
    const h = Math.round(y1 - y0 + 2 * pad);
    if (h >= panel.h) continue;
    const dy = panel.y - (y0 - pad);
    out = out.map((e) =>
      e === panel ? { ...panel, h } : inner.includes(e) ? { ...e, y: e.y + dy } : e,
    );
  }
  return out;
}

/** The slide with its bubble fitted and its cards hugging their words. */
export function balanceSlide(slide: Slide, theme: Theme): Slide {
  if (slide.kind === "title") return slide;
  const b = bubble(slide, theme);
  if (b !== slide) return b;
  if (slide.kind !== "content" && slide.kind !== "objectives") return slide;
  return { ...slide, elements: hugPanels(slide.elements) };
}
