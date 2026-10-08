// Shared components. Every colour, stroke, radius and size is a token. Every visible word is
// real SVG text: editable text carries data-edit="<params path>", computed text carries
// data-computed="<params path of the value it comes from>" (see kit/edit.js).

import { niceTicks } from "./axis.js";
import { GRID } from "./layout.js";
import { noteCut } from "./pictures.js";
import { clamp, fmtInt, h, lines, measure, overlaps, rng, T, W, wrap } from "./svg.js";

export { niceTicks };

/* ------------------------------------------------------------------ text */
/** Read teacher-overridable text: params.text[id] if set, else the fallback. */
export const txt = (P, id, fallback) =>
  P && P.text && P.text[id] != null && P.text[id] !== "" ? P.text[id] : fallback;
/** Mark a text element editable (path into params) or computed (path of the source value). */
export function editable(el, path) {
  if (path) el.dataset.edit = path;
  return el;
}
export function computed(el, path) {
  if (path) el.dataset.computed = path;
  return el;
}

/** Label that wraps to maxW and, if it still needs more than maxLines, shrinks one type step.
 *  Returns {g, w, h, lines}. Anchor 'start' | 'middle' | 'end'. */
export function textBlock(
  p,
  x,
  y,
  s,
  { cls = "ts-small", maxW = 360, maxLines = 2, lh = 30, anchor = "start", edit, a = {} } = {},
) {
  // a long edit wraps first, then shrinks one step to the token minimum, never past it
  const steps = cls === "ts-tiny" ? ["ts-tiny"] : [cls, "ts-tiny"];
  let use = cls,
    L = [];
  for (const c of steps) {
    use = c;
    L = wrap(p, s, c, maxW, a);
    if (L.length <= maxLines) break;
  }
  if (L.length > maxLines) {
    // last resort: cut the last line (whole words first) so it ends in "…" inside maxW
    L = L.slice(0, maxLines);
    let last = L[maxLines - 1];
    const fits = (t) => measure(p, t + "…", use, a) <= maxW;
    while (last.includes(" ") && !fits(last)) last = last.replace(/\s*\S*$/, "");
    while (last.length > 1 && !fits(last)) last = last.slice(0, -1);
    L[maxLines - 1] = last.trimEnd() + "…";
    noteCut(s, "label");
  }
  const lhUse = use === "ts-tiny" ? Math.min(lh, 26) : lh;
  const t = lines(p, x, y, L, use, lhUse, Object.assign({ "text-anchor": anchor }, a));
  editable(t, edit);
  const w = Math.max(0, ...L.map((l) => measure(p, l, use, a)));
  return { el: t, w, h: L.length * lhUse, lines: L, lh: lhUse, cls: use };
}

/** Knockout label: text on a soft ground so it reads over scenery. */
export function knock(p, x, y, s, cls, a, anchor, edit) {
  const g = h("g", {}, p);
  const t = T(g, x, y, s, cls, Object.assign({ "text-anchor": anchor || "middle" }, a || {}));
  editable(t, edit);
  const w = t.getComputedTextLength();
  const x0 = anchor === "end" ? x - w : anchor === "start" ? x : x - w / 2;
  g.insertBefore(
    h("rect", {
      x: x0 - 10,
      y: y - 25,
      width: w + 20,
      height: 34,
      rx: "var(--r-mark)",
      fill: "var(--knockout)",
    }),
    t,
  );
  return g;
}

/** Pill label (paper card, token height), optional numbered badge. Resizes to its text. */
export function pill(ctx, p, x, y, label, { num, col = "var(--ink)", a, edit } = {}) {
  const g = h("g", a || {}, p);
  const ph = ctx.tk.pillH,
    pad = ctx.tk.pillPad;
  const t = T(g, 0, 0, label, "ts-label");
  editable(t, edit);
  const tw = t.getComputedTextLength();
  const padL = num ? pad + ph * 0.62 : pad,
    w = padL + tw + pad,
    x0 = x - w / 2;
  g.insertBefore(
    h("rect", {
      x: x0,
      y: y - ph / 2,
      width: w,
      height: ph,
      rx: "var(--r-pill)",
      fill: "var(--paper)",
      cls: "lift body",
    }),
    t,
  );
  t.setAttribute("x", x0 + padL);
  t.setAttribute("y", y + ph * 0.19);
  if (num) {
    h("circle", { cx: x0 + pad * 0.5 + ph * 0.33, cy: y, r: ph * 0.33, fill: col }, g);
    T(g, x0 + pad * 0.5 + ph * 0.33, y + ph * 0.14, num, "ts-badge", { "text-anchor": "middle" });
  }
  g.box = { x: x0, y: y - ph / 2, w, h: ph };
  return g;
}

/* ------------------------------------------------------------------ arrows and flows */
export function headD(x, y, ang, s) {
  const c = Math.cos(ang),
    sn = Math.sin(ang);
  const P = [
    [0, 0],
    [-s, -s * 0.6],
    [-s * 0.72, 0],
    [-s, s * 0.6],
  ];
  return (
    "M" +
    P.map(
      ([px, py]) => (x + px * c - py * sn).toFixed(1) + " " + (y + px * sn + py * c).toFixed(1),
    ).join(" L ") +
    " Z"
  );
}
/** Arrow along path d ending at (ex,ey) heading ang. opts: draw (build index to draw on), delay, dash, k (head scale), g (group attrs). */
export function arrow(ctx, p, d, ex, ey, ang, col, w, opts = {}) {
  const g = h("g", opts.g || {}, p);
  const s = ctx.tk.head * (opts.k || 1);
  const a = {
    d,
    fill: "none",
    stroke: col,
    "stroke-width": w || "var(--sw-arrow)",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
  if (opts.dash) a["stroke-dasharray"] = opts.dash;
  if (opts.draw != null)
    Object.assign(a, { cls: "draw", pathLength: 1, s: opts.draw, delay: opts.delay || 0 });
  h("path", a, g);
  h(
    "path",
    {
      d: headD(ex + Math.cos(ang) * s * 0.72, ey + Math.sin(ang) * s * 0.72, ang, s),
      fill: col,
      s: opts.draw,
      delay: opts.draw != null ? (opts.delay || 0) + 600 : null,
    },
    g,
  );
  return g;
}
/** Straight arrow from (x1,y1) to (x2,y2); the head tip lands on (x2,y2). */
export function line(ctx, p, x1, y1, x2, y2, col, w, opts = {}) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const s = ctx.tk.head * (opts.k || 1);
  const ex = x2 - Math.cos(ang) * s * 0.72,
    ey = y2 - Math.sin(ang) * s * 0.72;
  return arrow(ctx, p, `M${x1} ${y1} L${ex} ${ey}`, ex, ey, ang, col, w, opts);
}
/** Smooth flow arrow through points (a process: evaporation, energy passed on, a journey). */
export function flow(ctx, p, pts, col, opts = {}) {
  const s = ctx.tk.head * (opts.k || 1);
  const n = pts.length;
  const [xa, ya] = pts[n - 2],
    [xb, yb] = pts[n - 1];
  const ang = Math.atan2(yb - ya, xb - xa);
  const end = [xb - Math.cos(ang) * s * 0.72, yb - Math.sin(ang) * s * 0.72];
  const P = pts.slice(0, -1).concat([end]);
  let d = `M${P[0][0]} ${P[0][1]}`;
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2,
      my = (P[i][1] + P[i + 1][1]) / 2;
    d += ` Q${P[i][0]} ${P[i][1]} ${i === P.length - 2 ? P[i + 1][0] : mx} ${i === P.length - 2 ? P[i + 1][1] : my}`;
  }
  if (P.length === 2) d += ` L${end[0]} ${end[1]}`;
  return arrow(ctx, p, d, end[0], end[1], ang, col, opts.w || "var(--sw-arrow)", opts);
}
export function wavyD(x1, y1, x2, y2, amp, n) {
  const L = Math.hypot(x2 - x1, y2 - y1),
    ux = (x2 - x1) / L,
    uy = (y2 - y1) / L;
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const s = i / 60;
    const o = amp * Math.sin(s * n * 2 * Math.PI) * Math.sin(Math.PI * s);
    d +=
      (i ? "L" : "M") +
      (x1 + ux * L * s - uy * o).toFixed(1) +
      " " +
      (y1 + uy * L * s + ux * o).toFixed(1);
  }
  return d;
}
/** Wavy arrow: heat, sound, energy leaving. */
export const wavy = (ctx, p, x1, y1, x2, y2, col, opts = {}) =>
  arrow(
    ctx,
    p,
    wavyD(x1, y1, x2, y2, 6, opts.n || 3),
    x2,
    y2,
    Math.atan2(y2 - y1, x2 - x1),
    col,
    "var(--sw-struct)",
    Object.assign({ k: 0.8 }, opts),
  );

/** Measured bracket ("how long", "how far") with a big computed number under it. */
export function bracket(
  p,
  x1,
  x2,
  y,
  label,
  { a = {}, computedPath, tick = 12, below = true } = {},
) {
  const g = h("g", a, p);
  h(
    "path",
    {
      d: `M${x1} ${y} H ${x2} M${x1} ${y - tick} V ${y + tick} M${x2} ${y - tick} V ${y + tick}`,
      stroke: "var(--ink-2)",
      "stroke-width": "var(--sw-struct)",
      fill: "none",
      "stroke-linecap": "round",
    },
    g,
  );
  const t = T(g, (x1 + x2) / 2, below ? y + 48 : y - 18, label, "ts-num", {
    "text-anchor": "middle",
  });
  computed(t, computedPath);
  g.label = t;
  return g;
}

/* ------------------------------------------------------------------ zoom */
/** Outer tangents of two circles: the cone of a magnifier. */
export function coneD(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1,
    dy = y2 - y1,
    d = Math.hypot(dx, dy),
    th = Math.atan2(dy, dx),
    b = Math.acos(clamp((r1 - r2) / d, -1, 1));
  const P = (cx, cy, r, a) =>
    (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1);
  return `M${P(x1, y1, r1, th + b)} L${P(x2, y2, r2, th + b)} L${P(x2, y2, r2, th - b)} L${P(x1, y1, r1, th - b)} Z`;
}
/** Magnifier: a small spot on the real object, a cone, and a round lens showing the inside.
 *  o: {id, sx, sy, sr (spot), cx, cy, r (lens), bg, a}. Draw into .inner, then call .rim(). */
export function magnifier(ctx, p, o) {
  const g = h("g", o.a || {}, p);
  h(
    "path",
    {
      d: coneD(o.sx, o.sy, o.sr, o.cx, o.cy, o.r),
      fill: "var(--cone)",
      stroke: "var(--cone-edge)",
      "stroke-width": "var(--sw-hair)",
    },
    g,
  );
  h(
    "circle",
    {
      cx: o.sx,
      cy: o.sy,
      r: o.sr,
      fill: "none",
      stroke: "var(--lens-rim)",
      "stroke-width": "var(--sw-struct)",
    },
    g,
  );
  const id = ctx.uid + "-lens-" + o.id;
  const cp = h("clipPath", { id }, h("defs", {}, g));
  h("circle", { cx: o.cx, cy: o.cy, r: o.r }, cp);
  h("circle", { cx: o.cx, cy: o.cy, r: o.r, fill: o.bg || "var(--lens-bg)", cls: "lift" }, g);
  const inner = h("g", { "clip-path": `url(#${id})` }, g);
  return {
    g,
    inner,
    rim() {
      h(
        "circle",
        {
          cx: o.cx,
          cy: o.cy,
          r: o.r,
          fill: "none",
          stroke: "var(--lens-rim)",
          "stroke-width": "var(--sw-lens)",
        },
        g,
      );
    },
  };
}
/** Rectangular zoom inset into any region: an outline on the source, a light wedge from the
 *  source to the card, and the card. The wedge has no edge lines and goes into `under` (a group the
 *  model creates beneath all its text), so it never strikes through a label. src and box are
 *  {x,y,w,h}. Draw into .inner (clipped to the card). */
export function zoomInset(
  ctx,
  p,
  { src, box, a = {}, col = "var(--ink-2)", title, titleEdit, under },
) {
  const g = h("g", a, p);
  const below = box.y > src.y;
  const sy = below ? src.y + src.h : src.y,
    by = below ? box.y : box.y + box.h;
  h(
    "polygon",
    {
      points: `${src.x},${sy} ${src.x + src.w},${sy} ${box.x + box.w},${by} ${box.x},${by}`,
      fill: "var(--cone)",
      s: a.s,
      c: a.c,
    },
    under || g,
  );
  h(
    "rect",
    {
      x: src.x,
      y: src.y,
      width: src.w,
      height: src.h,
      rx: 6,
      fill: "none",
      stroke: col,
      "stroke-width": "var(--sw-lead)",
    },
    g,
  );
  h(
    "rect",
    {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: "var(--r-card)",
      fill: "var(--paper)",
      stroke: "var(--rule)",
      "stroke-width": "var(--sw-rule)",
      cls: "lift body",
    },
    g,
  );
  const id = ctx.uid + "-zoom";
  const cp = h("clipPath", { id }, h("defs", {}, g));
  h("rect", { x: box.x, y: box.y, width: box.w, height: box.h }, cp);
  const inner = h("g", { "clip-path": `url(#${id})` }, g);
  if (title)
    editable(T(inner, box.x + 22, box.y + 32, title, "ts-tiny", { cls: "muted" }), titleEdit);
  return { g, inner, box };
}

/** Solid label ground: a paper card behind a label that sits over scenery or lines. */
export const labelGround = (p, box) =>
  h(
    "rect",
    {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: "var(--r-mark)",
      fill: "var(--paper)",
      stroke: "var(--rule)",
      "stroke-width": "var(--sw-hair)",
    },
    p,
  );

/** One-row label lane (names under a band, values on an axis). Finds the nearest free slot to
 *  `centre` within ±shift, keeping `gap` clear of every label already in `lane`. Returns the box
 *  (and pushes it) or null, so the caller can stack, shorten or move the label instead. */
export function lanePlace(
  lane,
  w,
  centre,
  { min = 24, max = 1256, y = 0, h: hh = 32, gap = 28, shift = 90 } = {},
) {
  for (let d = 0; d <= shift; d += 4)
    for (const c0 of d ? [centre - d, centre + d] : [centre]) {
      const c = clamp(c0, min + w / 2, max - w / 2);
      const bb = { x: c - w / 2, y, w, h: hh, cx: c };
      if (!lane.some((q) => bb.x < q.x + q.w + gap && q.x < bb.x + bb.w + gap)) {
        lane.push(bb);
        return bb;
      }
    }
  return null;
}

/* ------------------------------------------------------------------ counters and blocks */
/** A countable disc (Isotype unit). */
export const counter = (p, x, y, r = 16, col = "var(--counter)", a = {}) =>
  h(
    "circle",
    Object.assign(
      {
        cx: x,
        cy: y,
        r,
        fill: col,
        stroke: "var(--counter-edge)",
        "stroke-width": "var(--sw-hair)",
        cls: "body",
      },
      a,
    ),
    p,
  );
/** Ten frame: 2 x 5 cells, filled left to right, top row first. */
export function tenFrame(p, x, y, n, { cell = 64, col = "var(--counter)", a = {}, sFrom } = {}) {
  const g = h("g", a, p);
  h(
    "rect",
    {
      x,
      y,
      width: cell * 5,
      height: cell * 2,
      fill: "var(--paper)",
      stroke: "var(--ink-2)",
      "stroke-width": "var(--sw-struct)",
      rx: "var(--r-mark)",
    },
    g,
  );
  for (let i = 1; i < 5; i++)
    h(
      "line",
      {
        x1: x + i * cell,
        x2: x + i * cell,
        y1: y,
        y2: y + cell * 2,
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-rule)",
      },
      g,
    );
  h(
    "line",
    {
      x1: x,
      x2: x + cell * 5,
      y1: y + cell,
      y2: y + cell,
      stroke: "var(--ink-3)",
      "stroke-width": "var(--sw-rule)",
    },
    g,
  );
  for (let i = 0; i < n; i++)
    counter(
      g,
      x + cell * ((i % 5) + 0.5),
      y + cell * (Math.floor(i / 5) + 0.5),
      cell * 0.34,
      col,
      sFrom != null ? { s: sFrom + i, cls: "body pop" } : {},
    );
  return g;
}
/** Base-ten blocks: 'one' cube, 'ten' rod, 'hundred' flat. u = cube size. Flat planes, one shade face. */
export function baseTen(p, kind, x, y, { u = 14, a = {} } = {}) {
  const g = h("g", a, p);
  const col = { one: "var(--pv-ones)", ten: "var(--pv-tens)", hundred: "var(--pv-hundreds)" }[kind];
  const [cw, ch] = kind === "one" ? [1, 1] : kind === "ten" ? [1, 10] : [10, 10];
  h(
    "rect",
    {
      x,
      y,
      width: cw * u,
      height: ch * u,
      fill: col,
      stroke: "var(--shade)",
      "stroke-opacity": 0.35,
      "stroke-width": "var(--sw-hair)",
      cls: "body",
    },
    g,
  );
  for (let i = 1; i < ch; i++)
    h(
      "line",
      {
        x1: x,
        x2: x + cw * u,
        y1: y + i * u,
        y2: y + i * u,
        stroke: "var(--shade)",
        "stroke-opacity": 0.25,
        "stroke-width": 1,
      },
      g,
    );
  for (let i = 1; i < cw; i++)
    h(
      "line",
      {
        x1: x + i * u,
        x2: x + i * u,
        y1: y,
        y2: y + ch * u,
        stroke: "var(--shade)",
        "stroke-opacity": 0.25,
        "stroke-width": 1,
      },
      g,
    );
  return g;
}

/* ------------------------------------------------------------------ axis */
/** Numeric axis with honest spacing. o: {x0,x1,y, d0,d1, step?, fmt?, label?, vertical?, a}. Returns the scale. */
export function axis(p, o) {
  const g = h("g", o.a || {}, p);
  const { x0, x1, y, d0, d1 } = o;
  const S = (v) =>
    o.vertical ? x0 - ((v - d0) / (d1 - d0)) * (x0 - x1) : x0 + ((v - d0) / (d1 - d0)) * (x1 - x0);
  const ticks = o.step
    ? Array.from({ length: Math.floor((d1 - d0) / o.step + 1e-9) + 1 }, (_, i) => d0 + i * o.step)
    : niceTicks(d0, d1, o.count || 8);
  const fmt = o.fmt || ((v) => fmtInt(v));
  if (o.vertical) {
    h(
      "line",
      { x1: y, x2: y, y1: x0, y2: x1, stroke: "var(--axis)", "stroke-width": "var(--sw-struct)" },
      g,
    );
    for (const v of ticks) {
      const yy = S(v);
      h(
        "line",
        {
          x1: y - 10,
          x2: y,
          y1: yy,
          y2: yy,
          stroke: "var(--axis)",
          "stroke-width": "var(--sw-rule)",
        },
        g,
      );
      computed(T(g, y - 16, yy + 8, fmt(v), "ts-axis", { "text-anchor": "end" }), o.computedPath);
    }
  } else {
    h(
      "line",
      { x1: x0, x2: x1, y1: y, y2: y, stroke: "var(--axis)", "stroke-width": "var(--sw-struct)" },
      g,
    );
    for (const v of ticks) {
      const xx = S(v);
      h(
        "line",
        {
          x1: xx,
          x2: xx,
          y1: y,
          y2: y + 10,
          stroke: "var(--axis)",
          "stroke-width": "var(--sw-rule)",
        },
        g,
      );
      computed(T(g, xx, y + 38, fmt(v), "ts-axis", { "text-anchor": "middle" }), o.computedPath);
    }
  }
  if (o.label)
    editable(
      T(g, o.vertical ? y : (x0 + x1) / 2, o.vertical ? x1 - 24 : y + 72, o.label, "ts-small", {
        "text-anchor": "middle",
      }),
      o.labelEdit,
    );
  return S;
}

/* ------------------------------------------------------------------ label placement */
/** Place flag labels so nothing overlaps: no label on a label, a stem, or an obstacle.
 *  items: [{x, w, h, prio?}] (x = the point named; w,h = the label block).
 *  levels: label-BOTTOM y values, lowest first. base: y where stems end (the band).
 *  Scoring prefers low levels and labels that do not cover a neighbour's point (so stems never
 *  cross labels). Each item gets {lx (text x), anchor 'start'|'end', top, box}, or {failed:true}. */
export function placeFlags(
  items,
  {
    levels,
    base,
    minTop = GRID.top,
    obstacles = [],
    left = GRID.left,
    right = GRID.right,
    pad = 12,
    offset = 14,
  } = {},
) {
  const boxes = [],
    stems = [];
  const order = [...items].sort((a, b) => (a.prio || 0) - (b.prio || 0) || a.x - b.x);
  for (const it of order) {
    let best = null;
    for (let li = 0; li < levels.length; li++) {
      const y = levels[li] - it.h;
      if (y < minTop) break;
      for (const side of ["start", "end"]) {
        const lx = side === "start" ? it.x + offset : it.x - offset;
        const x0 = side === "start" ? lx - 6 : lx - it.w - 6;
        const box = { x: x0, y, w: it.w + 12, h: it.h };
        if (box.x < left - 8 || box.x + box.w > right + 8) continue;
        const stem = { x: it.x - 2, y, w: 4, h: (base ?? levels[0]) - y };
        if (
          boxes.some((q) => overlaps(box, q, pad) || overlaps(stem, q, 2)) ||
          stems.some((q) => overlaps(box, q, 4)) ||
          obstacles.some((o) => overlaps(box, o, pad) || overlaps(stem, o, 0))
        )
          continue;
        const covers = order.filter(
          (o) => o !== it && !o.box && !o.failed && o.x > box.x - 10 && o.x < box.x + box.w + 10,
        ).length;
        const cost =
          (levels[0] - levels[li]) / (it.h + pad) + covers * 6 + (side === "end" ? 0.2 : 0);
        if (!best || cost < best.cost) best = { cost, lx, side, li, y, box, stem };
      }
    }
    if (best) {
      Object.assign(it, {
        lx: best.lx,
        anchor: best.side,
        level: best.li,
        top: best.y,
        box: best.box,
      });
      boxes.push(best.box);
      stems.push(best.stem);
    } else it.failed = true;
  }
  return items;
}

/* ------------------------------------------------------------------ landscape layers */
/** Sky: a vertical tint from --sky-top to --sky-bot down to y1. */
export function sky(g, ctx, y1, x0 = 0, x1 = W) {
  const id = ctx.uid + "-sky";
  const lg = h("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, h("defs", {}, g));
  h("stop", { offset: "0", "stop-color": "var(--sky-top)" }, lg);
  h("stop", { offset: "1", "stop-color": "var(--sky-bot)" }, lg);
  return h("rect", { x: x0, y: 0, width: x1 - x0, height: y1, fill: `url(#${id})` }, g);
}
/** A rolling hill line from x0 to x1 with base at yBase, crest height amp, seeded so it is stable. */
export function hills(
  g,
  { x0 = 0, x1 = W, yBase, amp = 40, fill = "var(--hill-far)", seed = 1, bumps = 4, a = {} },
) {
  const r = rng(seed);
  let d = `M${x0} ${yBase}`;
  const n = bumps * 2;
  const pts = Array.from({ length: n + 1 }, (_, i) => [
    x0 + ((x1 - x0) * i) / n,
    yBase - amp * (i % 2 ? 0.55 + 0.45 * r() : 0.1 + 0.3 * r()),
  ]);
  d += ` L${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1],
      [qx, qy] = pts[i];
    d += ` C${px + (qx - px) / 2} ${py} ${px + (qx - px) / 2} ${qy} ${qx} ${qy}`;
  }
  d += ` L${x1} ${yBase} Z`;
  return h("path", Object.assign({ d, fill }, a), g);
}
/** Flat ground strip. */
export const ground = (g, x0, x1, y0, y1, fill = "var(--hill-near)", a = {}) =>
  h("rect", Object.assign({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill }, a), g);
/** Water: three depth bands from the shore. */
export function water(g, x0, x1, y0, y1, a = {}) {
  const w = h("g", a, g);
  const t = (y1 - y0) / 3;
  h("rect", { x: x0, y: y0, width: x1 - x0, height: t, fill: "var(--sea-1)" }, w);
  h("rect", { x: x0, y: y0 + t, width: x1 - x0, height: t, fill: "var(--sea-2)" }, w);
  h(
    "rect",
    { x: x0, y: y0 + 2 * t, width: x1 - x0, height: y1 - y0 - 2 * t, fill: "var(--sea-3)" },
    w,
  );
  return w;
}

/* ------------------------------------------------------------------ figures and objects */
// Generic, flat, one shaded face, keyline only in themes that want one (.body). Each is drawn
// with its base centre at (x, y) and scale s (1 = about 60 u tall).
const OBJ = {
  tree(g) {
    h("rect", { x: -5, y: -34, width: 10, height: 34, fill: "var(--trunk)" }, g);
    h("circle", { cx: 0, cy: -52, r: 26, fill: "var(--canopy)", cls: "body" }, g);
    h("path", { d: "M0 -78 A26 26 0 0 1 0 -26 Z", fill: "var(--canopy-shade)" }, g);
  },
  hut(g) {
    h("rect", { x: -30, y: -26, width: 60, height: 26, fill: "var(--daub)", cls: "body" }, g);
    h("rect", { x: 8, y: -26, width: 22, height: 26, fill: "var(--daub-shade)" }, g);
    h("rect", { x: -9, y: -18, width: 14, height: 18, fill: "var(--hull)" }, g);
    h("polygon", { points: "-42,-22 0,-72 42,-22", fill: "var(--thatch)", cls: "body" }, g);
    h("polygon", { points: "0,-72 42,-22 14,-22", fill: "var(--thatch-shade)" }, g);
  },
  house(g) {
    h("rect", { x: -32, y: -40, width: 64, height: 40, fill: "var(--daub)", cls: "body" }, g);
    h("rect", { x: 10, y: -40, width: 22, height: 40, fill: "var(--daub-shade)" }, g);
    h("polygon", { points: "-38,-38 0,-70 38,-38", fill: "var(--tile)", cls: "body" }, g);
    h("polygon", { points: "0,-70 38,-38 12,-38", fill: "var(--tile-shade)" }, g);
    h("rect", { x: -22, y: -30, width: 12, height: 12, fill: "var(--sky-top)" }, g);
    h("rect", { x: -6, y: -20, width: 12, height: 20, fill: "var(--hull)" }, g);
  },
  temple(g) {
    h("rect", { x: -46, y: -8, width: 92, height: 8, fill: "var(--stone)", cls: "body" }, g);
    for (let i = 0; i < 5; i++)
      h(
        "rect",
        {
          x: -40 + i * 19,
          y: -50,
          width: 8,
          height: 42,
          fill: i > 2 ? "var(--stone-shade)" : "var(--stone)",
        },
        g,
      );
    h("rect", { x: -48, y: -58, width: 96, height: 8, fill: "var(--stone)", cls: "body" }, g);
    h("polygon", { points: "-48,-58 0,-80 48,-58", fill: "var(--stone)", cls: "body" }, g);
    h("polygon", { points: "0,-80 48,-58 0,-58", fill: "var(--stone-shade)" }, g);
  },
  pyramid(g) {
    h("polygon", { points: "-60,0 0,-70 60,0", fill: "var(--sand)", cls: "body" }, g);
    h("polygon", { points: "0,-70 60,0 18,0", fill: "var(--sand-shade)" }, g);
  },
  fort(g) {
    h("rect", { x: -56, y: -36, width: 112, height: 36, fill: "var(--stone)", cls: "body" }, g);
    h("rect", { x: 20, y: -36, width: 36, height: 36, fill: "var(--stone-shade)" }, g);
    for (let x = -56; x < 56; x += 16)
      h("rect", { x, y: -44, width: 9, height: 8, fill: "var(--stone)" }, g);
    h("rect", { x: -8, y: -16, width: 16, height: 16, fill: "var(--hull)" }, g);
  },
  field(g) {
    for (let i = 0; i < 4; i++)
      h(
        "path",
        {
          d: `M${-60 + i * 30} 0 L ${-48 + i * 30} -14 L ${-22 + i * 30} -14 L ${-34 + i * 30} 0 Z`,
          fill: i % 2 ? "var(--hill-near)" : "var(--field)",
        },
        g,
      );
  },
  tent(g) {
    h("polygon", { points: "-34,0 0,-48 34,0", fill: "var(--hide, var(--daub))", cls: "body" }, g);
    h("polygon", { points: "0,-48 34,0 10,0", fill: "var(--daub-shade)" }, g);
    h("polygon", { points: "-6,0 0,-16 6,0", fill: "var(--hull)" }, g);
  },
  tower(g) {
    h("rect", { x: -26, y: -96, width: 52, height: 96, fill: "var(--metal)", cls: "body" }, g);
    h("rect", { x: 6, y: -96, width: 20, height: 96, fill: "var(--metal-shade)" }, g);
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 2; c++)
        h(
          "rect",
          { x: -20 + c * 14, y: -88 + r * 15, width: 8, height: 8, fill: "var(--sky-top)" },
          g,
        );
  },
  palm(g) {
    h("path", { d: "M-2 0 Q 2 -30 -4 -60 L 2 -60 Q 8 -30 4 0 Z", fill: "var(--trunk)" }, g);
    for (const [dx, dy] of [
      [-26, -50],
      [26, -50],
      [-18, -68],
      [18, -68],
      [0, -74],
    ])
      h(
        "path",
        {
          d: `M0 -62 Q ${dx / 2} ${dy - 10} ${dx} ${dy}`,
          fill: "none",
          stroke: "var(--canopy)",
          "stroke-width": 7,
          "stroke-linecap": "round",
        },
        g,
      );
  },
  obelisk(g) {
    h("polygon", { points: "-8,0 -6,-74 0,-84 6,-74 8,0", fill: "var(--sand)", cls: "body" }, g);
    h("polygon", { points: "0,-84 6,-74 8,0 1,0", fill: "var(--sand-shade)" }, g);
  },
  stones(g) {
    for (const x of [-36, 0, 36]) {
      h("rect", { x: x - 8, y: -44, width: 16, height: 44, fill: "var(--stone)", cls: "body" }, g);
      h("rect", { x: x + 2, y: -44, width: 6, height: 44, fill: "var(--stone-shade)" }, g);
    }
    h("rect", { x: -46, y: -54, width: 56, height: 10, fill: "var(--stone)", cls: "body" }, g);
  },
  person(g, o) {
    const cl = o.cloth || "var(--cloth-1)",
      sk = o.skin || "var(--person-1)";
    h("rect", { x: -9, y: -26, width: 7, height: 26, rx: 3, fill: "var(--ink-2)" }, g);
    h("rect", { x: 2, y: -26, width: 7, height: 26, rx: 3, fill: "var(--ink-2)" }, g);
    h("rect", { x: -13, y: -56, width: 26, height: 34, rx: 9, fill: cl, cls: "body" }, g);
    h("circle", { cx: 0, cy: -66, r: 10, fill: sk, cls: "body" }, g);
  },
};
export const OBJECTS = Object.keys(OBJ);
/** Which objects fit which culture or period. A model may only place objects that fit; when
 *  nothing fits, it shows plain landscape layers (never a wrong object). 'any' fits everywhere. */
export const OBJECT_CULTURES = {
  tree: ["any"],
  field: [
    "neolithic",
    "bronze-age",
    "iron-age",
    "anglo-saxon",
    "medieval",
    "tudor",
    "victorian",
    "modern",
  ],
  tent: ["stone-age"],
  stones: ["neolithic", "bronze-age"],
  hut: ["neolithic", "bronze-age", "iron-age", "early-rome", "anglo-saxon"],
  fort: ["iron-age", "rome"],
  temple: ["greece", "rome"],
  house: ["rome", "tudor", "victorian", "modern"],
  pyramid: ["egypt"],
  obelisk: ["egypt"],
  palm: ["egypt", "desert"],
  tower: ["modern"],
  person: ["any"],
};
export const CULTURES = [
  "none",
  "stone-age",
  "neolithic",
  "bronze-age",
  "iron-age",
  "egypt",
  "greece",
  "early-rome",
  "rome",
  "anglo-saxon",
  "medieval",
  "tudor",
  "victorian",
  "modern",
  "desert",
];
/** Objects that fit a culture, signature object first. [] means plain landscape. */
export function sceneryFor(culture) {
  if (!culture || culture === "none") return [];
  const fit = Object.keys(OBJECT_CULTURES).filter(
    (k) => k !== "person" && OBJECT_CULTURES[k].includes(culture),
  );
  return fit.length ? fit : [];
}
/** Draw a generic object: tree, hut, house, temple, pyramid, fort, field, tent, tower, person. */
export function object(p, kind, x, y, s = 1, a = {}, o = {}) {
  // build classes (rise, pop) set a CSS transform, so they go on an outer group and the placement on an inner one
  const outer = h("g", a, p);
  const g = h("g", { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  (OBJ[kind] || OBJ.tree)(g, o);
  return outer;
}
