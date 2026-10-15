/**
 * Quick check (TEACH-101 part g; gold `northstars-v12/questions-b`, direction C; rulings 108, 190,
 * 193, 230). The questions sit on the paper with small ink number badges; the answers sit in a sand
 * split field on the right that starts under the title and runs to the bottom edge, one answer per
 * row at one left edge, level with its question.
 *
 * - **Hidden:** each row's place in the field holds a soft "?" chip, never a box or a line to write on.
 * - **Reveal:** one answer per click, in order. At step k a field-coloured cover hides "?" k and
 *   answer k appears over it (no hide-after-step field is needed: no domain change).
 * - **Fit, in two passes:** every question on one line at the stage's body size; else up to two
 *   lines, at body then the one step under it. The rows take at most 90% of the stage, with even
 *   gaps. Past the floor the slide is over (red outline, split by the writer).
 * - **Field width** follows the longest answer, 288-320 pt (432-480 px); an answer may wrap to two
 *   balanced lines.
 *
 * Every painted part is a theme surface role (`field-b` with its own square corners, `badge`,
 * `chip`); the answers are the theme's accent, the only red on the slide.
 *
 * The answers stay on the slide's question (`listAnswers`) for the worksheet, the answer drawer and
 * the PowerPoint key; Present does not reveal them a second time (`hasRevealableAnswer`: a slide
 * that reveals its own elements draws its own answer).
 */
import type { ShapeElement, SlideElement } from "@tj/domain/documents";
import { uid } from "../factories";
import { resolveFontSize } from "../text-style";
import { MIN_FONT_SIZE, typeScale } from "../themes";
import { paintSurface, type SurfaceRole, surfaceName, surfaceStyle } from "../themes/surfaces";
import {
  type Ctx,
  type FieldReport,
  kit,
  listAnswers,
  type Stage,
  type TemplateInput,
} from "./index";
import CAPACITY from "./question-set-capacity.json" with { type: "json" };

const SLIDE_W = 960;
const SLIDE_H = 540;
const PAD_X = 64;
/** The field's answers start this far inside it (the gold's 64 px after its review). */
const FIELD_IN = 43;
/** Field width bounds (the gold's 432-480 px). */
const FIELD_MIN = 288;
const FIELD_MAX = 320;
/** Rows may fill at most this share of the stage. */
const ROWS_SHARE = 0.9;
/** Gap between a badge and its question; between a question and the field. */
const BADGE_GAP = 19;
const FIELD_GAP = 32;

/** Element names: the editor's layout ref and the tests read them. */
export const QUICK_NAMES = {
  question: "Question",
  answer: "Answer",
  wait: "Answer to come",
  cover: "Answer cover",
} as const;

/** The most questions a quick check holds at a stage (gold NOTES "Maximum per age"). */
export function quickCheckMax(stage: Stage, long = false): number {
  if (stage === "ks1") return 4;
  if (stage === "ks2") return 6;
  return long ? 5 : 6;
}
/** The fewest questions a quick check is drawn for. */
export const QUICK_CHECK_MIN = 3;
/** Most words in an answer at a stage (Q-d1): 3 to KS2, 5 from KS3. */
export const quickAnswerWords = (stage: Stage): number =>
  stage === "ks1" || stage === "ks2" ? 3 : 5;

const stageOf = (c: Ctx): Stage => (c.t as { keyStage?: Stage }).keyStage ?? "ks2";

/** `{a/b}` is set inline as "a/b" in this batch (the stacked fraction is Tech debt). */
export const inlineFractions = (s: string): string => s.replace(/\{(\d+)\/(\d+)\}/g, "$1/$2");

/** Whether a question-set input draws as the quick check: its questions carry answers. */
export function isQuickCheck(input: TemplateInput): boolean {
  const qs = (input.questions ?? []).filter((q) => q.trim());
  const as = input.answers ?? [];
  // A set the writer is still streaming may have answers for its first questions only: it lays
  // out as the quick check from its first answer, so nothing changes shape when the rest arrive.
  return !input.figure && qs.length >= 1 && as.some((a) => !!a?.trim());
}

type Fit = {
  size: number;
  rowH: number[];
  qH: number[];
  aH: number[];
  badge: number;
  chip: number;
  ok: boolean;
  comfy: boolean;
};

function paint(
  c: Ctx,
  role: SurfaceRole,
  box: { x: number; y: number; w: number; h: number },
  own?: readonly [number, number, number, number],
): ShapeElement | null {
  const el = paintSurface({ role, box, id: uid(), ...(own ? { own } : {}) }, c.t);
  if (!el) return null;
  // Drawn under its content, never locked away from the editor's selection of the slide's parts.
  const { locked: _, ...free } = el as ShapeElement & { locked?: boolean };
  c.els.push(free as SlideElement);
  return free as ShapeElement;
}

/** The quick check, drawn into `c` (heading included). */
export function layoutQuestionSet(c: Ctx, input: TemplateInput) {
  const stage = stageOf(c);
  const qs = (input.questions ?? []).map((q) => inlineFractions(q.trim()));
  const as = (input.questions ?? []).map((_, i) =>
    inlineFractions((input.answers?.[i] ?? "").trim()),
  );
  const n = qs.length;
  const head = kit.heading(c, input.heading);
  const headBottom = head.y + head.h;
  const titleGap = n <= 3 ? 43 : 29;
  const fieldTop = Math.round(headBottom + titleGap);
  const stageTop = fieldTop + (n <= 3 ? 27 : 21);
  const stageBottom = SLIDE_H - 21;
  const stageH = stageBottom - stageTop;

  const sc = typeScale(c.t);
  const body = resolveFontSize(c.t, "body");
  const small = sc ? sc.bodySmall : Math.max(MIN_FONT_SIZE.body, Math.round(body * 0.85));
  const sizes = [...new Set([body, resolveFontSize(c.t, "body", small)])].filter(
    (s) => s >= MIN_FONT_SIZE.body,
  );

  const longest = Math.max(0, ...as.map((a) => a.length));
  const fieldW = (q: number) =>
    Math.round(Math.min(FIELD_MAX, Math.max(FIELD_MIN, longest * q * 0.62 + 2 * FIELD_IN + 5)));

  const at = (size: number, maxLines: number): Fit & { fw: number } => {
    const fw = fieldW(size);
    const fx = SLIDE_W - fw;
    const badge = Math.round(size * 1.25);
    const chip = badge;
    const qx = PAD_X + badge + BADGE_GAP;
    const qw = fx - FIELD_GAP - qx;
    const aw = SLIDE_W - PAD_X / 2 - (fx + FIELD_IN);
    const cs = { ...c, s: { ...c.s, body: size, lead: size } };
    const lineH = size * 1.4;
    const qH = qs.map((q) => kit.measure(cs, q, "body", qw));
    const aH = as.map((a) => kit.measure(cs, a, "lead", aw));
    const tooTall = qH.some((h) => h > maxLines * lineH + 1);
    const wide = as.some((a) => !kit.wordsFit(cs, a, "lead", aw, size, 700));
    const twoLineAnswer = aH.some((h) => h > 2 * lineH + 1);
    // The gold's row padding: snapped to 4 px at 1440 wide (1.5 px a point).
    const rowPad = Math.round((Math.round((size * 1.5 * (n <= 3 ? 0.4 : 0.22)) / 4) * 4) / 1.5);
    const rowH = qs.map((_, i) => Math.max(badge, chip, qH[i] as number, aH[i] as number));
    const total = rowH.reduce((s, h) => s + h + 2 * rowPad, 0);
    const ok = !tooTall && !wide && !twoLineAnswer && total <= stageH * ROWS_SHARE;
    return { size, rowH, qH, aH, badge, chip, ok, comfy: maxLines === 1, fw };
  };

  // Pass 1: one line per question at the body size. Pass 2: two lines, body then the step under.
  let fit = at(body, 1);
  if (!fit.ok)
    for (const s of sizes) {
      fit = at(s, 2);
      if (fit.ok) break;
    }
  const max = quickCheckMax(stage, !fit.comfy);
  if (!fit.ok) c.over.push(`question-set ${n} questions do not fit at ${fit.size}pt`);
  if (n > max) c.over.push(`question-set ${n}/${max} questions`);
  c.tight = !fit.comfy;

  const fx = SLIDE_W - fit.fw;
  const ax = fx + FIELD_IN;
  const aw = SLIDE_W - PAD_X / 2 - ax;
  const qx = PAD_X + fit.badge + BADGE_GAP;
  const qw = fx - FIELD_GAP - qx;
  const field = { x: fx, y: fieldTop, w: fit.fw, h: SLIDE_H - fieldTop };
  paint(c, "field-b", field, [0, 0, 0, 0]);

  const sum = fit.rowH.reduce((s, h) => s + h, 0);
  const gap = Math.max(0, (stageH - sum) / (n + 1));
  const s = c.s;
  c.s = { ...s, body: fit.size, lead: fit.size };
  let y = stageTop + gap;
  let step = 0;
  const fields: FieldReport[] = [];
  const caps = quickCaps(stage, n);
  qs.forEach((q, i) => {
    const h = fit.rowH[i] as number;
    const mid = y + h / 2;
    // Number badge (the worked-example rail's ink disc), at the list marker's size.
    roleDisc(c, "badge", String(i + 1), PAD_X, mid, fit.badge, surfaceName("badge"));
    const qh = fit.qH[i] as number;
    kit.text(
      c,
      q,
      "body",
      { x: qx, y: mid - qh / 2, w: qw },
      { color: c.t.colors.ink, name: QUICK_NAMES.question },
    );
    // The "?" chip, then (step i+1) a field-coloured cover over it and the answer.
    const cy = Math.round(mid - fit.chip / 2);
    // A row with no answer has nothing to reveal, so it has no "?" chip and no step.
    if (as[i]) {
      step += 1;
      roleDisc(c, "chip", "?", ax, mid, fit.chip, QUICK_NAMES.wait);
      const from = c.els.length;
      const cover = paint(
        c,
        "field-b",
        {
          x: ax - 2,
          y: cy - 2,
          w: fit.chip + 4,
          h: fit.chip + 4,
        },
        [0, 0, 0, 0],
      );
      if (cover) cover.name = QUICK_NAMES.cover;
      const ah = fit.aH[i] as number;
      kit.text(
        c,
        as[i] as string,
        "lead",
        { x: ax, y: mid - ah / 2, w: aw },
        { color: c.t.colors.accent, weight: 700, name: QUICK_NAMES.answer },
      );
      for (const e of c.els.slice(from)) {
        e.revealStep = step;
        e.reveal = "rise";
      }
    }
    fields.push(report(`questions.${i}`, q.length, caps.questions));
    fields.push(report(`answers.${i}`, (as[i] ?? "").length, caps.answers));
    y += h + gap;
  });
  c.s = s;
  c.fields = fields;
  const q = listAnswers(qs, as);
  if (q) c.question = q;
}

/**
 * A list-marker disc (stored at the size every renderer draws, `kit.disc`) painted as a theme
 * surface role: its fill and ink are the role's, its name the role's surface name.
 */
function roleDisc(
  c: Ctx,
  role: SurfaceRole,
  label: string,
  x: number,
  mid: number,
  d: number,
  name: string,
) {
  const st = surfaceStyle(c.t, role);
  kit.disc(c, label, x, mid - d / 2, d, st.fill);
  const el = c.els[c.els.length - 1] as ShapeElement;
  el.name = name;
  if (st.ink && el.textStyle) el.textStyle = { ...el.textStyle, color: st.ink };
}

type Cap = { cap: number; hardMax: number };
/** The measured limits for a stage and count (`question-set-capacity.json`), nearest count. */
export function quickCaps(stage: Stage, n: number): { questions: Cap; answers: Cap } {
  const age = stage === "ks1" ? "early" : stage === "ks2" ? "primary" : "secondary";
  const t =
    (CAPACITY as Record<string, Record<string, { questions: Cap; answers: Cap }>>)[age] ?? {};
  const counts = Object.keys(t).map(Number);
  const k = Math.min(Math.max(n, Math.min(...counts)), Math.max(...counts));
  return t[String(k)] as { questions: Cap; answers: Cap };
}

/** A field's length against its measured comfortable cap and hard maximum (the live counters). */
function report(path: string, chars: number, c: Cap): FieldReport {
  return {
    field: path.split(".")[0] as string,
    path,
    chars,
    cap: c.cap,
    hardMax: c.hardMax,
    tight: chars > c.cap,
    over: chars > c.hardMax,
  };
}
