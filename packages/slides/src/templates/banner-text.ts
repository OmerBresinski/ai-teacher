/**
 * Banner picture + text (UX ruling 203, Chalkie layout parity P4; TEACH-75 part k): the
 * picture as a full-width strip across the top of the slide (about 40% of its height) or the
 * bottom, with the heading, a lead and 0-3 labelled bullets in the rest. Copied from the Chalkie
 * heart deck's slide 4 (strip on top) and the Y1 deck's slide 8 (strip at the bottom).
 *
 * - The strip bleeds to the slide's edges. The photo covers it, cropped round its must-see subjects
 *   (`placePhoto`); a photo that cannot fill the strip without cutting a subject blind is laid as
 *   picture + text with the photo in the side panel instead (`bannerOk`): never a contained photo
 *   in a wash, never a lost picture.
 * - Fit on arrival (P6): the strip takes 40% of the slide; when the words do not fit beside it, the
 *   strip narrows to a third, then the body takes its one step down. Words never move or go.
 */
import { uid } from "../factories";
import {
  type Ctx,
  G,
  kit,
  placePhoto,
  pointLabel,
  pointText,
  type TemplateInput,
  type TemplatePoint,
} from "./index";

export const BANNER_NAMES = { strip: "Banner", bullet: "Bullet" } as const;
const SLIDE = { w: 960, h: 540 } as const;
const FOOT = 512;
/** The strip's heights, tallest first: 40% of the slide (Chalkie's), then about a third. */
export const BANNER_HEIGHTS = [216, 180] as const;
/** Most bullets under the lead. */
export const BANNER_POINTS = 3;

/** Whether the photo can fill a strip `h` high without cutting a subject blind. */
function covers(input: TemplateInput, h: number): boolean {
  const f = input.figure;
  if (!f || !("photo" in f)) return false;
  // An open slot (the picture is still being found) is asked at the strip's own shape.
  if (!f.photo || !f.aspect) return true;
  return placePhoto(f.aspect, SLIDE.w / h, f.subjects).mode === "cover";
}

/** A banner needs a photo that fills at least the narrower strip. */
export function bannerOk(input: TemplateInput): boolean {
  return BANNER_HEIGHTS.some((h) => covers(input, h));
}

/** Not a banner after all: the same words beside the photo, or alone when there is none. */
export function asSidePanel(input: TemplateInput): TemplateInput {
  const { at: _, ...rest } = input;
  return input.figure && "photo" in input.figure
    ? { ...rest, template: "picture-text" }
    : { ...rest, template: "explain", figure: undefined };
}

const asLine = (p: TemplatePoint) => {
  const label = pointLabel(p);
  return label ? `${label}: ${pointText(p)}` : pointText(p);
};

export function layoutBanner(c: Ctx, input: TemplateInput) {
  const f = input.figure;
  if (!f || !("photo" in f)) return;
  const bottom = input.at === "bottom";
  const all = input.points ?? [];
  if (all.length > BANNER_POINTS) c.over.push(`points ${all.length}/${BANNER_POINTS}`);
  const lines = all.slice(0, BANNER_POINTS).map(asLine);
  const lead = input.lead?.trim();
  const full = c.s;
  const w = G.width;
  const bulletIndent = Math.round(full.body * 0.9);

  /** The text block's height at the current scale. */
  const measure = () => {
    const gap = Math.round(c.s.body * 0.45);
    const head = kit.measure(c, input.heading, "heading", w);
    const leadH = lead ? kit.measure(c, lead, "body", w) : 0;
    const items = lines.map((l) => kit.measure(c, l, "body", w - bulletIndent));
    const blocks = [head + Math.round(c.s.body * 0.6), leadH, ...items].filter((h) => h > 0);
    return { total: blocks.reduce((a, b) => a + b, 0) + gap * (blocks.length - 2), gap, head };
  };

  type Try = { h: number; small: boolean };
  const tries: Try[] = BANNER_HEIGHTS.filter((h) => covers(input, h)).flatMap((h) => [
    { h, small: false },
    ...(c.fullSize ? [] : [{ h, small: true }]),
  ]);
  const roomFor = (h: number) => (bottom ? SLIDE.h - h - 24 - G.headY : FOOT - (h + 28));
  const pick =
    tries.find((t) => {
      c.s = t.small ? { ...full, body: full.small, lead: full.small } : full;
      const ok = measure().total <= roomFor(t.h);
      c.s = full;
      return ok;
    }) ?? (tries[tries.length - 1] as Try);

  // The strip: full bleed, the slide's own corners (no radius of its own).
  const y = bottom ? SLIDE.h - pick.h : 0;
  kit.photoBox(c, f, { x: 0, y, w: SLIDE.w, h: pick.h });
  const strip = c.els[c.els.length - 1];
  if (strip && strip.type === "image") {
    strip.name = BANNER_NAMES.strip;
    strip.radius = 0;
  }

  c.s = pick.small ? { ...full, body: full.small, lead: full.small } : full;
  const m = measure();
  if (m.total > roomFor(pick.h)) c.over.push(`banner text ${m.total}/${roomFor(pick.h)}pt`);
  let top = bottom ? G.headY : pick.h + 28;
  const head = kit.text(
    c,
    input.heading,
    "heading",
    { x: G.margin, y: top, w },
    { name: "Heading" },
  );
  top = head.y + head.h + Math.round(c.s.body * 0.6);
  if (lead) {
    const el = kit.text(c, lead, "body", { x: G.margin, y: top, w }, { color: c.t.colors.ink });
    el.name = "Lead";
    top = el.y + el.h + m.gap;
  }
  for (const l of lines) {
    const d = Math.max(6, Math.round(c.s.body * 0.22));
    const lineH = Math.round(c.s.body * kit.LH.body);
    c.els.push({
      id: uid(),
      type: "shape",
      shape: "ellipse",
      x: G.margin + Math.round(bulletIndent * 0.2),
      y: Math.round(top + (lineH - d) / 2),
      w: d,
      h: d,
      fill: c.t.colors.accent,
      name: BANNER_NAMES.bullet,
    });
    const el = kit.text(
      c,
      l,
      "body",
      { x: G.margin + bulletIndent, y: top, w: w - bulletIndent },
      { color: c.t.colors.ink, boldLabel: true, name: "Point" },
    );
    top = el.y + el.h + m.gap;
  }
  c.s = full;
  // Placed from the strip, so the body is not moved again under a taller heading (ruling 198).
  c.bodyFromHeading = true;
}
