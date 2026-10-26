/**
 * A step shown with a ready-made model (TEACH-75 part af, layout pilot C8; rulings 219, 229, 249):
 * one calm slide in three parts, always in the same places. Ported from the pilot's
 * `northstars-v13/steps-model2/s2.js` (winner A, "title, one line, stage").
 *
 * - **Header:** an ink number badge and the step name as the slide title, at the heading's size and
 *   place. No track, no "Step n of N", no red pill: red is left to the model (it uses it for heat).
 * - **One line:** the do sentence in ink at body size, at most 2 lines; the optional see sentence
 *   under it in muted body text. See is the first thing dropped.
 * - **Stage:** the library model inside the standard margins (64 at the sides, 43 at the foot on the
 *   960 grid: 96 and 64 at 1440), 16 under the text (the drawing carries its own crop pad), centred,
 *   top-aligned (never floating) and filling down to the bottom margin. No plate, panel or border.
 *
 * **One voice:** the model keeps its own labels, restyled into ours by one `<style>` of token
 * overrides placed after the kit CSS (`restyleModelSvg`): our paper and ink, `--ink-2/-3` to muted,
 * `--hue-red` to the accent (the other hues stay the kit's until TEACH-215 c's slots land), purple, `--part` and `--plate` to
 * ink and sand, and the labels in the slide's body face.
 *
 * **The ladder (first rung that fits wins):** 1 do + see when the two take 2 lines or fewer; 2 do
 * only; 3 split, when do alone is over 2 lines: this slide keeps the header and the model at full
 * stage size and the step's words go on the "one" step slide before it (the writer's job; see
 * `stepRung`). A do line over 2 lines laid here anyway is kept and named in `over`, never cut.
 *
 * **Input:** a steps slide with `step` (`{ n, do, see }`). A saved steps slide without it (the
 * numbered list beside a figure, or the process line) lays out exactly as before. The writer's
 * current output (`points` plus one library model) maps in `stepModelOf`: a single point beside a
 * library model is that step's do line.
 */
import type { ImageElement } from "@tj/domain/documents";
import { svgFontFamily } from "../diagrams";
import { uid } from "../factories";
import { v2Colors } from "../theme-v2";
import { type Ctx, type Figure, G, kit, type Stage, type TemplateInput } from "./index";
import CAPACITY from "./steps-model-capacity.json" with { type: "json" };

export type StepModel = {
  /** The step's number, shown on the ink badge (no badge when absent). */
  n?: number;
  /** What to do: one sentence, at most 2 lines. */
  do: string;
  /** What you see: optional, muted, dropped first. */
  see?: string | null;
};
export type StepRung = "do+see" | "do" | "split";

/**
 * The step text's role: the scale's small step (28 KS1, 21 KS3 on the 960 grid), the size the gold's
 * body is at 1440 (38, 33, 31); master's body step is a size larger and fits fewer words a line.
 */
const STEP_ROLE = "small" as const;
/** The text column's width (1180 at 1440). */
export const STEP_TEXT_W = 787;
/** Text to stage (24 at 1440); the drawing's own 18-unit crop pad sits inside the stage. */
export const STEP_GAP = 16;
/** The stage's foot: the standard bottom margin (64 at 1440). */
export const STEP_FOOT = 540 - 43;
/**
 * The shortest stage a model may have (200 on the 960 grid, 300 at 1440; the gold's shortest is
 * 441 at 1440). Text that leaves less is named in `over`, as a long do line is: never shrunk past it.
 */
export const STEP_MIN_STAGE = 200;
/** The badge's diameter on the 960 grid (56 at 1440, 62 at early years). */
const badgeD = (stage: Stage) => (stage === "ks1" ? 41 : 37);
/** Badge to title (22 at 1440); title to the do line (20 at 1440). */
const BADGE_GAP = 15;
const TITLE_GAP = 13;
const NAMES = {
  badge: "Step number",
  title: "Heading",
  do: "Step",
  see: "Step see",
  model: "Diagram",
} as const;
export const STEP_NAMES = NAMES;

/** The do line's measured caps: words in 1 line and in 2 lines (the cap), per stage group. */
export const STEP_CAPS = CAPACITY as Record<
  "KS1" | "KS2" | "KS3-5",
  { oneLine: number; twoLines: number }
>;

const isModel = (f: Figure | undefined): f is Extract<Figure, { drawn: unknown }> =>
  !!f && "drawn" in f && !!f.drawn.bare;

/**
 * The step this slide shows with its model, or undefined for the old steps layouts. `step` wins;
 * else the writer's current output maps when it is one point beside a library model.
 */
export function stepModelOf(input: TemplateInput): StepModel | undefined {
  if (input.template !== "steps") return undefined;
  if (input.step && typeof input.step.do === "string") return input.step;
  const pts = input.points ?? [];
  if (pts.length === 1 && isModel(input.figure)) {
    const p = pts[0] ?? "";
    return { do: typeof p === "string" ? p : p.text };
  }
  return undefined;
}

const linesOf = (c: Ctx, s: string) =>
  s.trim()
    ? Math.round(kit.measure(c, s, STEP_ROLE, STEP_TEXT_W) / (c.s[STEP_ROLE] * kit.LH[STEP_ROLE]))
    : 0;

/** Which rung of the ladder the step's words reach on this stage's type (lines only). */
export function stepRungIn(c: Ctx, step: StepModel): StepRung {
  const d = linesOf(c, step.do);
  if (d > 2) return "split";
  if (step.see?.trim() && d + linesOf(c, step.see) <= 2) return "do+see";
  return "do";
}

/**
 * The model restyled into the slide's voice: one `<style>` of token overrides after the kit CSS,
 * replaced (never stacked) on a re-lay. A source that is not an SVG data URL is returned as it is.
 */
export function restyleModelSvg(src: string, t: Ctx["t"]): string {
  const m = /^data:image\/svg\+xml([^,]*),/.exec(src);
  if (!m) return src;
  const b64 = /;base64/.test(m[1] ?? "");
  let svg: string;
  try {
    svg = b64 ? atob(src.slice(m[0].length)) : decodeURIComponent(src.slice(m[0].length));
  } catch {
    return src;
  }
  if (!/<svg\b/.test(svg)) return src;
  const v = v2Colors(t);
  const ink = t.colors.ink;
  // A drawing in an <img> cannot see the page's font variables: each `var(--font-*)` becomes the
  // family it names (the face the drawing was measured in, which the editor embeds). Stripping it
  // left the stack's fallback, Verdana, wider than the measure: "Roman BritainAD 122" (verify8 S4).
  const font = svgFontFamily(t.fonts.body).replace(/[<>{}]/g, "") || "sans-serif";
  // The kit's own hues stay (water blue, life green) until the theme's colour slots (TEACH-215 c)
  // land; red is our accent, and the off-palette purple, parts and plate become ink and sand.
  const css =
    `svg.slide.tk[class]{--bg:${t.colors.background};--paper:${t.colors.background};--ink:${ink};` +
    `--ink-2:${t.colors.muted};--ink-3:${t.colors.muted};--hue-red:${t.colors.accent};` +
    `--hue-purple:${ink};--part:${ink};--part-pale:${v.sand};--plate:${v.sand};` +
    `--f-head:${font};--f-label:${font}}` +
    `svg.slide.tk[class] text,svg.slide.tk[class] tspan{font-family:${font}}`;
  const tag = `<style data-restyle="tj">${css}</style>`;
  const clean = svg.replace(/<style data-restyle="tj">[\s\S]*?<\/style>/g, "");
  const out = clean.replace(/<\/svg>\s*$/, `${tag}</svg>`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(out)}`;
}

/** The stage under text ending at `top`: the margins' width, down to the foot. */
export const stepStage = (top: number) => ({
  x: G.margin,
  y: Math.round(top + STEP_GAP),
  w: G.width,
  h: Math.round(STEP_FOOT - top - STEP_GAP),
});

/** Lays the step (header, one line, stage) and returns the rung it reached. */
export function layoutStepModel(c: Ctx, input: TemplateInput, step: StepModel, stage: Stage) {
  // Laid from the measured heading down: the body band is not moved under a taller heading.
  c.bodyFromHeading = true;
  const ink = c.t.colors.ink;
  // Header: the ink badge on the heading's first line, the step name beside it.
  let tx: number = G.margin;
  if (typeof step.n === "number") {
    const d = badgeD(stage);
    const line = c.s.heading * kit.LH.heading;
    kit.disc(c, String(step.n), G.margin, G.headY + (line - d) / 2, d, ink);
    const b = c.els[c.els.length - 1];
    if (b) b.name = NAMES.badge;
    tx = G.margin + d + BADGE_GAP;
  }
  const title = kit.text(
    c,
    input.heading,
    "heading",
    { x: tx, y: G.headY, w: G.right - tx },
    { name: NAMES.title },
  );
  let bottom = title.y + title.h;
  // One line: the ladder's rung by lines.
  const rung = stepRungIn(c, step);
  const doText = step.do.trim();
  if (doText) {
    const el = kit.text(
      c,
      doText,
      STEP_ROLE,
      { x: G.margin, y: bottom + TITLE_GAP, w: STEP_TEXT_W },
      { color: ink, weight: 400, name: NAMES.do },
    );
    bottom = el.y + el.h;
    if (rung === "split") c.over.push("step do line over 2 lines");
  }
  // A split slide (no do line: its words are on the step slide before) keeps no see line either.
  if (rung === "do+see" && doText && step.see) {
    const el = kit.text(
      c,
      step.see.trim(),
      STEP_ROLE,
      { x: G.margin, y: bottom, w: STEP_TEXT_W },
      { color: c.t.colors.muted, weight: 400, name: NAMES.see },
    );
    bottom = el.y + el.h;
  }
  // Stage: centred, top-aligned, down to the foot; a model on the paper, no panel.
  const r = stepStage(bottom);
  const f = input.figure;
  if (f && r.h < STEP_MIN_STAGE) c.over.push("step model stage too short");
  if (isModel(f)) {
    const a = f.drawn.aspect || r.w / r.h;
    const w = Math.min(r.w, Math.round(r.h * a));
    const h = Math.min(r.h, Math.round(w / a));
    c.els.push({
      id: uid(),
      type: "image",
      name: NAMES.model,
      x: Math.round(r.x + (r.w - w) / 2),
      y: r.y,
      w,
      h,
      src: restyleModelSvg(f.drawn.src, c.t),
      alt: f.drawn.alt ?? "",
      fit: "contain",
      ...(f.drawn.source ? { diagram: f.drawn.source } : {}),
    } as ImageElement);
  } else if (f) kit.figurePanel(c, f, r, true);
  return rung;
}
