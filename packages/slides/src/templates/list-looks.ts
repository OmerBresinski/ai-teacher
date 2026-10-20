/**
 * Lane OBJ (20 Oct, exploration for Greg, not yet ruled): new looks for the two numbered-list
 * slides the writer path ships, the objectives slide and the "Do now" starter (a quick check before
 * the first teaching slide). Greg: "frankly that's a shit slide". Each look is behind a
 * `LayoutOptions` switch (`objectivesLook`, `starterLook`), off by default, so old lessons and the
 * writer render as before until a look is chosen.
 *
 * Objectives (the writer never writes this slide: code fills it from the approved pupil objectives):
 * - `goals`: "By the end you can" goal cards, one per objective, side by side across the body, each
 *   led by its command verb in the accent (the slide's one accent role). Fills the empty right third.
 * - `picture`: the lesson's hero picture (the title slide's) bleeding down the right third, the
 *   objectives verb-led on the paper beside it under hairlines. No picture: the goal cards.
 * - `journey`: a route across the slide, one stop per objective, the verb and words under each stop,
 *   ending at a flag for the exit ticket.
 *
 * Starter:
 * - `cards`: one card per question across the body, the question large; its answer rises in the
 *   card's sand foot on its click. Nothing empty shows before the reveal.
 * - `picture`: the starter's own picture (the writer's existing `picture` slot) as the cue on the
 *   left, the questions ruled on the right with each answer revealed under its question. No picture:
 *   the cards.
 */
import type { ShapeElement, SlideElement } from "@tj/domain/documents";
import { uid } from "../factories";
import { paintSurface, type SurfaceRole } from "../themes/surfaces";
import { type Ctx, G, kit, listAnswers, type TemplateInput } from "./index";
import { badgeSize, drawBadge } from "./practice";

export type ObjectivesLook = "goals" | "picture" | "journey";
export type StarterLook = "cards" | "picture";

type Rect = { x: number; y: number; w: number; h: number };
const FOOT = 500;

function paint(c: Ctx, role: SurfaceRole, box: Rect): ShapeElement | null {
  const el = paintSurface({ role, box, id: uid() }, c.t);
  if (!el) return null;
  const { locked: _, ...free } = el as ShapeElement & { locked?: boolean };
  c.els.push(free as SlideElement);
  return free as ShapeElement;
}

/** The command verb and the rest: "Explain how ..." -> ["Explain", "how ..."]. */
export function verbSplit(s: string): [string, string] {
  const m = s.trim().match(/^(\S+)\s+([\s\S]+)$/);
  return m ? [m[1] as string, m[2] as string] : [s.trim(), ""];
}

/** The fit ladder these looks share: full size, then body at the small step. */
function rungs(c: Ctx) {
  const full = c.s;
  const small = Math.min(full.small, full.body);
  return [
    full,
    { ...full, body: small, lead: Math.round(small * 1.15) },
    { ...full, body: Math.round(small * 0.9), lead: small },
  ];
}

/** Heading in a narrower column (the picture look leaves the right third to the photo). */
function headingIn(c: Ctx, value: string, w: number) {
  let size = c.s.heading;
  while (size > c.s.body && !kit.wordsFit(c, value, "heading", w, size)) size -= 2;
  const s = c.s;
  c.s = { ...s, heading: size };
  const el = kit.text(c, value, "heading", { x: G.margin, y: G.headY, w }, { name: "Heading" });
  c.s = s;
  return el;
}

/* ---------------------------- objectives ---------------------------- */

function goalCards(c: Ctx, items: string[], area: Rect): boolean {
  const n = items.length;
  if (!n) return false;
  const cols = n === 4 ? 2 : n;
  const rows = Math.ceil(n / cols);
  const gap = 24;
  const cw = Math.floor((area.w - gap * (cols - 1)) / cols);
  const full = c.s;
  for (const s of rungs(c)) {
    c.s = s;
    const pad = Math.round(s.body * 0.9);
    const b = badgeSize(c);
    const tw = cw - 2 * pad;
    const hs = items.map((q) => {
      const [verb, rest] = verbSplit(q);
      return (
        b +
        Math.round(s.body * 0.6) +
        kit.measure(c, verb, "lead", tw) +
        Math.round(s.body * 0.25) +
        (rest ? kit.measure(c, rest, "body", tw) : 0)
      );
    });
    const inner = Math.max(...hs);
    // Short objectives grow the card to ~70% of the body, never a dead bottom half.
    const ch = Math.max(inner + 2 * pad, Math.round((area.h * 0.72 - gap * (rows - 1)) / rows));
    const total = rows * ch + gap * (rows - 1);
    if (total > area.h + 12) continue;
    items.forEach((q, k) => {
      const x = area.x + (k % cols) * (cw + gap);
      const y = area.y + Math.floor(k / cols) * (ch + gap);
      paint(c, "field-b", { x, y, w: cw, h: ch });
      drawBadge(c, k, x + pad, y + pad, b);
      const [verb, rest] = verbSplit(q);
      const vy = y + pad + b + Math.round(s.body * 0.6);
      const v = kit.text(
        c,
        verb,
        "lead",
        { x: x + pad, y: vy, w: tw },
        { color: c.t.colors.accent, name: "Verb" },
      );
      if (rest)
        kit.text(
          c,
          rest,
          "body",
          { x: x + pad, y: v.y + v.h + Math.round(s.body * 0.25), w: tw },
          { color: c.t.colors.ink, name: "Item" },
        );
    });
    c.s = full;
    return true;
  }
  c.s = full;
  return goalRows(c, items, area);
}

/**
 * Goal cards as full-width rows when the columns cannot hold the words (long KS2/KS3 objectives at
 * the projector floor): the verb in its own left column, the rest beside it, one sand card each.
 */
function goalRows(c: Ctx, items: string[], area: Rect): boolean {
  const full = c.s;
  const gap = 16;
  for (const s of rungs(c)) {
    c.s = s;
    const pad = Math.round(s.body * 0.6);
    const b = badgeSize(c);
    const verbs = items.map((q) => verbSplit(q)[0]);
    const vw = Math.min(
      240,
      Math.max(
        ...verbs.map((v) =>
          Math.ceil(kit.measure(c, v, "lead", 2000) ? v.length * s.lead * 0.62 : 0),
        ),
      ),
    );
    const tx = pad + b + Math.round(s.body * 0.7) + vw + Math.round(s.body * 0.8);
    const tw = area.w - tx - pad;
    const hs = items.map((q) => Math.max(b, kit.measure(c, verbSplit(q)[1], "body", tw)) + 2 * pad);
    const used = hs.reduce((a, h) => a + h, 0) + gap * (items.length - 1);
    if (used > area.h + 12) continue;
    // Rows share out the body's height when short, up to ~75% of it.
    const grow = Math.max(0, Math.min(area.h * 0.75 - used, items.length * s.body)) / items.length;
    let y = area.y;
    items.forEach((q, k) => {
      const h = (hs[k] as number) + grow;
      paint(c, "field-b", { x: area.x, y, w: area.w, h });
      drawBadge(c, k, area.x + pad, y + Math.round((h - b) / 2), b);
      const [verb, rest] = verbSplit(q);
      const vh = kit.measure(c, verb, "lead", vw);
      kit.text(
        c,
        verb,
        "lead",
        { x: area.x + pad + b + Math.round(s.body * 0.7), y: y + Math.round((h - vh) / 2), w: vw },
        { color: c.t.colors.accent, name: "Verb" },
      );
      const th = kit.measure(c, rest, "body", tw);
      kit.text(
        c,
        rest,
        "body",
        { x: area.x + tx, y: y + Math.round((h - th) / 2), w: tw },
        { color: c.t.colors.ink, name: "Item" },
      );
      y += h + gap;
    });
    c.s = full;
    return true;
  }
  c.s = full;
  return false;
}

/** Verb-led rows under hairlines, no number discs: order is position. */
function verbRows(c: Ctx, items: string[], area: Rect): boolean {
  const full = c.s;
  for (const s of rungs(c)) {
    c.s = s;
    const pad = Math.round(s.body * 0.45);
    const hs = items.map((q) => {
      const [verb, rest] = verbSplit(q);
      return kit.measure(c, `${verb} ${rest}`, "body", area.w, 700);
    });
    const total = hs.reduce((a, h) => a + h + 2 * pad, 0);
    if (total > area.h) continue;
    // Spread to fill: rows share the body's height when they are short.
    const extra = Math.max(0, Math.min(area.h * 0.8 - total, items.length * s.body * 1.2));
    const p = pad + extra / (2 * items.length);
    let y = area.y;
    items.forEach((q, k) => {
      if (k > 0) kit.rule(c, area.x, y, area.w);
      const [verb, rest] = verbSplit(q);
      const el = kit.text(
        c,
        `${verb} ${rest}`,
        "body",
        { x: area.x, y: y + p, w: area.w },
        { color: c.t.colors.ink, name: "Item", weight: c.t.weights.body },
      );
      // The verb bold in the accent, the rest at body weight: measured as lead (bold) so it never under-measures.
      verbDoc(el, verb, rest, c.t.colors.accent);
      y += (hs[k] as number) + 2 * p;
    });
    c.s = full;
    return true;
  }
  c.s = full;
  return false;
}

/** The objective's doc: its verb bold in the accent, then the rest. */
function verbDoc(el: SlideElement, verb: string, rest: string, color: string) {
  (el as { doc?: unknown }).doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: verb,
            marks: [{ type: "bold" }, { type: "textStyle", attrs: { color } }],
          },
          ...(rest ? [{ type: "text", text: ` ${rest}` }] : []),
        ],
      },
    ],
  };
}

function journey(c: Ctx, items: string[]): boolean {
  const n = items.length;
  if (!n) return false;
  const full = c.s;
  const flagW = 56;
  const x0 = G.margin;
  const w = G.width - flagW;
  const colW = Math.floor(w / n);
  for (const s of rungs(c)) {
    c.s = s;
    const b = Math.round(badgeSize(c) * 1.25);
    const tw = colW - 28;
    const lineY = G.band.y + Math.round(b / 2) + 6;
    const hs = items.map((q) => {
      const [verb, rest] = verbSplit(q);
      return kit.measure(c, verb, "lead", tw) + s.body * 0.3 + kit.measure(c, rest, "body", tw);
    });
    const top = lineY + Math.round(b / 2) + Math.round(s.body * 1.1);
    if (top + Math.max(...hs) > FOOT) continue;
    // The route: one track from the first stop to the flag.
    paint(c, "track", {
      x: x0 + Math.round(b / 2),
      y: lineY - 3,
      w: G.right - x0 - Math.round(b / 2) - 8,
      h: 6,
    });
    items.forEach((q, k) => {
      const x = x0 + k * colW;
      drawBadge(c, k, x, lineY - Math.round(b / 2), b);
      const [verb, rest] = verbSplit(q);
      const v = kit.text(
        c,
        verb,
        "lead",
        { x, y: top, w: tw },
        { color: c.t.colors.accent, name: "Verb" },
      );
      kit.text(
        c,
        rest,
        "body",
        { x, y: v.y + v.h + Math.round(s.body * 0.3), w: tw },
        { color: c.t.colors.ink, name: "Item" },
      );
    });
    flag(c, G.right - 26, lineY);
    c.s = full;
    return true;
  }
  c.s = full;
  return false;
}

/** The finish flag at the route's end: a pole and a pennant in the accent. */
function flag(c: Ctx, x: number, baseY: number) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rect",
    x,
    y: baseY - 44,
    w: 4,
    h: 50,
    fill: c.t.colors.ink,
    name: "Flag pole",
  } as ShapeElement);
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "triangle",
    x: x + 4,
    y: baseY - 44,
    w: 26,
    h: 20,
    fill: c.t.colors.accent,
    rotation: 90,
    name: "Flag",
  } as ShapeElement);
}

export function layoutObjectivesLook(c: Ctx, input: TemplateInput, look: ObjectivesLook): boolean {
  const items = (input.points ?? []).map((p) => (typeof p === "string" ? p : p.text));
  const body = { x: G.margin, y: G.band.y, w: G.width, h: FOOT - G.band.y };
  const photo = input.figure && "photo" in input.figure && input.figure.photo ? input.figure : null;
  if (look === "picture" && photo) {
    const px = 640;
    headingIn(c, input.heading ?? "", px - G.margin - 32);
    kit.photoBox(c, photo, { x: px, y: 0, w: 960 - px, h: 540 });
    if (verbRows(c, items, { x: G.margin, y: G.band.y, w: px - G.margin - 40, h: FOOT - G.band.y }))
      return true;
    // Too many words beside the picture: the goal cards, full width, without it.
    c.els.splice(0);
  }
  kit.heading(c, input.heading ?? "");
  if (look === "journey" && journey(c, items)) return true;
  return goalCards(c, items, body);
}

/* ------------------------------ starter ----------------------------- */

function questionCards(c: Ctx, qs: string[], as: string[], area: Rect): boolean {
  const n = qs.length;
  if (!n) return false;
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / cols);
  const gap = 24;
  const cw = Math.floor((area.w - gap * (cols - 1)) / cols);
  const full = c.s;
  for (const s of rungs(c)) {
    c.s = s;
    const pad = Math.round(s.body * 0.9);
    const b = badgeSize(c);
    const tw = cw - 2 * pad;
    const qh = Math.max(...qs.map((q) => kit.measure(c, q, "lead", tw)));
    const ah = Math.max(0, ...as.map((a) => (a ? kit.measure(c, a, "lead", tw) : 0)));
    const foot = ah ? ah + 2 * Math.round(s.body * 0.7) : 0;
    const need = pad + b + Math.round(s.body * 0.6) + qh + pad + foot;
    const ch = Math.max(need, Math.round((area.h * 0.75 - gap * (rows - 1)) / rows));
    if (rows * ch + gap * (rows - 1) > area.h + 12) continue;
    qs.forEach((q, k) => {
      const x = area.x + (k % cols) * (cw + gap);
      const y = area.y + Math.floor(k / cols) * (ch + gap);
      paint(c, "card", { x, y, w: cw, h: ch });
      drawBadge(c, k, x + pad, y + pad, b);
      kit.text(
        c,
        q,
        "lead",
        { x: x + pad, y: y + pad + b + Math.round(s.body * 0.6), w: tw },
        { color: c.t.colors.ink, name: "Item" },
      );
      const a = as[k];
      if (a) {
        const from = c.els.length;
        const fy = y + ch - foot;
        paint(c, "field-b", { x, y: fy, w: cw, h: foot });
        kit.text(
          c,
          a,
          "lead",
          { x: x + pad, y: fy + Math.round(s.body * 0.7), w: tw },
          { color: c.t.colors.accent, weight: 700, name: "Answer" },
        );
        for (const e of c.els.slice(from)) {
          e.revealStep = k + 1;
          e.reveal = "rise";
        }
      }
    });
    c.s = full;
    return true;
  }
  c.s = full;
  return false;
}

export function layoutStarterLook(c: Ctx, input: TemplateInput, look: StarterLook): boolean {
  const qs = input.questions ?? [];
  const as = qs.map((_, i) => input.answers?.[i] ?? "");
  const photo = input.figure && "photo" in input.figure && input.figure.photo ? input.figure : null;
  let ok: boolean;
  ok = false;
  if (look === "picture" && photo) {
    kit.heading(c, input.heading ?? "");
    kit.photoBox(c, photo as never, { x: G.margin, y: G.band.y, w: 392, h: FOOT - G.band.y });
    ok = redrawCue(c, qs, as);
    if (!ok) c.els.splice(0);
  }
  if (!ok) {
    kit.heading(c, input.heading ?? "");
    ok = questionCards(c, qs, as, { x: G.margin, y: G.band.y, w: G.width, h: FOOT - G.band.y });
  }
  const q = listAnswers(qs, input.answers, input.working);
  if (q) c.question = q;
  return ok;
}

function redrawCue(c: Ctx, qs: string[], as: string[]): boolean {
  const x = G.margin + 392 + 40;
  const w = G.right - x;
  const full = c.s;
  for (const s of rungs(c)) {
    c.s = s;
    const pad = Math.round(s.body * 0.6);
    const tw = w - 44;
    const hs = qs.map(
      (q, k) =>
        kit.measure(c, q, "lead", tw) +
        (as[k] ? kit.measure(c, as[k] as string, "body", tw) + 4 : 0),
    );
    const total = hs.reduce((a, h) => a + h + 2 * pad, 0);
    if (total > FOOT - G.band.y + 12) continue;
    const extra = Math.max(0, Math.min((FOOT - G.band.y) * 0.85 - total, qs.length * s.body * 1.4));
    const p = pad + extra / (2 * qs.length);
    let y = G.band.y;
    qs.forEach((q, k) => {
      if (k > 0) kit.rule(c, x, y, w);
      drawBadge(c, k, x, y + p, badgeSize(c));
      const qe = kit.text(
        c,
        q,
        "lead",
        { x: x + 44, y: y + p, w: tw },
        { color: c.t.colors.ink, name: "Item" },
      );
      const a = as[k];
      if (a) {
        const ae = kit.text(
          c,
          a,
          "body",
          { x: x + 44, y: qe.y + qe.h + 4, w: tw },
          { color: c.t.colors.accent, weight: 700, name: "Answer" },
        );
        ae.revealStep = k + 1;
        ae.reveal = "rise";
      }
      y += (hs[k] as number) + 2 * p;
    });
    c.s = full;
    return true;
  }
  c.s = full;
  return false;
}
