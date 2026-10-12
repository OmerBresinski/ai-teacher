/**
 * Full-bleed hook (UX ruling 203, Chalkie layout parity P5; TEACH-75 part l): the photo
 * across the whole slide under a dark scrim, and the heading plus up to about 40 words centred in
 * white. Copied from the Chalkie heart deck's slide 2.
 *
 * - Colours are theme tokens (`hookStyle`): the words in the theme's lightest token, the scrim its
 *   darkest token tinted with the accent, at an opacity that keeps the words at 4.5:1 or better even
 *   over the brightest pixel (`hookContrast`, `contrastRatio` from look.ts, tested on every theme).
 * - The photo covers the slide, cropped round its must-see subjects (`placePhoto`). A photo that
 *   cannot fill the slide without cutting a subject blind is shown whole, centred on the scrim's
 *   colour, so nothing is cut and the slide is still the picture.
 * - Fit on arrival (P6): the words step down to the body's small size when they do not fit, and are
 *   reported in `over` past that. A hook whose picture failed is laid as a discussion prompt (the
 *   caller), never an empty dark slide.
 */
import type { Theme } from "@tj/domain/documents";
import { uid } from "../factories";
import { contrastRatio } from "../look";
import { type Ctx, kit, mix, placePhoto, type TemplateInput } from "./index";

export const HOOK_NAMES = { photo: "Hook photo", scrim: "Scrim" } as const;
/**
 * The brightest pixel a photo can have under the scrim: the worst case the words are checked
 * against. It is never drawn; the slide's colours are all theme tokens.
 */
export const BRIGHTEST_PIXEL = "#ffffff";
/** The contrast the words keep over the scrim, over the brightest pixel. */
export const HOOK_CONTRAST = 4.5;
const SLIDE = { w: 960, h: 540 } as const;
const TEXT_W = 800;

export type HookStyle = { scrim: string; opacity: number; text: string };
/**
 * The hook's colours from the theme's tokens: the words in the theme's lightest token, the scrim
 * its darkest token tinted with the accent, at the lightest opacity (from Chalkie's 60%) that keeps
 * the words at 4.5:1 over the brightest pixel (`contrastRatio`, look.ts).
 */
export function hookStyle(t: Theme): HookStyle {
  const c = t.colors;
  const tokens = [c.ink, c.background, c.surface, c.onAccent, c.accent];
  const byLight = [...tokens].sort(
    (a, b) => contrastRatio(a, BRIGHTEST_PIXEL) - contrastRatio(b, BRIGHTEST_PIXEL),
  );
  const text = byLight[0] as string;
  const dark = byLight[byLight.length - 1] as string;
  const scrim = mix(c.accent, dark, 0.16);
  const seen = (k: number) => contrastRatio(text, mix(scrim, BRIGHTEST_PIXEL, k));
  let opacity = 0.6;
  while (opacity < 0.95 && seen(opacity) < HOOK_CONTRAST)
    opacity = Math.round((opacity + 0.02) * 100) / 100;
  return { scrim, opacity, text };
}

/** The words' contrast on the scrim at its worst: over the brightest pixel. */
export const hookContrast = (t: Theme): number => {
  const s = hookStyle(t);
  return contrastRatio(s.text, mix(s.scrim, BRIGHTEST_PIXEL, s.opacity));
};

/** A hook needs a photo (placed, or an open slot while it is being found). */
export const hookOk = (input: TemplateInput) => !!input.figure && "photo" in input.figure;

/** Not a hook after all: the words as a discussion prompt. */
export function asPrompt(input: TemplateInput): TemplateInput {
  return { template: "discussion", heading: input.heading, lead: input.lead ?? "" };
}

export function layoutHook(c: Ctx, input: TemplateInput) {
  const f = input.figure;
  if (!f || !("photo" in f)) return;
  const style = hookStyle(c.t);
  const scrim = style.scrim;
  const page = { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h };
  const covers =
    !f.photo || !f.aspect || placePhoto(f.aspect, SLIDE.w / SLIDE.h, f.subjects).mode === "cover";
  if (!covers) kit.box(c, page, scrim, { shape: "rect", radius: 0, name: "Ground" });
  kit.photoBox(c, f, page, covers);
  const photo = c.els[c.els.length - 1];
  if (photo && photo.type === "image") {
    photo.name = HOOK_NAMES.photo;
    photo.radius = 0;
  }
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rect",
    ...page,
    fill: scrim,
    opacity: style.opacity,
    name: HOOK_NAMES.scrim,
  });

  const full = c.s;
  const lead = input.lead?.trim() ?? "";
  const x = Math.round((SLIDE.w - TEXT_W) / 2);
  const room = SLIDE.h - 2 * 48;
  const height = () => {
    const head = input.heading.trim() ? kit.measure(c, input.heading, "heading", TEXT_W) : 0;
    const body = lead ? kit.measure(c, lead, "body", TEXT_W) : 0;
    const gap = head && body ? Math.round(c.s.body * 1.1) : 0;
    return { head, body, gap, total: head + gap + body };
  };
  let m = height();
  if (m.total > room && !c.fullSize) {
    c.s = { ...full, body: full.small, lead: full.small };
    m = height();
  }
  if (m.total > room) c.over.push(`hook ${m.total}/${room}pt`);
  let y = Math.max(48, Math.round((SLIDE.h - m.total) / 2));
  if (m.head) {
    kit.text(
      c,
      input.heading,
      "heading",
      { x, y, w: TEXT_W },
      { color: style.text, align: "center", name: "Heading" },
    );
    y += m.head + m.gap;
  }
  if (lead)
    kit.text(
      c,
      lead,
      "body",
      { x, y, w: TEXT_W },
      { color: style.text, align: "center", name: "Lead" },
    );
  c.s = full;
  // The words are centred on the photo, not in the band under a heading (ruling 198 does not move them).
  c.bodyFromHeading = true;
}
