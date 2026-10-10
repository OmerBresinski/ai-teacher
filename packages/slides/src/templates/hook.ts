/**
 * Full-bleed hook (UX ruling 203, Chalkie layout parity P5; TEACH-75 part l): the photo
 * across the whole slide under a dark scrim, and the heading plus up to about 40 words centred in
 * white. Copied from the Chalkie heart deck's slide 2.
 *
 * - The scrim is theme-aware: the theme's accent sunk almost to black (`hookScrim`), at an opacity
 *   that keeps white text at 4.5:1 or better even over a pure white pixel (`hookContrast`, tested
 *   on every theme).
 * - The photo covers the slide, cropped round its must-see subjects (`placePhoto`). A photo that
 *   cannot fill the slide without cutting a subject blind is shown whole, centred on the scrim's
 *   colour, so nothing is cut and the slide is still the picture.
 * - Fit on arrival (P6): the words step down to the body's small size when they do not fit, and are
 *   reported in `over` past that. A hook whose picture failed is laid as a discussion prompt (the
 *   caller), never an empty dark slide.
 */
import { uid } from "../factories";
import { type Ctx, kit, mix, placePhoto, type TemplateInput } from "./index";

export const HOOK_NAMES = { photo: "Hook photo", scrim: "Scrim" } as const;
/** White text on the scrim. */
export const HOOK_TEXT = "#ffffff";
/** The scrim's opacity: Chalkie's is about 60%; this keeps 4.5:1 over white on every theme. */
export const HOOK_SCRIM_OPACITY = 0.68;
const SLIDE = { w: 960, h: 540 } as const;
const TEXT_W = 800;

/** The scrim's colour: the theme's accent sunk almost to black. */
export const hookScrim = (accent: string) => mix(accent, "#000000", 0.16);

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const luminance = (c: number[]) =>
  0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);

/**
 * White text's contrast on the scrim at its worst: laid over a pure white pixel, the scrim blended
 * at its opacity the way a browser blends it (in sRGB).
 */
export function hookContrast(accent: string, under = "#ffffff"): number {
  const a = HOOK_SCRIM_OPACITY;
  const s = rgb(hookScrim(accent));
  const u = rgb(under);
  const seen = s.map((v, i) => v * a + (u[i] ?? 0) * (1 - a));
  const l1 = luminance(rgb(HOOK_TEXT));
  const l2 = luminance(seen);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** A hook needs a photo (placed, or an open slot while it is being found). */
export const hookOk = (input: TemplateInput) => !!input.figure && "photo" in input.figure;

/** Not a hook after all: the words as a discussion prompt. */
export function asPrompt(input: TemplateInput): TemplateInput {
  return { template: "discussion", heading: input.heading, lead: input.lead ?? "" };
}

export function layoutHook(c: Ctx, input: TemplateInput) {
  const f = input.figure;
  if (!f || !("photo" in f)) return;
  const scrim = hookScrim(c.t.colors.accent);
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
    opacity: HOOK_SCRIM_OPACITY,
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
      { color: HOOK_TEXT, align: "center", name: "Heading" },
    );
    y += m.head + m.gap;
  }
  if (lead)
    kit.text(
      c,
      lead,
      "body",
      { x, y, w: TEXT_W },
      { color: HOOK_TEXT, align: "center", name: "Lead" },
    );
  c.s = full;
  // The words are centred on the photo, not in the band under a heading (ruling 198 does not move them).
  c.bodyFromHeading = true;
}
