/* Plan rig (v3): the v2 drawing model (c-motion-plan-v2/plan-flipbook.js) made continuous, so the
   smooth renderer can evaluate a pose every display frame. Same 3D hinged leaves, projected face,
   arms on the cover edges, pages hinged separately for follow-through, automatic cover smears.
   Changes from v2: every parameter interpolates (eyelids, smile, riffle, the X strokes, the slot),
   and every mark is a <path>, so a frame is attribute updates on a fixed pool of nodes.
   New for directions: a ground slot (entry from below), clipped at the ground line while Plan climbs
   out, and a mirrored-safe turn: yaw and lean change sign, page lines and face are always projected
   from the artwork, so writing is never mirrored. */
(() => {
  const F = 480, EYE_Y = 150, GROUND = 278, TAU = Math.PI * 2, PI = Math.PI;
  const INK = "#293b32", COVER = "#80956f", PAGE = "#d6e2bd";
  const SP = 145, CX = 147, YB = 232;
  const SHAPES = {
    coverL: [[49, 83], [148, 73], [144, 225], [57, 236]],
    coverR: [[148, 73], [244, 91], [236, 234], [144, 225]],
    pageL: [[52, 77], [145, 68], [145, 215], [60, 229]],
    pageR: [[145, 68], [237, 85], [229, 225], [145, 215]],
  };
  const LINES = {
    L: [[[70, 102], [125, 97]], [[72, 113], [114, 109]], [[77, 194], [117, 190]]],
    R: [[[165, 98], [213, 107]], [[165, 109], [202, 117]], [[168, 190], [202, 196]]],
  };
  const EYES = { L: [116, 142], R: [171, 145] };
  const MOUTH = { rest: [[129, 158], [143, 169], [156, 160]], happy: [[127, 157], [144, 176], [160, 159]] };
  const SH = { L: [57, 143], R: [237, 144] }, HIP = { L: [91, 229], R: [198, 228] };

  const f1 = (n) => Math.round(n * 10) / 10;
  const pt = (q) => `${f1(q[0])} ${f1(q[1])}`;
  const clamp01 = (u) => Math.max(0, Math.min(1, u));
  const area = (q) => q.reduce((a, v, j) => { const w = q[(j + 1) % q.length]; return a + v[0] * w[1] - w[0] * v[1]; }, 0) / 2;
  const REST = {
    th: 0, sx: 1, sy: 1, lean: 0, pitch: 0, tx: 0, ty: 0, bob: 0, cL: 0, cR: 0,
    arms: { L: [[-21, 27, 0], [-40, 8, 0]], R: [[22, 28, 0], [44, 4, 0]] },
    legs: { L: [[-9, 40, 0], [-28, 42, 0]], R: [[9, 40, 0], [27, 44, 0]] },
    eyeDx: 0, eyeDy: 0, faceDy: 0, rif: 0, slot: 0,
    // v4 props, all continuous so they interpolate between keys
    watch: 0, hand: 0, ting: 0, map: 0, pin: 0, gpin: 0, trace: 0, flag: 0, gflag: 0, prog: 0, ink: 1, line3: 1,
    // v5 props: gnd (1 = resting on the ground though ty > 0, for the shadow), the ribbon (rib: visible
    // length, ribX/ribY: where its free end is headed, ribS: slack), puff (landing air), spd (slide lines)
    lim: 1, gnd: 0, rib: 0, ribX: 0, ribY: 0, ribS: 0, puff: 0, spd: 0, rd: 0,
  };

  function rig(p) {
    const c = Math.cos(TAU * p.th), s = Math.sin(TAU * p.th), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const ty = p.ty + p.bob;
    const sq = ([x, y]) => { const y2 = YB + (y - YB) * p.sy; return [(x - CX) * p.sx + (YB - y2) * p.lean, y2]; };
    const hinge = ([X, y, z], a, side) => {
      const ax = (SP - CX) * p.sx + (YB - y) * p.lean, d = X - ax, ca = Math.cos(a * PI), sa = Math.sin(a * PI);
      return side === "L" ? [ax + d * ca - z * sa, y, d * sa + z * ca] : [ax + d * ca + z * sa, y, -d * sa + z * ca];
    };
    // z0: the layer's depth offset at rest (covers -4, lines 0.6, face 0.8). Perspective is
    // normalised to it, so the rest pose projects exactly onto the artwork (a clean handoff).
    const proj = ([X, y, z], z0 = 0) => {
      const yy = y - YB, y1 = YB + yy * cp + z * sp, zz = z * cp - yy * sp;
      const x1 = X * c + zz * s, z1 = -X * s + zz * c, k = (F - z0) / (F - z1);
      return [CX + x1 * k + p.tx, EYE_Y + (y1 - EYE_Y) * k + ty, z1];
    };
    const on = (q, z, a, side) => { const [X, y] = sq(q); return proj(hinge([X, y, z], a, side), z); };
    // v4 helpers: a point on the page art (either half, by x), and an arm's wrist
    const aPg = { L: p.pL != null ? p.pL : p.cL, R: p.pR != null ? p.pR : p.cR };
    const page = ([x, y], z = 0.7) => on([x, y], z, x < SP ? aPg.L : aPg.R, x < SP ? "L" : "R");
    const wrist = (side) => { const a = side === "L" ? p.cL : p.cR, sh = sq(SH[side]), [dx, dy, dz] = p.arms[side][1]; return proj(hinge([sh[0] + dx, sh[1] + dy, dz], a, side)); };
    return { sq, hinge, proj, on, page, wrist };
  }

  const S = (w, o) => `stroke="${INK}"${w ? ` stroke-width="${w}"` : ""}${o != null ? ` stroke-opacity="${o}"` : ""}`;
  const pathOf = (q, close) => `M${q.map(pt).join(" L")}${close ? "Z" : ""}`;
  const bez = (q, n) => { const o = []; for (let k = 0; k <= n; k++) { const u = k / n, v = 1 - u; o.push([v * v * q[0][0] + 2 * v * u * q[1][0] + u * u * q[2][0], v * v * q[0][1] + 2 * v * u * q[1][1] + u * u * q[2][1]]); } return o; };
  const blob = (cx, cy, rx, ry, extra) => `<path d="M${f1(cx - rx)} ${f1(cy)}a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(2 * rx)} 0a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(-2 * rx)} 0Z" ${extra}/>`;

  // Draw one pose. Returns { ground, body }: ground marks (route, X, slot) are never clipped at the
  // ground line; the body is, while Plan climbs out of the slot.
  function draw(p, spec, ghosts) {
    const R = rig(p), ground = [], out = [], items = [];
    const aC = { L: p.cL, R: p.cR }, aP = { L: p.pL != null ? p.pL : p.cL, R: p.pR != null ? p.pR : p.cR };

    if (p.route && spec.path) {
      const [a, b] = p.route;
      for (let k = 0; k <= 30; k++) {
        const u = k / 30; if (u < a || u > b) continue;
        const [x, y] = spec.path(u);
        ground.push(blob(CX + x, (spec.routeY || 270) + y, 2.6, 2.6, `fill="${INK}" fill-opacity=".5" stroke="none"`));
      }
    }
    if (p.slot > 0.01) {
      // the slot: a pop-up cut in the ground under the mark, opening as a soft lens
      const w = 108 * Math.min(1, p.slot * 1.4), o = p.slot, x = 152 + (p.slotX || 0), y = GROUND - 2;
      ground.push(`<path d="M${f1(x - w)} ${y}Q${x} ${f1(y - 5 * o)} ${f1(x + w)} ${y}Q${x} ${f1(y + 9 * o)} ${f1(x - w)} ${y}Z" fill="${INK}" fill-opacity="${f1(18 * o) / 100}" ${S(2, f1(0.8 * clamp01(p.slot * 3)))}/>`);
    }
    if (p.markP > 0) {
      // the X, drawn stroke by stroke
      const o = p.markAlpha == null ? 0.7 : p.markAlpha, x = 152, y = GROUND - 3;
      const u1 = clamp01(p.markP), u2 = clamp01(p.markP - 1);
      let d = `M${x - 13} ${y - 5} L${f1(x - 13 + 26 * u1)} ${f1(y - 5 + 10 * u1)}`;
      if (u2 > 0) d += `M${x + 13} ${y - 5} L${f1(x + 13 - 26 * u2)} ${f1(y - 5 + 10 * u2)}`;
      ground.push(`<path d="${d}" ${S(3, f1(o))} fill="none"/>`);
    }
    if (spec.under) ground.push(spec.under(p, R));
    for (const [g, o] of ghosts) {
      const G = rig(g);
      for (const side of ["L", "R"]) {
        const q = SHAPES["cover" + side].map((v) => G.on(v, -4, g["c" + side], side));
        out.push(`<path d="${pathOf(q, 1)}" fill="none" ${S(2, o)}/>`);
        const sh = G.sq(SH[side]), arm = g.arms[side].map(([dx, dy, dz]) => G.proj(G.hinge([sh[0] + dx, sh[1] + dy, dz], g["c" + side], side)));
        out.push(`<path d="M${pt(G.on(SH[side], 0, g["c" + side], side))} Q${pt(arm[0])} ${pt(arm[1])}" fill="none" ${S(2, o)}/>`);
      }
    }

    const pageZ = {};
    const seen = (side) => area(SHAPES["page" + side].map((v) => R.on(v, 0, aP[side], side))) / area(SHAPES["page" + side]) > 0.2;
    const whole = seen("L") && seen("R") ? aP : null; // both halves visible: one mouth stroke across the spine
    const CQ = {}, PQ = {}, CI = {}, PI = {}, ST = {};
    for (const side of ["L", "R"]) {
      // the cover is left open along the spine, as in the artwork (one outline for both covers)
      const cq = SHAPES["cover" + side].map((v) => R.on(v, -4, aC[side], side));
      const open = side === "L" ? [cq[1], cq[0], cq[3], cq[2]] : [cq[0], cq[1], cq[2], cq[3]];
      const cover = { svg: `<path d="${pathOf(open, 0)}" fill="${COVER}" ${S()}/>` };
      items.push(cover); CQ[side] = cq; CI[side] = cover;
      const art = SHAPES["page" + side], pq = art.map((v) => R.on(v, 0, aP[side], side));
      const strength = area(pq) / area(art);
      let svg = `<path d="${pathOf(pq, 1)}" fill="${strength > 0 ? PAGE : COVER}" ${S()}/>`, lines = "";
      PQ[side] = pq; ST[side] = strength;
      if (strength > 0.15) {
        const P = (v) => R.on(v, 0.6, aP[side], side);
        LINES[side].forEach((l, i) => {
          // line3: the bottom line can make way for something written on the page (v4c's route)
          const o = i === 2 ? p.line3 : 1;
          if (o > 0.02) lines += `<path d="M${l.map((v) => pt(P(v))).join(" L")}" ${S(null, o < 0.99 ? f1(o) : null)} fill="none"/>`;
        });
      }
      svg += lines;
      const z = pq.reduce((t, v) => t + v[2], 0) / 4;
      pageZ[side] = z;
      cover.z = z + (strength > 0 ? -0.3 : 0.3);
      // v5: closed with the left half folded over, its cover is the top of the stack whatever the
      // pitch (lying flat, depth order alone can't tell the layers apart)
      if (side === "L" && aC.L < -0.85) cover.z = 1e5;
      PI[side] = { z, svg, lines };
      items.push(PI[side]);
      if (strength > 0.2) items.push({ z: z + 0.02, svg: faceHalf(p, R, side, aP[side], whole) });
    }
    // v6: both halves facing us: draw the cover and the pages as the artwork does, one outline each
    // and one spine line (two outlines meeting at the spine antialias differently: a seam at handoff)
    if (whole && ST.L > 0.2 && ST.R > 0.2 && aC.L > -0.85) {
      const c = CQ, q = PQ;
      CI.L.svg = `<path d="${pathOf([c.L[0], c.R[0], c.R[1], c.R[2], c.R[3], c.L[3]], 1)}" fill="${COVER}" ${S()}/>`;
      CI.L.z = Math.min(CI.L.z, CI.R.z); CI.R.svg = "";
      const zl = Math.min(PI.L.z, PI.R.z), zh = Math.max(PI.L.z, PI.R.z);
      PI.L.svg = `<path d="${pathOf([q.L[0], q.L[1], q.R[1], q.R[2], q.R[3], q.L[3]], 1)}" fill="${PAGE}" ${S()}/><path d="M${pt(q.L[1])} L${pt(q.L[2])}" ${S()}/>` + PI.L.lines;
      PI.L.z = zl; PI.R.svg = PI.R.lines; PI.R.z = zh + 0.001;
    }
    if (whole) items.push({ z: Math.max(pageZ.L, pageZ.R) + 0.03, svg: faceHalf(p, R, "L", aP.L, { ...whole, mouth: 1 }).replace(/^<path[^>]*\/>/, "") });
    // riffle: a continuous phase 0..1; three loose pages turn right to left, one after another
    if (p.rif > 0 && p.rif < 1) {
      for (let k = 0; k < 3; k++) {
        const fr = p.rif * 1.4 - k * 0.2;
        if (fr <= 0.02 || fr >= 0.99) continue;
        const q = SHAPES.pageR.map((v) => R.on(v, 0.3, -fr, "R"));
        const strength = area(q) / area(SHAPES.pageR);
        let svg = `<path d="${pathOf(q, 1)}" fill="${PAGE}" ${S()}/>`;
        if (Math.abs(strength) > 0.25) {
          const P = (v) => R.on(v, 0.9, -fr, "R");
          for (const l of LINES.R.slice(0, 2)) svg += `<path d="M${l.map((v) => pt(P(v))).join(" L")}" ${S()} fill="none"/>`;
        }
        let z = q.reduce((t, v) => t + v[2], 0) / 4;
        if (fr >= 0.85) z = Math.min(z, pageZ.L + 0.01);
        items.push({ z: z + (fr >= 0.85 ? 0 : 0.05), svg });
      }
    }
    const limb = (side, isArm) => {
      const a = aC[side];
      let A, q;
      if (isArm) {
        const sh = R.sq(SH[side]);
        A = R.proj(R.hinge([sh[0], sh[1], 0], a, side));
        q = p.arms[side].map(([dx, dy, dz]) => R.proj(R.hinge([sh[0] + dx, sh[1] + dy, dz], a, side)));
      } else {
        const hp = R.sq(HIP[side]), H = R.hinge([hp[0], hp[1], -2], a, side);
        A = R.proj(H, -2);
        q = p.legs[side].map(([dx, dy, dz]) => R.proj([H[0] + dx, H[1] + dy, H[2] + dz], -2));
      }
      const z = (A[2] + q[0][2] + q[1][2]) / 3;
      const d = isArm ? `M${pt(A)} Q${pt(q[0])} ${pt(q[1])}` : `M${pt(A)} L${pt(q[0])} L${pt(q[1])}`;
      return { z: z <= 6 ? -1e3 + z : 1e3 + z, svg: `<path d="${d}" ${S()} fill="none"/>` };
    };
    if (p.lim > 0.5) items.push(limb("L", 1), limb("R", 1), limb("L", 0), limb("R", 0)); // lim 0: limbs folded away inside the closed book
    if (spec.items) items.push(...spec.items(p, R, { pageZ, aP, aC }));
    items.sort((a, b) => a.z - b.z);
    for (const it of items) out.push(it.svg);
    if (spec.over) out.push(spec.over(p, R));
    return { ground: ground.join(""), body: out.join("") };
  }

  function faceHalf(p, R, side, a, whole) {
    const P = ([x, y]) => R.on([x, y + p.faceDy], 0.8, a, side), o = [];
    const [ex, ey] = EYES[side], x = ex + p.eyeDx, y = ey + p.eyeDy;
    if (p.lid > 0.7) {
      o.push(`<path d="M${pt(P([x - 5, y - 1]))} Q${pt(P([x, y + 4]))} ${pt(P([x + 5, y - 1]))}" ${S()} fill="none"/>`);
    } else {
      // the lid comes down: the dot flattens, then swaps to the closed arc
      const c = P([x, y]), l = P([x - 3, y]), r = P([x + 3, y]), t = P([x, y - 3]), b = P([x, y + 3]);
      const rx = Math.max(0.9, Math.hypot(r[0] - l[0], r[1] - l[1]) / 2), ry = Math.max(0.5, (Math.hypot(b[0] - t[0], b[1] - t[1]) / 2) * (1 - p.lid * 1.1));
      o.push(blob(c[0], c[1], rx, ry, `fill="${INK}" ${S()}`)); // the artwork's eye is a dot with the 2.5 stroke
    }
    const mq = MOUTH.rest.map((v, i) => [v[0] + (MOUTH.happy[i][0] - v[0]) * p.smile, v[1] + (MOUTH.happy[i][1] - v[1]) * p.smile]);
    const m = bez(mq, 40), half = [];
    if (whole) {
      if (side === "R" || !whole.mouth) return o.join("");
      const Q = ([x, y]) => R.on([x, y + p.faceDy], 0.8, x < SP ? whole.L : whole.R, x < SP ? "L" : "R");
      // pages flat: no fold at the spine, so the mouth is the artwork's own curve, projected
      const flat = Math.abs(whole.L) < 0.004 && Math.abs(whole.R) < 0.004;
      const d = flat ? `M${pt(Q(mq[0]))} Q${pt(Q(mq[1]))} ${pt(Q(mq[2]))}` : `M${m.map((v) => pt(Q(v))).join(" L")}`;
      o.push(`<path d="${d}" ${S()} fill="none"/>`);
      return o.join("");
    }
    for (let k = 0; k < m.length; k++) {
      const v = m[k], inL = v[0] < SP;
      if ((side === "L") === inL) half.push(v);
      const w = m[k + 1];
      if (w && (v[0] < SP) !== (w[0] < SP)) { const u = (SP - v[0]) / (w[0] - v[0]); half.push([SP, v[1] + (w[1] - v[1]) * u]); }
    }
    if (half.length > 1) o.push(`<path d="M${half.map((v) => pt(P(v))).join(" L")}" ${S()} fill="none"/>`);
    return o.join("");
  }

  // ---------- continuous timeline
  const ease = { lin: (u) => u, in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u), inout: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)), snap: () => 1 };
  function lerp(a, b, u) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerp(v, b[i], u));
    if (a && b && typeof a === "object") { const o = {}; for (const k in a) o[k] = k in b ? lerp(a[k], b[k], u) : a[k]; return o; }
    return u < 1 ? a : b;
  }
  const cache = new WeakMap();
  function resolved(spec) {
    let r = cache.get(spec);
    if (r) return r;
    r = spec.keys.map((k) => {
      const o = Object.assign(structuredClone(REST), structuredClone(k));
      if (o.pL == null) o.pL = o.cL;
      if (o.pR == null) o.pR = o.cR;
      if (o.lid == null) o.lid = o.eyes === "closed" ? 1 : 0;
      if (o.smile == null) o.smile = o.mouth === "happy" ? 1 : 0;
      delete o.eyes; delete o.mouth; delete o.t; delete o.ease;
      return o;
    });
    cache.set(spec, r);
    return r;
  }
  function poseAt(spec, t) {
    const keys = spec.keys, res = resolved(spec);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
    const u = Math.min(1, Math.max(0, (t - keys[i].t) / (keys[i + 1].t - keys[i].t)));
    const p = lerp(res[i], res[i + 1], ease[keys[i + 1].ease || "inout"](u));
    return spec.mod ? spec.mod(p, t) : p;
  }

  window.PlanRig = { draw, poseAt, REST, GROUND, CX, SP, INK, COVER, PAGE, SHAPES, util: { f1, pt, S, blob, pathOf, clamp01 } };
})();
