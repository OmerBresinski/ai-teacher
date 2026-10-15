/**
 * Exit ticket (TEACH-230 part b, layout batch B2; rulings 108, 117, 141, 231): the closing "work
 * alone" slide, ported from the v13 gold (`northstars-v13/practice-exit`, "exit tickets are good",
 * 15 Oct). The title is centred, the only work-alone slide that centres it; one white ticket sits
 * centred on a sand floor that rises to behind its middle; the ticket's header is "EXIT TICKET" in
 * the accent (the slide's one accent mark); 1-3 questions stack inside under hairlines.
 *
 * - No answers on the slide (ruling 231): they stay on `slide.question` for the Answers slides.
 * - The `where` line (`instruction`) is kept in the data and never drawn (Greg, 15 Oct).
 * - Fit: the body step, then the one step under it (`tight`); more than 3 questions is over
 *   (ruling 108), drawn at the floor.
 */
import type { PathElement, ShapeElement } from "@tj/domain/documents";
import { uid } from "../factories";
import { resolveFontSize } from "../text-style";
import { v2Profile } from "../theme-v2";
import { keyStageOf, MIN_FONT_SIZE } from "../themes";
import { paintSurface } from "../themes/surfaces";
import { type Ctx, kit, listAnswers, type Stage, type TemplateInput } from "./index";
import {
  ageOf,
  badgeSize,
  comfortAt,
  drawBadge,
  drawRule,
  drawTask,
  isCalc,
  keptAnswers,
  measureTask,
  plainTask,
  taskLH,
  taskSteps,
  WA,
  WA_NAMES,
  workFields,
  workHeading,
} from "./practice";

export const EXIT_MAX = 3;
export const EXIT_LABEL = "Exit ticket";

/**
 * The gold's ticket, px at 1440 x 2/3, except the top and bottom padding (27 / 29 in the gold):
 * 5 pt is given back to the kicker, which the reading floor makes 4-8 pt taller than the gold's.
 */
export const TICKET = { w: 746, top: 24, side: 43, bottom: 27, kickGap: 16, floorAt: 0.4 } as const;

/**
 * The kicker: 30 / 26 px (20 / 17.3 pt) in the gold. A text under the reading floor (20 pt, ruling
 * 140) is not allowed, and the renderer draws any body text at a type-scale step (ruling 91): the
 * smallest at or over 20 is bodySmall (28 / 25 / 21 pt at KS1 / KS2 / KS3), stored as drawn.
 */
const kickerSize = (c: Ctx) => resolveFontSize(c.t, "body", MIN_FONT_SIZE.body);

const textW = (c: Ctx) => TICKET.w - 2 * TICKET.side - badgeSize(c) - WA.badgeGap;

/** The ticket's height at size `q`, or null when a question breaks its line limit. */
export function ticketHeight(c: Ctx, items: string[], q: number): number | null {
  const n = items.length;
  const b = badgeSize(c);
  const w = textW(c);
  const pad = Math.round(q * (n === 3 ? 0.5 : 0.7));
  let h = TICKET.top + kickerSize(c) + TICKET.kickGap;
  for (const [i, s] of items.entries()) {
    const t = measureTask(c, s, q, w);
    const lines = Math.round(t / (q * taskLH(c)));
    if (
      isCalc(s) ? lines > 1 : lines > WA.lines || !kit.wordsFit(c, plainTask(s), "body", w, q, 500)
    )
      return null;
    h += WA.rule + pad + Math.max(b, t) + (i < n - 1 ? pad : 0);
  }
  return h + TICKET.bottom;
}

export type ExitPlan = { q: number; comfortable: boolean; fits: boolean; height: number };

export function planExit(c: Ctx, items: string[], stageTop: number): ExitPlan {
  const room = WA.foot - stageTop;
  const steps = taskSteps(c);
  for (const q of steps) {
    const h = ticketHeight(c, items, q);
    if (h !== null && h <= room && items.length <= EXIT_MAX)
      return { q, comfortable: comfortAt(c, q), fits: true, height: h };
  }
  const q = steps[steps.length - 1] as number;
  return { q, comfortable: false, fits: false, height: ticketHeight(c, items, q) ?? room + 1 };
}

/**
 * The floor bleeds off three slide edges, so it has its own corner: square. A theme that rounds
 * every field (Night Lab's 14 pt) would otherwise round it where it meets the slide's edge.
 */
function squareFloor(el: ShapeElement | PathElement): ShapeElement {
  const { radius: _r, ...rest } = el as ShapeElement;
  if (el.type === "shape") return { ...rest, shape: "rect" };
  const { points: _p, closed: _c, ...base } = el as PathElement;
  return { ...(base as unknown as ShapeElement), type: "shape", shape: "rect" };
}

export function layoutExitTicket(c: Ctx, input: TemplateInput) {
  const top = workHeading(c, input, true);
  const items = (input.questions ?? []).filter(
    (s): s is string => typeof s === "string" && !!s.trim(),
  );
  const stageTop = Math.round(top + WA.exitGap);
  const plan = planExit(c, items, stageTop);
  c.tight = !plan.comfortable;
  c.fields = workFields(ageOf((keyStageOf(c.t) ?? "ks2") as Stage), "exit", items);
  if (items.length > EXIT_MAX) c.over.push(`exit ticket ${items.length}/${EXIT_MAX} questions`);
  else if (!plan.fits) c.over.push(`exit ticket ${plan.height}/${WA.foot - stageTop}pt`);

  const room = WA.foot - stageTop;
  const h = plan.height;
  const x = Math.round((960 - TICKET.w) / 2);
  const y = Math.round(stageTop + Math.max(0, (room - h) / 2));
  // The sand floor first, rising to behind the ticket's middle, edge to edge and to the foot.
  const floorY = Math.round(y + h * TICKET.floorAt);
  const floor = paintSurface(
    { role: "field-b", box: { x: 0, y: floorY, w: 960, h: 540 - floorY }, id: uid() },
    c.t,
  );
  if (floor) c.els.push(squareFloor(floor));
  const r = Math.round(v2Profile(c.t).radius.bubble);
  const ticket = paintSurface(
    { role: "card", box: { x, y, w: TICKET.w, h }, own: [r, r, r, r], id: uid() },
    c.t,
  );
  if (ticket) c.els.push(ticket);

  const ix = x + TICKET.side;
  const iw = TICKET.w - 2 * TICKET.side;
  const saved = c.s;
  c.s = { ...saved, body: kickerSize(c) };
  const kick = kit.text(
    c,
    EXIT_LABEL.toUpperCase(),
    "body",
    { x: ix, y: y + TICKET.top, w: iw },
    {
      weight: 700,
      color: c.t.colors.accent,
      name: WA_NAMES.kicker,
    },
  );
  c.s = saved;
  // The kicker is set solid (line height 1), as the gold's.
  kick.style = { ...kick.style, lineHeight: 1 };
  kick.h = kickerSize(c);
  const q = plan.q;
  const b = badgeSize(c);
  const pad = Math.round(q * (items.length === 3 ? 0.5 : 0.7));
  let cy = kick.y + kick.h + TICKET.kickGap;
  items.forEach((s, i) => {
    drawRule(c, ix, cy, iw);
    cy += WA.rule + pad;
    const tw = iw - b - WA.badgeGap;
    drawBadge(c, i, ix, cy + Math.max(0, (q * taskLH(c) - b) / 2), b);
    const el = drawTask(c, s, q, { x: ix + b + WA.badgeGap, y: cy, w: tw });
    cy += Math.max(b, el.h) + pad;
  });
  c.question = listAnswers(items, keptAnswers(input));
  if (!c.question) delete c.question;
}
