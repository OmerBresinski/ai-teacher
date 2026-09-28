/* The Check character's rig for the closing CTA (UX rulings 114 and 115). Four parts, each its own
   scope: the drawing engine (CheckFlipbook: a sheet with glasses, a tick and limbs, redrawn every
   frame; at rest it is the artwork), the pose kit (CheckKit), the v5c entrance keys (CheckMotion:
   out from behind a margin line, a stop, a held look over the glasses, the push, the drawn tick
   and a contained stamp; no frame shake) and the per-frame timeline (CheckSmooth). The player that
   drives it at rest and on the page is assets/closing-check.js; the node pool and the easing
   helpers are shared with the Slides player (Flipbook.kit). */
/* Check v4: v3's engine plus four drawn props for the v4 concepts: brows (one can rise), a heel
   click, a graduated ruler along the ground or up a plumb, a ruled margin line that it steps out
   from behind (the renderer clips at it), and ruled stamp strokes around a stamped tick.
   Check v3: the v2 drawing engine (below), now driven by a smooth renderer (check-smooth.js) that
   evaluates poses every display frame. v3 additions here: rules trail in any direction (rdir),
   smear multiples take a rounded count, a ruled floor slot for the entry from below, and draw()
   is exported for the renderer.
   Check flipbook: c-motion-kit/cast-flipbook.js narrowed to Check and extended for a drawn performance.
   Additions over the cast engine:
   - an exposure sheet (spec.sheet: [[drawing, exposures on 24 fps], ...]) so every drawing and every
     hold is placed by hand, the way an animator times an X-sheet, instead of being read off keys;
   - `drop` lowers the body onto bent knees while the feet stay planted (crouch, contact);
   - `bulge` bows the sheet edges in or out (squash and stretch are redrawn shapes, as in Slides);
   - legs take [knee, ankle, toe] so knees can bend; arms take a z so a hand can reach in front;
   - smear multiples, trailing rule lines, contact marks, ground marks, a lens glint, happy eyes,
     tilted glasses that slip (follow-through) and a flare that fans up and right only.
   Same mount(actor, spec, { region, shake }) as homepage/motion/flipbook.js. */
(() => {
  const F = 480,
    EYE_Y = 150,
    GROUND = 278,
    FLOOR = 281;
  const INK = "#293b32",
    CREAM = "#faf5df";
  const TAU = Math.PI * 2;
  const f1 = (n) => Math.round(n * 10) / 10;
  const pt = (q) => `${f1(q[0])} ${f1(q[1])}`;
  const rnd = (seed) => {
    const x = Math.sin(seed * 999.7) * 43758.5453;
    return x - Math.floor(x);
  };

  // Check's real artwork (characters.js `answers`, same paths as master's cast artwork).
  const M = {
    cx: 147,
    yb: 228,
    edge: 14,
    layers: [
      {
        name: "back",
        pts: [
          [82, 78],
          [208, 73],
          [218, 229],
          [91, 234],
        ],
        z: -9,
        fill: "#d6846c",
        back: "#d6846c",
      },
      {
        name: "front",
        pts: [
          [77, 70],
          [202, 65],
          [212, 221],
          [86, 226],
        ],
        z: 0,
        fill: "#efa991",
        back: "#d6846c",
        main: true,
      },
    ],
    rule: [
      [99, 93],
      [178, 89],
    ],
    tick: [
      [122, 188],
      [133, 198],
      [156, 174],
    ],
    face: {
      c: [147, 140],
      eyes: [
        [126, 132],
        [169, 130],
      ],
      r: 2,
      mouth: [
        [143, 153],
        [151, 159],
        [159, 152],
      ],
      happy: [
        [140, 152],
        [152, 166],
        [163, 150],
      ],
      rings: [
        [125, 132, 14],
        [168, 130, 14],
      ],
      lines: [
        [
          [139, 131],
          [154, 130],
        ],
        [
          [112, 131],
          [83, 132],
        ],
        [
          [182, 130],
          [204, 129],
        ],
      ],
    },
    shoulders: { L: [84, 150], R: [220, 151] },
    hips: { L: [115, 223], R: [180, 222] },
    arms: {
      L: [
        [55, 169, 0],
        [44, 146, 0],
      ],
      R: [
        [249, 158, 0],
        [247, 123, 0],
      ],
    },
    legs: {
      L: [
        [119, 268, 0],
        [99, 272, 0],
      ],
      R: [
        [178, 266, 0],
        [199, 272, 0],
      ],
    },
  };

  const REST = {
    th: 0,
    head: null,
    sx: 1,
    sy: 1,
    lean: 0,
    bulge: 0,
    drop: 0,
    tx: 0,
    ty: 0,
    glassesY: 0,
    glassesTilt: 0,
    tick: 1,
    eyeDx: 0,
    eyeDy: 0,
    // the artwork's own mouth (the page hides its happy mouth), so the rest drawing is the artwork
    arms: M.arms,
    legs: M.legs,
    mouth: "rest",
    eyes: "dot",
  };
  const spot = (th) => {
    const u = th - Math.floor(th);
    return u <= 0.2 || u >= 0.8 ? 0 : null;
  };

  function poly(q, bulge, attrs) {
    if (!bulge) return `<path d="M${q.map(pt).join(" L")}Z" ${attrs}/>`;
    const cx = q.reduce((a, v) => a + v[0], 0) / q.length,
      cy = q.reduce((a, v) => a + v[1], 0) / q.length;
    let d = `M${pt(q[0])}`;
    for (let i = 0; i < q.length; i++) {
      const a = q[i],
        b = q[(i + 1) % q.length];
      const mx = (a[0] + b[0]) / 2,
        my = (a[1] + b[1]) / 2,
        len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let nx = -(b[1] - a[1]) / len,
        ny = (b[0] - a[0]) / len;
      if (nx * (mx - cx) + ny * (my - cy) < 0) {
        nx = -nx;
        ny = -ny;
      }
      d += ` Q${f1(mx + nx * bulge * len)} ${f1(my + ny * bulge * len)} ${pt(b)}`;
    }
    return `<path d="${d}Z" ${attrs}/>`;
  }

  function rig(p) {
    const cx = M.cx,
      c = Math.cos(TAU * p.th),
      s = Math.sin(TAU * p.th);
    const body = ([x, y], z = 0) => {
      const y2 = M.yb + (y - M.yb) * p.sy + p.drop;
      return [(x - cx) * p.sx + (M.yb - y2) * p.lean, y2, z];
    };
    const proj = ([X, y, z]) => {
      // perspective comes only from the turn: a layer's own depth doesn't scale it when front-on,
      // so the rest drawing lands on the page art exactly (v2 shrank the back sheet by 2%)
      const x1 = X * c + z * s,
        z1 = -X * s + z * c,
        k = F / (F - (z1 - z));
      return [cx + x1 * k + p.tx, EYE_Y + (y - EYE_Y) * k + p.ty, z1];
    };
    return {
      c,
      s,
      B: (q, z) => proj(body(q, z)),
      free: ([x, y, z = 0], dy = 0) => proj([x - cx, y + dy, z]),
    };
  }

  const S = (w, o) =>
    `stroke="${INK}"` +
    (w ? ` stroke-width="${w}"` : "") +
    (o != null ? ` stroke-opacity="${o}"` : "");

  function draw(p, i) {
    const { s, B, free } = rig(p);
    const out = [],
      items = [];
    const area = (q) =>
      q.reduce((a, v, j) => {
        const w = q[(j + 1) % q.length];
        return a + v[0] * w[1] - w[0] * v[1];
      }, 0) / 2;

    // ground shadow: thins and shrinks with height
    const h = Math.min(1, Math.max(0, -p.ty / 120));
    // the site's ground shadow (the ambient cast draws the same one under every character): a flat
    // ellipse at 8 %, no blur. Rounded to half a unit so the breath does not repaint it for nothing.
    const srx = Math.round(2 * 80 * (1 - h * 0.5) * (1 + (p.sx - 1) * 0.8)) / 2;
    const so = Math.round(80 * (1 - h * 0.6) * (p.shade != null ? p.shade : 1)) / 1000;
    out.push(
      `<ellipse cx="${f1(M.cx + 3 + p.tx)}" cy="${GROUND + 1}" rx="${f1(srx)}" ry="${f1(srx * 0.05)}" fill="${INK}" stroke="none" opacity="${so}"/>`,
    );
    if (p.marks) groundMarks(out, p.marks);
    if (Math.abs(p.ruler || 0) > 1) ruler(out, p.ruler, p.rulerA != null ? p.rulerA : 1);
    if ((p.vruler || 0) > 1) vruler(out, p.vruler);
    if ((p.wingA || 0) > 0.02) wing(out, p);
    if (p.rules) rules(out, p, i);
    if (p.smear && Math.round(p.smear.n || 0) > 0) smear(out, p);

    // sheets, far to near, with the thickness strip on the side turned toward us
    const facing = {};
    for (const L of M.layers) {
      const q = L.pts.map((v) => B(v, L.z));
      const strength = area(q) / area(L.pts);
      facing[L.name] = strength;
      let svg = poly(q, p.bulge, `fill="${strength > 0 ? L.fill : L.back}" ${S()}`);
      if (L.main && strength > 0.12) svg += details(p, B);
      items.push({ z: q.reduce((a, v) => a + v[2], 0) / q.length + L.z * 0.02, svg, name: L.name });
      if (L.main && M.edge && Math.abs(s) > 0.05) {
        const X = L.pts.map((v) => v[0]);
        const [a, b] = [...L.pts.keys()].sort((u, v) => (s > 0 ? X[u] - X[v] : X[v] - X[u]));
        const e = [
          B(L.pts[a], L.z),
          B(L.pts[b], L.z),
          B(L.pts[b], L.z - M.edge),
          B(L.pts[a], L.z - M.edge),
        ];
        items.push({
          z: e.reduce((t, v) => t + v[2], 0) / 4 - 0.01,
          svg: `<path d="M${e.map(pt).join(" L")}Z" fill="${CREAM}" ${S()}/>`,
        });
      }
    }
    const head = p.head != null ? p.head : spot(p.th);
    if (head != null && facing.front > 0.12) {
      const zTop = Math.max(...items.filter((it) => it.name === "front").map((it) => it.z)) + 0.001;
      items.push({ z: zTop, svg: face(p, B, head) });
    }
    // limbs: arms ride the body's drop; legs keep their feet planted
    const limb = (anchor, pts, isArm) => {
      const a = B(anchor, 0),
        q = pts.map((v) => free(v, isArm ? p.drop : 0));
      const z = (a[2] + q.reduce((t, v) => t + v[2], 0)) / (q.length + 1);
      const d = isArm ? `M${pt(a)} Q${pt(q[0])} ${pt(q[1])}` : `M${pt(a)} L${q.map(pt).join(" L")}`;
      return {
        z: z <= 4 ? -1e3 + z : 1e3 + z,
        svg: `<path class="limb" d="${d}" ${S()} fill="none"/>`,
      };
    };
    items.push(
      limb(M.shoulders.L, p.arms.L, 1),
      limb(M.shoulders.R, p.arms.R, 1),
      limb(M.hips.L, p.legs.L, 0),
      limb(M.hips.R, p.legs.R, 0),
    );
    items.sort((a, b) => a.z - b.z);
    for (const it of items) out.push(it.svg);

    if (p.slot > 0.02) slot(out, p);
    if (p.contact > 0 && p.contact < 0.99) contact(out, p);
    if ((p.click || 0) > 0.02) click(out, p);
    if ((p.stampFx || 0) > 0.02 && p.stampFx < 0.99) stampFx(out, p, B);
    if (p.spark != null && p.spark < 1) spark(out, p, B);
    return out.join("");
  }

  function details(p, B) {
    const q = (v) => B(v, 0.6);
    let o = `<path d="M${M.rule.map((v) => pt(q(v))).join(" L")}" ${S()} fill="none"/>`;
    const t = Math.max(0, Math.min(1, p.tick));
    if (t > 0) {
      const [a, b, c] = M.tick,
        l1 = Math.hypot(b[0] - a[0], b[1] - a[1]),
        l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      let len = t * (l1 + l2);
      const pts = [a];
      if (len <= l1)
        pts.push([a[0] + ((b[0] - a[0]) * len) / l1, a[1] + ((b[1] - a[1]) * len) / l1]);
      else {
        len -= l1;
        pts.push(b, [b[0] + ((c[0] - b[0]) * len) / l2, b[1] + ((c[1] - b[1]) * len) / l2]);
      }
      o += `<path d="M${pts.map((v) => pt(q(v))).join(" L")}" ${S(4)} fill="none"/>`;
    }
    return o;
  }

  function face(p, B, head) {
    const f = M.face,
      ctr = B(f.c, 0.8);
    const kx = Math.cos(TAU * head) * p.sx,
      ky = p.sy,
      shift = Math.sin(TAU * head) * 22;
    const at = ([x, y], dy = 0) => [
      ctr[0] + shift + (x - f.c[0]) * kx,
      ctr[1] + (y - f.c[1] + dy) * ky,
    ];
    const o = [];
    const eyes = f.eyes.map((e) => at([e[0] + p.eyeDx, e[1] + p.eyeDy]));
    if (p.eyes === "closed")
      for (const e of eyes)
        o.push(
          `<path d="M${f1(e[0] - 4)} ${f1(e[1])} L${f1(e[0] + 4)} ${f1(e[1])}" ${S(2)} fill="none"/>`,
        );
    else if (p.eyes === "happy")
      for (const e of eyes)
        o.push(
          `<path d="M${f1(e[0] - 5)} ${f1(e[1] + 2)} Q${f1(e[0])} ${f1(e[1] - 5)} ${f1(e[0] + 5)} ${f1(e[1] + 2)}" ${S(2)} fill="none"/>`,
        );
    else {
      const r = p.eyes === "wide" ? f.r + 1 : f.r,
        ry = p.eyes === "wide" ? 1.2 : p.eyes === "half" ? 0.5 : 1; // half: the lid halfway, in a blink
      for (const e of eyes)
        o.push(
          `<ellipse cx="${f1(e[0])}" cy="${f1(e[1] + (p.eyes === "half" ? 0.6 : 0))}" rx="${f1(r * (p.eyes === "half" ? 1.2 : 1) * Math.max(0.4, Math.abs(kx)))}" ry="${f1(r * ry)}" fill="${INK}" stroke="none"/>`,
        ); // stroked like the art's eyes
    }
    // brows: absent from the rest art; they cut in for a look and cut out again. browUp lifts the right one
    if (p.brows >= 0.5) {
      const up = p.browUp || 0;
      for (const [k, e] of eyes.entries()) {
        const lift = k === 1 ? up : 0,
          y = e[1] - 11 - 11 * lift,
          w = 9;
        o.push(
          `<path d="M${f1(e[0] - w)} ${f1(y + (k === 1 ? 2 * lift : 0))} L${f1(e[0] + w)} ${f1(y - (k === 1 ? 3 * lift : 0))}" ${S(2.8)} fill="none"/>`,
        );
      }
    }
    // glasses: slip down and tilt as a follow-through piece, pushed back up by hand
    const gc = [146.5, 131],
      tl = p.glassesTilt,
      co = Math.cos(tl),
      si = Math.sin(tl);
    const g = ([x, y]) => {
      const dx = x - gc[0],
        dy = y - gc[1];
      return at([gc[0] + dx * co - dy * si, gc[1] + dx * si + dy * co], p.glassesY);
    };
    for (const [x, y, r] of f.rings) {
      const c = g([x, y]);
      o.push(
        `<ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(r * Math.max(0.3, Math.abs(kx)))}" ry="${f1(r * ky)}" fill="none" ${S()}/>`,
      );
    }
    for (const [a, b] of f.lines)
      o.push(`<path d="M${pt(g(a))} L${pt(g(b))}" ${S()} fill="none"/>`);
    if (p.glint) {
      const c = g([f.rings[1][0], f.rings[1][1]]),
        k = p.glint;
      o.push(
        `<path d="M${f1(c[0] + 2)} ${f1(c[1] - 8)} L${f1(c[0] + 8)} ${f1(c[1] - 2)}M${f1(c[0] - 1)} ${f1(c[1] - 4)} L${f1(c[0] + 4)} ${f1(c[1] + 1)}" stroke="#fff" stroke-width="${f1(3 * k)}" fill="none"/>`,
      );
      const s2 = g([f.rings[1][0] + 22, f.rings[1][1] - 20]),
        r = 10 * k;
      o.push(
        `<path d="M${f1(s2[0])} ${f1(s2[1] - r)} L${f1(s2[0])} ${f1(s2[1] + r)}M${f1(s2[0] - r)} ${f1(s2[1])} L${f1(s2[0] + r)} ${f1(s2[1])}M${f1(s2[0] - r * 0.45)} ${f1(s2[1] - r * 0.45)} L${f1(s2[0] + r * 0.45)} ${f1(s2[1] + r * 0.45)}M${f1(s2[0] + r * 0.45)} ${f1(s2[1] - r * 0.45)} L${f1(s2[0] - r * 0.45)} ${f1(s2[1] + r * 0.45)}" ${S(2.2)} fill="none"/>`,
      );
    }
    if (p.mouth === "happy")
      o.push(
        `<path d="M${pt(at(f.happy[0]))} Q${pt(at(f.happy[1]))} ${pt(at(f.happy[2]))}" ${S()} fill="none"/>`,
      );
    else if (p.mouth === "flat")
      o.push(`<path d="M${pt(at([145, 155]))} L${pt(at([157, 154]))}" ${S()} fill="none"/>`);
    else if (p.mouth === "tight")
      o.push(`<path d="M${pt(at([148, 155]))} L${pt(at([154, 155]))}" ${S()} fill="none"/>`);
    else if (p.mouth === "o") {
      const c = at([151, 156]);
      o.push(`<ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="3" ry="3.6" fill="none" ${S()}/>`);
    } else
      o.push(
        `<path d="M${pt(at(f.mouth[0]))} Q${pt(at(f.mouth[1]))} ${pt(at(f.mouth[2]))}" ${S()} fill="none"/>`,
      );
    return o.join("");
  }

  // ---------- effects (all crisp, straight strokes: Check's marks are ruled, never scribbled)
  function smear(out, p) {
    // multiples: the sheet outline and arms repeated along the path it just travelled
    const n = Math.round(p.smear.n || 0);
    for (let k = n; k >= 1; k--) {
      const g = {
        ...p,
        tx: p.tx + p.smear.dx * k,
        ty: p.ty + (p.smear.dy || 0) * k,
        th: p.th + (p.smear.dth || 0) * k,
      };
      const { B, free } = rig(g),
        o = f1(0.42 - k * 0.12);
      const front = M.layers[1].pts.map((v) => B(v, 0));
      out.push(poly(front, p.bulge, `fill="none" ${S(2, o)}`));
      for (const side of ["L", "R"]) {
        const a = B(M.shoulders[side], 0),
          q = p.arms[side].map((v) => free(v, p.drop));
        out.push(`<path d="M${pt(a)} Q${pt(q[0])} ${pt(q[1])}" fill="none" ${S(2, o)}/>`);
      }
    }
  }
  function rules(out, p, i) {
    // three ruled speed lines trailing behind, evenly spaced like lines on a page.
    // rdir: 1 trails right (moving left), -1 trails left, "up" trails above a fall, "down" below a pop
    const d = p.rdir || 1;
    if (d === "up" || d === "down") {
      for (let k = 0; k < 3; k++) {
        const x = M.cx + p.tx - 42 + k * 42,
          len = p.rules * (54 + (k === 1 ? 30 : 0)) + rnd(k + i) * 6;
        let y0 = d === "up" ? 58 + p.ty - 6 - k * 3 : 236 + p.ty + 8 + k * 3,
          y1 = d === "up" ? y0 - len : y0 + len;
        if (d === "down") {
          y1 = Math.min(y1, GROUND - 2);
          if (y1 - y0 < 4) continue;
        }
        out.push(`<path d="M${f1(x)} ${f1(y0)} L${f1(x)} ${f1(y1)}" ${S(2.2, 0.6)} fill="none"/>`);
      }
      return;
    }
    const x0 = M.cx + p.tx + 78 * d;
    for (let k = 0; k < 3; k++) {
      const y = 104 + k * 42 + p.ty + p.drop * 0.5,
        len = p.rules * (70 + (k === 1 ? 40 : 0)) + rnd(k + i) * 10;
      out.push(
        `<path d="M${f1(x0 + d * (6 + k * 4))} ${f1(y)} L${f1(x0 + d * (6 + k * 4 + len))} ${f1(y)}" ${S(2.2, 0.6)} fill="none"/>`,
      );
    }
  }
  function slot(out, p) {
    // the ruled slot Check pops up out of: a straight line on the floor, drawn over the cut
    const w = 86 * p.slot,
      x = M.cx + 4 + (p.slotX || 0);
    out.push(`<path d="M${f1(x - w)} ${FLOOR} L${f1(x + w)} ${FLOOR}" ${S(2.4)} fill="none"/>`);
  }
  function contact(out, p) {
    // short straight impact strokes out from each foot, flat along the ground
    const k = p.contact,
      x = M.cx + p.tx;
    for (const [fx, dir] of [
      [-52, -1],
      [56, 1],
    ]) {
      const bx = x + fx + dir * 10;
      out.push(
        `<path d="M${f1(bx + dir * 4 * k)} ${GROUND - 8} L${f1(bx + dir * (4 + 18 * k))} ${GROUND - 14 - 6 * k}M${f1(bx + dir * 6 * k)} ${GROUND - 1} L${f1(bx + dir * (8 + 20 * k))} ${GROUND - 1}" ${S(2.2, f1(1 - k))} fill="none"/>`,
      );
    }
  }
  function ruler(out, len, a) {
    // a graduated rule along the ground from the mark toward the entry side: minor every 10, major every 50
    const X = M.cx + 4,
      y = GROUND + 6,
      L = len * a,
      d = Math.sign(L);
    if (Math.abs(L) < 1) return;
    let o = `M${f1(X)} ${y} L${f1(X + L)} ${y}`;
    for (let u = 10; u <= Math.abs(L) + 0.1; u += 10) {
      const h = u % 50 ? 4 : 8;
      o += `M${f1(X + d * u)} ${y} L${f1(X + d * u)} ${y - h}`;
    }
    o += `M${f1(X + L)} ${y + 1} L${f1(X + L)} ${y - 14}`; // the end stop
    out.push(`<path d="${o}" ${S(2, 0.5)} fill="none"/>`);
  }
  function vruler(out, len) {
    // a plumb rule rising from the mark: the line it comes down (or up)
    const X = M.cx + 4,
      y0 = GROUND + 6;
    let o = `M${f1(X)} ${y0} L${f1(X)} ${f1(y0 - len)}`;
    for (let u = 20; u <= len; u += 20) {
      const h = u % 100 ? 4 : 8;
      o += `M${f1(X)} ${f1(y0 - u)} L${f1(X + h)} ${f1(y0 - u)}`;
    }
    out.push(`<path d="${o}" ${S(2, 0.4)} fill="none"/>`);
  }
  function wing(out, p) {
    // the margin line it steps out from behind: ruled up from the ground, ruled away again once it's clear
    const X = M.cx + p.wing,
      y0 = GROUND + 6,
      y1 = y0 - 230 * p.wingA;
    out.push(`<path d="M${f1(X)} ${y0} L${f1(X)} ${f1(y1)}" ${S(2, 0.45)} fill="none"/>`);
  }
  function click(out, p) {
    // the heel click: three short ruled strokes fanned up from the heels, nothing else
    const k = p.click,
      x = M.cx + 1 + p.tx + (p.clickX || 0),
      y = GROUND - 4;
    for (const a of [-0.62, -0.5, -0.38]) {
      const r0 = 9 + 12 * k,
        r1 = r0 + 9 + 5 * (1 - k),
        c = Math.cos(Math.PI * a * 2),
        s2 = Math.sin(Math.PI * a * 2);
      out.push(
        `<path d="M${f1(x + c * r0)} ${f1(y + s2 * r0)} L${f1(x + c * r1)} ${f1(y + s2 * r1)}" ${S(2.2, f1(1 - k * k * 0.9))} fill="none"/>`,
      );
    }
  }
  function stampFx(out, p, B) {
    // a stamped tick: ruled strokes out from its box, one per side, like a rubber stamp's bite
    const k = p.stampFx,
      [a, b, c] = M.tick.map((v) => B(v, 1));
    const x0 = Math.min(a[0], b[0], c[0]) - 6,
      x1 = Math.max(a[0], b[0], c[0]) + 6,
      y0 = Math.min(a[1], c[1]) - 6,
      y1 = b[1] + 6;
    const r = 5 + 12 * k,
      l = 11,
      al = f1(1 - k * 0.85),
      cy = (y0 + y1) / 2,
      q = 0.7;
    const o =
      `M${f1(x0 - r)} ${f1(cy)} L${f1(x0 - r - l)} ${f1(cy)}M${f1(x1 + r)} ${f1(cy)} L${f1(x1 + r + l)} ${f1(cy)}` +
      `M${f1(x0 - r * q)} ${f1(y0 - r * q)} L${f1(x0 - (r + l) * q)} ${f1(y0 - (r + l) * q)}M${f1(x1 + r * q)} ${f1(y0 - r * q)} L${f1(x1 + (r + l) * q)} ${f1(y0 - (r + l) * q)}`;
    out.push(`<path d="${o}" ${S(2.4, al)} fill="none"/>`);
  }
  function groundMarks(out, marks) {
    // a small ruled notch where each foot came down: three equal marks, a ruler's worth
    for (const [x, a] of marks) {
      if (a <= 0) continue;
      const X = M.cx + 4 + x;
      out.push(
        `<path d="M${f1(X - 9)} ${GROUND + 6} L${f1(X + 9)} ${GROUND + 6}M${f1(X)} ${GROUND + 1} L${f1(X)} ${GROUND + 11}" ${S(2, f1(a * 0.55))} fill="none"/>`,
      );
    }
  }
  function spark(out, p, B) {
    // a crisp flare off the end of the tick: four equal strokes, fanned up and to the right only
    const c = B(M.tick[2], 1),
      r = p.spark;
    for (let k = 0; k < 4; k++) {
      const a = -Math.PI * (0.04 + k * 0.1),
        r0 = 7 + 16 * r,
        r1 = r0 + 10 * (1 - r) + 4;
      out.push(
        `<path d="M${f1(c[0] + Math.cos(a) * r0)} ${f1(c[1] + Math.sin(a) * r0)} L${f1(c[0] + Math.cos(a) * r1)} ${f1(c[1] + Math.sin(a) * r1)}" ${S(2.6, f1(1 - r * r))} fill="none"/>`,
      );
    }
  }

  // ---------- exposure sheet -> stepped timeline
  const full = (p) => Object.assign(structuredClone(REST), p);
  window.CheckFlipbook = { model: M, REST, GROUND, FLOOR, draw: (p, i = 0) => draw(p, i), full };
})();

// Check v4 kit: the pieces the three v4 concepts share (identical copy in v4a, v4b and v4c).
// Keys sit on a 24 fps exposure sheet: put(drawing, exposures, opts). The renderer (check-smooth.js)
// holds a key for its extra exposures, then interpolates to the next every display frame; `snap`
// keys are cut to in one frame (the stepped accents). Everything is authored entering from the
// right; flipForLeft() redraws the approach for the left (limbs swap sides, turns flip) and leaves
// the front-on finale alone, so the tick and glasses are never mirrored.
(() => {
  const FB = window.CheckFlipbook,
    M = FB.model,
    FR = 1000 / 24;

  // arms: hanging at the sides (v3), and held straight down, tight to the sheet (at attention)
  const SIDES = {
    L: [
      [70, 186, 0],
      [64, 204, 0],
    ],
    R: [
      [232, 186, 0],
      [238, 204, 0],
    ],
  };
  const TIGHT = {
    L: [
      [80, 184, 0],
      [79, 210, 0],
    ],
    R: [
      [224, 184, 0],
      [225, 210, 0],
    ],
  };
  // legs at attention, heels together: front-on (toes out) and in the three-quarter travel view (toes lead)
  const ATTF = {
    L: [
      [136, 247, 0],
      [140, 271, 0],
      [125, 274, 0],
    ],
    R: [
      [159, 247, 0],
      [155, 271, 0],
      [170, 274, 0],
    ],
  };
  const ATT3 = {
    L: [
      [126, 247, 0],
      [130, 271, 0],
      [114, 273, 0],
    ],
    R: [
      [150, 247, 0],
      [146, 271, 0],
      [131, 273, 0],
    ],
  };
  const HIP3 = { L: 120, R: 175 }; // hips as the three-quarter turn projects them

  // a walking leg in three-quarter view, toes leading left: ankle x in body coordinates
  function walkLeg(side, ax, phase) {
    const hx = HIP3[side],
      kx = (hx + ax) / 2;
    if (phase === "heel")
      return [
        [kx - 1, 246, 0],
        [ax, 270, 0],
        [ax - 15, 264, 0],
      ];
    if (phase === "toe")
      return [
        [kx + 3, 247, 0],
        [ax, 265, 0],
        [ax - 12, 274, 0],
      ];
    if (phase === "lift")
      return [
        [kx - 7, 241, 0],
        [ax, 258, 0],
        [ax - 15, 260, 0],
      ];
    return [
      [kx - 2, 247, 0],
      [ax, 271, 0],
      [ax - 16, 273, 0],
    ]; // plant
  }
  // a front-on leg for the sidestep: toes out, lifted a little off the ground mid-step
  function sideLeg(side, ax, lift = 0) {
    const hx = side === "L" ? 115 : 180,
      o = side === "L" ? -1 : 1,
      kx = (hx + ax) / 2 + 2 * o;
    return [
      [kx, 247 - 4 * lift, 0],
      [ax, 271 - 9 * lift, 0],
      [ax + 15 * o, 274 - 9 * lift, 0],
    ];
  }

  const G = (gy = 0) => ({ glassesY: gy, glassesTilt: gy * 0.011 });

  function sheet() {
    const keys = [],
      marks = [],
      shake = [];
    const X = { keys, marks, shake, frame: 0, impact: 0 };
    X.put = (d, x = 1, o = {}) => {
      keys.push({ d, t: X.frame * FR, hold: (x - 1) * FR, ...o });
      X.frame += x;
    };
    X.now = () => X.frame * FR;
    return X;
  }

  // ---- redraw the approach for the other side
  const mirror = (o) => ({
    L: o.R.map(([x, y, z]) => [294 - x, y, z]),
    R: o.L.map(([x, y, z]) => [294 - x, y, z]),
  });
  function flipForLeft(X, frontAt) {
    X.keys.forEach((k, i) => {
      if (i >= frontAt) return;
      const d = { ...k.d };
      for (const f of ["tx", "th", "head", "lean", "eyeDx", "wing", "ruler", "clickX"])
        if (d[f] != null) d[f] = -d[f];
      if (d.smear) d.smear = { ...d.smear, dx: -d.smear.dx };
      if (d.arms) d.arms = mirror(d.arms);
      if (d.legs) d.legs = mirror(d.legs);
      if (d.rules && d.rdir !== "up" && d.rdir !== "down") d.rdir = -1;
      if (d.glassesTilt) d.glassesTilt = -Math.abs(d.glassesTilt);
      k.d = d;
    });
    for (const m of X.marks) m[0] = -m[0];
  }

  // ---- finale pieces (front-on, never mirrored)
  // the eyes lead, then the body turns to us in two exact steps
  function turnFront(X, from, extra = {}) {
    X.put({ ...from, ...extra, head: 0 }, 1);
    X.put({ ...from, ...extra, th: from.th / 2, head: 0 }, 2, { ease: "io" });
  }
  // one hand at the temple pushes the glasses up; a glint follows
  function glassesPush(X, front) {
    const withR = (R) => ({ L: front.arms ? front.arms.L : SIDES.L, R });
    X.put(
      {
        ...front,
        eyeDy: -3,
        eyeDx: 3,
        arms: withR([
          [250, 170, 18],
          [206, 140, 22],
        ]),
      },
      2,
      { ease: "io" },
    );
    X.put(
      {
        ...front,
        ...G(0),
        eyes: "closed",
        sy: 1.02,
        arms: withR([
          [246, 150, 18],
          [204, 124, 22],
        ]),
      },
      1,
      { snap: true },
    );
    X.put(
      {
        ...front,
        ...G(0),
        glint: 1,
        eyes: "wide",
        arms: withR([
          [252, 152, 6],
          [246, 128, 6],
        ]),
      },
      1,
    );
    X.put(
      {
        ...front,
        ...G(0),
        glint: 0.55,
        arms: withR([
          [250, 160, 0],
          [250, 130, 0],
        ]),
      },
      1,
    );
  }
  // v3's tick, drawn with a fingertip: short stroke, a pause on the corner, long stroke, a flick, the flare
  function fingerTick(X, clean, { pleased = 3 } = {}) {
    const [a, b, c] = M.tick,
      l1 = Math.hypot(b[0] - a[0], b[1] - a[1]),
      l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const tip = (t) => {
      let len = t * (l1 + l2);
      if (len <= l1) return [a[0] + ((b[0] - a[0]) * len) / l1, a[1] + ((b[1] - a[1]) * len) / l1];
      len -= l1;
      return [b[0] + ((c[0] - b[0]) * len) / l2, b[1] + ((c[1] - b[1]) * len) / l2];
    };
    const R = [
      [250, 160, 0],
      [250, 130, 0],
    ];
    const finger = (t, ctrl) => {
      const q = tip(t);
      return { L: [ctrl, [q[0] - 1, q[1] + 1, 22]], R };
    };
    const corner = l1 / (l1 + l2);
    X.put(
      {
        ...clean,
        sy: 1.03,
        drop: -2,
        eyeDy: 4,
        eyeDx: -3,
        mouth: "tight",
        arms: {
          L: [
            [48, 190, 10],
            [112, 170, 22],
          ],
          R,
        },
      },
      1,
      { ease: "io" },
    );
    X.put(
      {
        ...clean,
        tick: 0,
        drop: 1,
        eyeDy: 5,
        eyeDx: -4,
        mouth: "tight",
        arms: finger(0, [64, 232, 22]),
      },
      1,
    );
    X.put(
      {
        ...clean,
        tick: corner,
        drop: 2,
        sy: 0.98,
        eyeDy: 5,
        eyeDx: -3,
        mouth: "tight",
        arms: finger(corner, [70, 238, 22]),
      },
      2,
    );
    X.put(
      {
        ...clean,
        tick: 0.72,
        eyeDy: 4,
        eyeDx: -1,
        mouth: "tight",
        arms: finger(0.72, [78, 240, 22]),
      },
      1,
    );
    X.put(
      { ...clean, tick: 1, eyeDy: 3, mouth: "tight", arms: finger(1, [84, 236, 22]), spark: 0.08 },
      1,
    );
    X.put(
      {
        ...clean,
        tick: 1,
        sy: 1.02,
        arms: {
          L: [
            [80, 214, 20],
            [176, 150, 22],
          ],
          R: M.arms.R,
        },
        spark: 0.4,
      },
      1,
      { ease: "out" },
    );
    X.put(
      {
        ...clean,
        tick: 1,
        sy: 1.03,
        drop: -3,
        eyes: "happy",
        mouth: "happy",
        arms: M.arms,
        legs: M.legs,
        spark: 0.72,
      },
      pleased,
      { ease: "io" },
    ); // and at ease
  }
  // the stamped tick: wind the hand up, then one cut to the hand flat on the sheet with the tick
  // already there, held, with ruled stamp strokes; lift off, pleased
  function stampTick(X, clean) {
    const R = M.arms.R;
    X.put(
      {
        ...clean,
        tick: 0,
        sy: 1.03,
        drop: -2,
        eyeDy: 5,
        eyeDx: -3,
        mouth: "tight",
        arms: {
          L: [
            [46, 150, 12],
            [70, 96, 22],
          ],
          R,
        },
      },
      3,
      { ease: "io" },
    );
    X.put(
      {
        ...clean,
        tick: 1,
        sy: 0.955,
        sx: 1.03,
        bulge: 0.02,
        drop: 3,
        eyes: "closed",
        mouth: "tight",
        stampFx: 0.12,
        arms: {
          L: [
            [88, 214, 22],
            [137, 184, 24],
          ],
          R,
        },
      },
      2,
      { snap: true },
    );
    X.impact = X.now() - 2 * FR;
    X.shake.push({ at: X.impact, dur: 110, amp: 1.5 });
    X.put(
      {
        ...clean,
        tick: 1,
        sy: 0.98,
        drop: 1,
        eyeDy: 4,
        eyeDx: -2,
        mouth: "tight",
        stampFx: 0.6,
        arms: {
          L: [
            [80, 206, 20],
            [124, 170, 22],
          ],
          R,
        },
      },
      1,
      { ease: "out" },
    );
    X.put(
      {
        ...clean,
        tick: 1,
        sy: 1.02,
        stampFx: 1,
        arms: {
          L: [
            [64, 196, 12],
            [92, 150, 16],
          ],
          R,
        },
        spark: 0.3,
      },
      1,
      { ease: "out" },
    );
    X.put(
      {
        ...clean,
        tick: 1,
        sy: 1.03,
        drop: -3,
        eyes: "happy",
        mouth: "happy",
        arms: M.arms,
        legs: M.legs,
        spark: 0.72,
      },
      3,
      { ease: "io" },
    ); // and at ease
  }

  function done(X, from) {
    X.put({ th: 0 }, 1); // the rest artwork, exactly
    if (from === "left") flipForLeft(X, X.frontAt);
    return {
      keys: X.keys,
      marks: X.marks,
      duration: Math.round(X.frame * FR),
      impact: Math.round(X.impact),
      shake: X.shake,
      from,
    };
  }

  window.CheckKit = {
    FB,
    M,
    FR,
    SIDES,
    TIGHT,
    ATTF,
    ATT3,
    HIP3,
    walkLeg,
    sideLeg,
    G,
    sheet,
    flipForLeft,
    turnFront,
    glassesPush,
    fingerTick,
    stampTick,
    done,
  };
})();

// Check v5c: v5b polished (POLISH-AUDIT-2). The tick strokes are pen strokes (`drawn`: fast, arriving at
// full speed, a one-frame stop) and the long stroke flicks a hair past its end; the wind-up, tick and
// stamp are tightened (3.00 -> 2.75 s from the sides) with the held look (375 ms) and the push (542 ms)
// untouched. Above: lowered, a small rise as it lets go, a stretched drop onto the mark (ease-in, 0 in
// one frame, 6 % held 50 ms). Below: a peek, a 65 ms dip, an eased rise 14 units past flush, and down
// onto the mark. The stamp stays contained (2.5 %, no cut, no shake); the hand lands first, the sheet
// gives 17 ms later and the hand presses on through the hold.
// Check v5b: v5 with the stamp's whole-body snap, the 3.5 px shake and the pop-up removed.
// Check v5: the polish pass on v4c3 (Greg's approved concept, beats and timing). It sidesteps in with
// the glasses already down its nose and the eyebrow up, looking at us over the rims; once it stops it
// resolves: a held look, a deliberate push of the glasses, the drawn tick, a lift and the stamp.
// v5 over v4c3 (see NOTES.md): keys are placed in ms; every segment names its ease; each step-together
// has its own spacing (push out, plant in) and the last close accelerates into a stop contact with a
// squash and a moving hold; a crouch anticipates step 2, a lift anticipates the stamp; the held look
// drifts; the renderer lags the face (25 ms), glasses (42 ms) and, on the approach, the arms (83 ms).
//   right: the margin line rules itself up; two step-togethers bring it out onto the mark.
//   left:  the same, redrawn for the other side (limbs swap; the tick and stamp are never mirrored).
//   above: it is lowered straight down, slows onto its mark and sets down on its knees.
//   below: a ruled slot opens; it rises straight up out of it and stops flush.
(() => {
  const K = window.CheckKit,
    { TIGHT, sideLeg, M } = K;
  // the investigative look, worn on the way in: glasses down the nose (slipping further each step),
  // eyes over the rims, one eyebrow up
  const G = (g = 0) => ({
    glassesY: 12 + 0.4 * g,
    glassesTilt: 0.03,
    eyeDy: -7,
    brows: 1,
    browUp: 1,
  });
  const CLOSED = { L: sideLeg("L", 132), R: sideLeg("R", 162) };
  // arms held down at the sides; dx swings both hands (+ trails a leftward move), dy lifts them
  const arms = (dx = 0, dy = 0) => ({
    L: [
      [TIGHT.L[0][0] + dx * 0.45, TIGHT.L[0][1] + dy * 0.4, 0],
      [TIGHT.L[1][0] + dx, TIGHT.L[1][1] + dy - Math.abs(dx) * 0.25, 0],
    ],
    R: [
      [TIGHT.R[0][0] + dx * 0.45, TIGHT.R[0][1] + dy * 0.4, 0],
      [TIGHT.R[1][0] + dx, TIGHT.R[1][1] + dy - Math.abs(dx) * 0.25, 0],
    ],
  });

  function sheet() {
    const X = { keys: [], marks: [], shake: [], lag: [], fx: [], impact: 0, frontAt: 0 };
    // at(t, drawing, ease of the segment that starts here, extra: hold ms / snap)
    X.at = (t, d, ease = "io", o = {}) => {
      X.keys.push({ d, t: Math.round(t), hold: 0, ease, ...o });
    };
    return X;
  }

  function build(from = "right") {
    const X = sheet(),
      base = { tick: 0, mouth: "tight", arms: TIGHT, th: -0.02, head: 0, ...G(0) };
    let S; // when the push begins
    if (from === "left" || from === "right") {
      const W = { wing: 108, wingA: 1 },
        d = 95,
        T0 = 2 * d,
        P = { ...base, ...W };
      // behind the margin line, crouched to push off (the anticipation is clipped by the line)
      X.at(0, { ...P, wingA: 0.001, tx: T0, legs: CLOSED, shade: 0, drop: 2, lean: 0.02 }, "out");
      X.at(
        67,
        { ...P, tx: T0, legs: CLOSED, drop: 3, sy: 0.975, lean: 0.025, ...G(0), arms: arms(2) },
        "outS",
      );
      // one step-together: lift the lead foot (push, out), plant it wide (inS), lift the trail foot (outS),
      // close. Planted feet never slide. The top leans into the travel; the arms trail (and lag 83 ms).
      const step = (t0, dur, T, g, lean, closeEase) => {
        const q = dur / 4;
        X.at(
          t0 + q,
          {
            ...P,
            tx: T - d / 4,
            drop: 1,
            sy: 1.01,
            lean,
            legs: { L: sideLeg("L", 132 - d / 4, 1), R: sideLeg("R", 162 + d / 4) },
            ...G(g),
            arms: arms(5),
          },
          "inS",
        );
        X.at(
          t0 + 2 * q,
          {
            ...P,
            tx: T - d / 2,
            drop: 4,
            sx: 1.02,
            sy: 0.98,
            lean: lean * 0.5,
            legs: { L: sideLeg("L", 132 - d / 2), R: sideLeg("R", 162 + d / 2) },
            ...G(g + 1),
            arms: arms(3),
          },
          "outS",
        );
        X.at(
          t0 + 3 * q,
          {
            ...P,
            tx: T - (3 * d) / 4,
            drop: 1,
            sy: 1.01,
            lean: lean * 1.1,
            legs: { L: sideLeg("L", 132 - d / 4), R: sideLeg("R", 162 + d / 4, 1) },
            ...G(g + 1),
            arms: arms(6),
          },
          closeEase,
        );
      };
      step(67, 260, T0, 1, -0.035, "out");
      // close 1: settles onto both feet and crouches, leaning back: the anticipation for step 2
      X.at(
        327,
        {
          ...P,
          tx: d,
          drop: 3.5,
          sy: 0.972,
          sx: 1.015,
          lean: 0.018,
          legs: CLOSED,
          ...G(2),
          browUp: 1.06,
          arms: arms(1),
        },
        "outS",
        { hold: 42 },
      );
      step(369, 300, d, 3, -0.045, "in"); // the last close accelerates into the stop
      X.marks.push([0, 669]);
      // the stop: speed to 0 in one frame; the sheet squashes, its top carries on; held, then a moving hold
      const stop = { ...base, ...W, tx: 0, legs: CLOSED, ...G(4) };
      X.at(
        669,
        {
          ...stop,
          drop: 5,
          sy: 0.94,
          sx: 1.04,
          bulge: 0.02,
          lean: -0.06,
          browUp: 1.14,
          arms: arms(6),
        },
        "io",
        { hold: 50 },
      );
      X.fx.push(["contact", 689, 260, 0]);
      X.at(
        794,
        {
          ...stop,
          drop: 4.4,
          sy: 0.947,
          sx: 1.034,
          bulge: 0.016,
          lean: -0.03,
          browUp: 1.1,
          wingA: 0.8,
          arms: arms(-2),
        },
        "out",
      );
      // it rises out of the stop; the lean comes back through (22 %), the arms swing forward; the margin goes
      X.at(
        919,
        {
          ...stop,
          wingA: 0,
          drop: 2,
          sy: 0.975,
          sx: 1.01,
          lean: 0.013,
          glassesY: 14.4,
          browUp: 1.12,
          eyeDy: -7.3,
          arms: arms(-4),
        },
        "io",
      );
      S = 1086; // the held look runs 375 ms from 711 (stop + 42), as in v5b
    } else {
      const up = from === "above";
      const P = { ...base, legs: CLOSED, floor: up ? 0 : 1 };
      let C; // contact
      if (up) {
        X.marks.push([0, 0, 0]); // ruled before it arrives
        // lowered, slowing (out), glasses riding high on the nose, arms floating up
        X.at(
          0,
          { ...P, ty: -520, shade: 0, ...G(0), glassesY: 11, sy: 1.01, arms: arms(0, -5) },
          "out",
        );
        X.at(
          190,
          { ...P, ty: -150, shade: 0.35, ...G(1), glassesY: 11.4, sy: 1.015, arms: arms(0, -7) },
          "io",
        );
        // it lets go: a small rise (60 ms, the counter-move), stretched, brow up, arms up
        X.at(
          250,
          {
            ...P,
            ty: -158,
            shade: 0.35,
            ...G(1),
            glassesY: 11.2,
            sy: 1.035,
            sx: 0.985,
            browUp: 1.1,
            arms: arms(0, -12),
          },
          "in",
        );
        // the drop accelerates (in, then on at full speed) into the mark; glasses and arms lag above
        X.at(
          360,
          {
            ...P,
            ty: -73,
            shade: 0.6,
            ...G(2),
            glassesY: 11.6,
            sy: 1.04,
            sx: 0.98,
            browUp: 1.12,
            arms: arms(0, -10),
          },
          "lin",
        );
        // the last frame of the fall is still stretched, so the contact drawing is a one-frame change
        X.at(
          399,
          {
            ...P,
            ty: -2,
            shade: 0.9,
            ...G(2),
            glassesY: 11.8,
            sy: 1.03,
            sx: 0.985,
            browUp: 1.12,
            arms: arms(0, -9),
          },
          "lin",
        );
        C = 400;
      } else {
        X.at(0, { ...P, ty: 250, slot: 0, shade: 0, ...G(0) }, "out");
        X.at(
          83,
          { ...P, ty: 250, slot: 1, shade: 0, drop: 2, sy: 0.98, ...G(0), arms: arms(0, 3) },
          "out",
        );
        // a peek: it rises (out) until its eyes are over the floor, looking at us over the rims
        X.at(
          190,
          {
            ...P,
            ty: 120,
            slot: 1,
            shade: 0.3,
            ...G(1),
            glassesY: 12.8,
            sy: 1.0,
            arms: arms(0, 4),
          },
          "in",
        );
        // the dip (65 ms, eases in to the compression): the anticipation for the rise
        X.at(
          255,
          {
            ...P,
            ty: 132,
            slot: 1,
            shade: 0.3,
            ...G(1),
            glassesY: 13.2,
            drop: 4,
            sy: 0.955,
            sx: 1.03,
            bulge: 0.012,
            browUp: 1.08,
            arms: arms(0, 7),
          },
          "out",
        );
        // the rise eases out 14 units past flush, stretched, hands trailing, glasses slipping
        X.at(
          400,
          {
            ...P,
            ty: -14,
            slot: 1,
            shade: 0.85,
            ...G(2),
            glassesY: 14,
            sy: 1.03,
            sx: 0.985,
            arms: arms(0, 6),
          },
          "in",
        );
        // falling back onto the mark it unstretches, still at speed on the last frame before contact
        X.at(
          469,
          {
            ...P,
            ty: -0.4,
            slot: 1,
            shade: 0.95,
            ...G(3),
            glassesY: 13.4,
            sy: 1.005,
            sx: 0.998,
            arms: arms(0, 2),
          },
          "lin",
        );
        C = 470;
      }
      if (!up) X.marks.push([0, C]);
      // contact: speed to 0 in one frame, 6 % held 50 ms, then a moving hold; glasses and arms follow through
      X.at(
        C,
        {
          ...P,
          ty: 0,
          floor: 0,
          slot: up ? 0 : 0.3,
          ...G(4),
          glassesY: up ? 14.2 : 12.4,
          drop: 5,
          sy: 0.94,
          sx: 1.04,
          bulge: 0.02,
          browUp: 1.14,
          arms: arms(0, up ? -2 : 4),
        },
        "io",
        { hold: 50 },
      );
      X.fx.push(["contact", C + 20, 240, 0]);
      X.at(
        C + 125,
        {
          ...P,
          ty: 0,
          floor: 0,
          slot: 0,
          ...G(4),
          glassesY: up ? 14.6 : 13,
          drop: 4.4,
          sy: 0.947,
          sx: 1.034,
          bulge: 0.016,
          browUp: 1.1,
          arms: arms(0, up ? 3 : -3),
        },
        "out",
      );
      // the settle: rises out of it (out), then sinks a hair into the look (the paper's decay, no overshoot)
      X.at(
        C + 250,
        {
          ...P,
          ty: 0,
          floor: 0,
          slot: 0,
          ...G(4),
          glassesY: 14.4,
          drop: 1,
          sy: 0.992,
          sx: 1.004,
          browUp: 1.12,
          eyeDy: -7.3,
          arms: arms(0, -1),
        },
        "io",
      );
      S = C + 42 + 375;
    }
    X.frontAt = X.keys.length;
    finale(X, S);
    // overlap: face 25 ms, glasses 42 ms behind the body; arms 83 ms behind on the approach only
    const D = X.duration;
    X.lag.push({ f: ["eyeDx", "eyeDy", "browUp"], dt: 25, to: D - 160 });
    X.lag.push({ f: ["glassesY", "glassesTilt"], dt: 42, to: D - 160 });
    X.lag.push({ f: ["arms"], dt: 83, to: S - 10 });
    if (from === "left") K.flipForLeft(X, X.frontAt);
    return {
      keys: X.keys,
      marks: X.marks,
      duration: D,
      impact: Math.round(X.impact),
      shake: X.shake,
      lag: X.lag,
      fx: X.fx,
      from,
    };
  }

  // ---- the resolve and the tick, the same from every side, from S (the reach)
  const R_UP = [
    [250, 160, 0],
    [250, 130, 0],
  ];
  function finale(X, S) {
    const base = { tick: 0, arms: TIGHT, th: 0, head: 0, legs: CLOSED };
    const withR = (R) => ({ L: TIGHT.L, R });
    // the end of the held look: risen to 1.5 % under rest, glasses still slipping, brow creeping up
    const look = {
      ...base,
      ...G(4),
      glassesY: 15,
      browUp: 1.2,
      eyeDy: -7.6,
      head: 0.005,
      drop: 1.5,
      sy: 0.985,
      mouth: "tight",
    };
    X.at(S, look, "io");
    // the reach: the hand arcs out and up, then in to the bridge; weight shifts a hair toward it
    X.at(
      S + 83,
      {
        ...look,
        lean: 0.006,
        arms: withR([
          [250, 182, 10],
          [236, 150, 16],
        ]),
      },
      "in",
    );
    X.at(
      S + 167,
      {
        ...look,
        glassesY: 15.2,
        lean: 0.004,
        arms: withR([
          [244, 196, 20],
          [160, 151 + 3.2, 24],
        ]),
      },
      "io",
    );
    // the dip: finger, glasses and body sink together
    X.at(
      S + 250,
      {
        ...look,
        glassesY: 16.2,
        eyeDy: -7.4,
        drop: 3,
        sy: 0.975,
        sx: 1.012,
        lean: 0,
        arms: withR([
          [244, 199, 20],
          [160, 155, 24],
        ]),
      },
      "out",
    );
    // up they slide, easing out; the eyes come back behind the lenses first, the brow lags
    X.at(
      S + 333,
      {
        ...base,
        glassesY: 3,
        glassesTilt: 0.008,
        eyeDy: -1.5,
        brows: 1,
        browUp: 0.8,
        drop: 0.5,
        sy: 1.008,
        mouth: "tight",
        glint: 0.3,
        arms: withR([
          [241, 188, 20],
          [159, 134, 24],
        ]),
      },
      "out",
    );
    X.at(
      S + 417,
      {
        ...base,
        glassesY: -0.8,
        glassesTilt: 0,
        eyeDy: 0,
        brows: 1,
        browUp: 0.25,
        drop: -0.5,
        sy: 1.015,
        mouth: "tight",
        glint: 0.7,
        arms: withR([
          [240, 184, 20],
          [158, 128, 24],
        ]),
      },
      "io",
    );
    // a tiny settle and the glint; the brows go
    X.at(
      S + 542,
      {
        ...base,
        ...K.G(0),
        eyes: "wide",
        mouth: "tight",
        glint: 1,
        sy: 1.005,
        arms: withR([
          [248, 170, 12],
          [196, 128, 16],
        ]),
      },
      "io",
    );
    const clean = { ...base, ...K.G(0) };
    // anticipation for the tick: the hand winds up high, the eyes go to the spot; a moving hold
    const [a, b, c] = M.tick,
      l1 = Math.hypot(b[0] - a[0], b[1] - a[1]),
      l2 = Math.hypot(c[0] - b[0], c[1] - b[1]),
      corner = l1 / (l1 + l2);
    const tip = (t) => {
      let len = t * (l1 + l2);
      if (len <= l1) return [a[0] + ((b[0] - a[0]) * len) / l1, a[1] + ((b[1] - a[1]) * len) / l1];
      len -= l1;
      return [b[0] + ((c[0] - b[0]) * len) / l2, b[1] + ((c[1] - b[1]) * len) / l2];
    };
    const finger = (t, ctrl) => {
      const q = tip(t);
      return { L: [ctrl, [q[0] - 1, q[1] + 1, 22]], R: R_UP };
    };
    const pen = (t, ctrl, dx = 0, dy = 0) => {
      const q = tip(t);
      return { L: [ctrl, [q[0] - 1 + dx, q[1] + 1 + dy, 22]], R: R_UP };
    };
    X.at(
      S + 642,
      {
        ...clean,
        sy: 1.025,
        drop: -1.5,
        eyeDy: 4,
        eyeDx: -3,
        mouth: "tight",
        arms: {
          L: [
            [48, 190, 10],
            [112, 170, 22],
          ],
          R: R_UP,
        },
      },
      "io",
    );
    X.at(
      S + 722,
      {
        ...clean,
        sy: 1.035,
        drop: -2.5,
        eyeDy: 4.6,
        eyeDx: -3.4,
        mouth: "tight",
        arms: {
          L: [
            [46, 184, 10],
            [110, 162, 22],
          ],
          R: R_UP,
        },
      },
      "in",
    );
    // the tick, drawn with a pen's spacing: the nib lands (in), the short stroke is fast and stops dead on
    // the corner (held 2 frames), a moving pause, then the long stroke, which flicks a hair past its end
    X.at(
      S + 780,
      {
        ...clean,
        tick: 0,
        drop: 1,
        eyeDy: 5,
        eyeDx: -4,
        mouth: "tight",
        arms: pen(0, [64, 232, 22]),
      },
      "drawn",
    );
    X.at(
      S + 870,
      {
        ...clean,
        tick: corner,
        drop: 2,
        sy: 0.98,
        eyeDy: 5,
        eyeDx: -3,
        mouth: "tight",
        arms: pen(corner, [70, 238, 22]),
      },
      "io",
      { hold: 33 },
    );
    X.at(
      S + 945,
      {
        ...clean,
        tick: corner,
        drop: 2.4,
        sy: 0.976,
        eyeDy: 5.2,
        eyeDx: -2.6,
        mouth: "tight",
        arms: pen(corner, [71, 239, 22], 0, 0.6),
      },
      "drawn",
    );
    X.at(
      S + 1050,
      {
        ...clean,
        tick: 1,
        drop: 1.5,
        sy: 0.99,
        eyeDy: 3,
        eyeDx: -1,
        mouth: "tight",
        arms: pen(1.06, [86, 235, 22], 0, -2),
      },
      "out",
    );
    X.at(
      S + 1095,
      {
        ...clean,
        tick: 1,
        drop: 1,
        sy: 0.994,
        eyeDy: 3.2,
        eyeDx: -1.2,
        mouth: "tight",
        arms: pen(1, [84, 234, 22], 0, -3),
      },
      "out",
    );
    // the lift before the stamp (anticipation, 150 ms against a 60 ms stamp): the hand comes off the page
    X.at(
      S + 1155,
      {
        ...clean,
        tick: 1,
        drop: -0.6,
        sy: 1.008,
        eyeDy: 3.5,
        eyeDx: -1.5,
        mouth: "tight",
        arms: {
          L: [
            [72, 200, 16],
            [124, 150, 22],
          ],
          R: R_UP,
        },
      },
      "io",
    );
    X.at(
      S + 1185,
      {
        ...clean,
        tick: 1,
        drop: -0.8,
        sy: 1.01,
        eyeDy: 3.8,
        eyeDx: -1.6,
        mouth: "tight",
        arms: {
          L: [
            [70, 196, 16],
            [122, 146, 22],
          ],
          R: R_UP,
        },
      },
      "in",
    );
    // the stamp: no cut, no shake. The hand comes down on an ease-in and stops dead on the tick; the ink
    // flares; the sheet gives 17 ms later, a contained 2.5 % held 40 ms, while the hand presses on 1 unit.
    const STAMP = [
        [88, 216, 22],
        [137, 185, 24],
      ],
      PRESS = [
        [88, 217, 22],
        [137, 186.5, 24],
      ];
    X.at(
      S + 1245,
      {
        ...clean,
        tick: 1,
        sy: 0.992,
        sx: 1.004,
        drop: 0.4,
        eyes: "closed",
        mouth: "tight",
        arms: { L: STAMP, R: R_UP },
      },
      "out",
    );
    X.impact = S + 1245;
    X.fx.push(["stampFx", X.impact, 360, 0.12]);
    X.at(
      S + 1262,
      {
        ...clean,
        tick: 1,
        sy: 0.975,
        sx: 1.015,
        bulge: 0.008,
        drop: 1.4,
        eyes: "closed",
        mouth: "tight",
        arms: { L: PRESS, R: R_UP },
      },
      "io",
      { hold: 40 },
    );
    X.at(
      S + 1380,
      {
        ...clean,
        tick: 1,
        sy: 0.978,
        sx: 1.013,
        bulge: 0.007,
        drop: 1.2,
        eyes: "closed",
        mouth: "tight",
        arms: {
          L: [
            [87, 216, 22],
            [136, 185.5, 24],
          ],
          R: R_UP,
        },
      },
      "io",
    );
    // satisfied: the hand lifts off slowly, a small pleased rise, and it settles onto the rest drawing
    X.at(
      S + 1460,
      {
        ...clean,
        tick: 1,
        sy: 0.998,
        drop: 0.3,
        eyeDy: 4,
        eyeDx: -2,
        mouth: "tight",
        arms: {
          L: [
            [80, 206, 20],
            [124, 170, 22],
          ],
          R: R_UP,
        },
      },
      "io",
    );
    X.at(
      S + 1545,
      {
        ...clean,
        tick: 1,
        sy: 1.008,
        drop: -0.6,
        eyes: "happy",
        mouth: "happy",
        arms: {
          L: [
            [62, 194, 12],
            [88, 150, 16],
          ],
          R: M.arms.R,
        },
        legs: M.legs,
        spark: 0.4,
      },
      "io",
    );
    X.at(S + 1625, { th: 0 }, "io"); // the rest artwork, exactly, held to the end
    X.duration = S + 1667;
  }

  window.CheckMotion = { build, FR: K.FR };
})();

/* Check v5, smooth (v5: explicit eases outS/inS, lag channels for overlap, timed effects, a reduced-motion flag).
   Check v3, smooth: the key poses from motion.js evaluated every display frame and drawn with the
   v2 engine (CheckFlipbook.draw). The drawing is reconciled into a fixed pool of SVG nodes, so a
   frame is attribute updates only (plus a transform on the copy for the impact shake).
   Stepped accents only: a stamp is cut to in one frame and held 2-3 frames; expressions (eyes,
   mouth) change on the drawing they belong to. Everything else interpolates.
   The loop runs only during the entrance, only on screen and in a visible tab; under reduced
   motion nothing starts and the page artwork (the rest pose) shows. */
(() => {
  const FB = window.CheckFlipbook,
    CM = window.CheckMotion;
  const clamp01 = (u) => Math.max(0, Math.min(1, u));
  const f1 = (n) => Math.round(n * 10) / 10;
  const EASE = {
    lin: (u) => u,
    out: (u) => 1 - (1 - u) * (1 - u),
    in: (u) => u * u,
    io: (u) => 0.5 - Math.cos(Math.PI * u) / 2,
    // a step's push and plant: half linear, so the body never stops between a lift and a plant
    outS: (u) => 0.5 * u + 0.5 * (1 - (1 - u) * (1 - u)),
    inS: (u) => 0.5 * u + 0.5 * u * u,
    // v5c: a pen stroke. It leaves the mark at a third of top speed, accelerates, and arrives at full
    // speed, so the stop is a one-frame cut to 0: a crisp stop, not an ease-in-out into it
    drawn: (u) => 0.35 * u + 0.65 * u * u,
  };
  const STEP = { eyes: 1, mouth: 1, rdir: 1, floor: 1, brows: 1 };
  function mix(a, b, u) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => mix(v, b[i], u));
    if (a && b && typeof a === "object") {
      const o = {};
      for (const k in a) o[k] = k in b ? mix(a[k], b[k], u) : a[k];
      return o;
    }
    return u < 0.5 ? a : b;
  }
  const DEF = {
    head: 0,
    contact: 0,
    rules: 0,
    glint: 0,
    spark: 1,
    slot: 0,
    shade: 1,
    floor: 0,
    rdir: 1,
    smear: { dx: 0, dy: 0, n: 0 },
    click: 0,
    clickX: 0,
    brows: 0,
    browUp: 0,
    stampFx: 0,
    ruler: 0,
    rulerA: 1,
    vruler: 0,
    wing: 0,
    wingA: 0,
    clipTop: 0,
  };
  // a straight leg gets a knee on the line from hip to ankle, so it can bend in and out of a crouch
  const pad = (leg, hip) =>
    leg.length === 3 ? leg : [[(hip[0] + leg[0][0]) / 2, (hip[1] + leg[0][1]) / 2, 0], ...leg];
  function prep(d) {
    const raw = FB.full(d);
    const P = { ...DEF, ...raw };
    if (P.head == null) P.head = 0;
    if (!P.smear) P.smear = DEF.smear;
    P.legs = { L: pad(P.legs.L, FB.model.hips.L), R: pad(P.legs.R, FB.model.hips.R) };
    return { raw, P };
  }

  function timeline(from, room) {
    const tl = CM.build(from, room);
    tl.keys = tl.keys.map((k) => ({ ...k, ...prep(k.d) }));
    return tl;
  }
  // the key pose at t (no effects, no lag)
  function keyPose(tl, t) {
    const K = tl.keys,
      D = tl.duration;
    let i = 0;
    while (i + 1 < K.length && K[i + 1].t <= t) i++;
    const k = K[i],
      n = K[i + 1];
    let p;
    if (!n || t >= D) p = structuredClone(k.raw);
    else {
      const tb = k.t + Math.max(0, k.hold),
        span = Math.max(1, n.t - tb);
      const u = t <= tb ? 0 : clamp01((t - tb) / span);
      if (u === 0) p = structuredClone(k.raw);
      else if (n.snap)
        p = mix(k.P, { ...k.P, tx: n.P.tx, ty: n.P.ty }, u); // travel on into the cut
      else {
        p = mix(k.P, n.P, (EASE[k.ease] || EASE.lin)(u));
        for (const f in STEP) p[f] = k.P[f];
        if (!k.P.rules && n.P.rules) p.rdir = n.P.rdir;
      }
    }
    return p;
  }
  function poseAt(tl, t) {
    const D = tl.duration,
      p = keyPose(tl, t);
    // overlap: named channels (face, glasses, arms) are drawn from a moment earlier. The delay eases
    // to 0 over the last 150 ms of each window, so they land exactly on the key pose.
    for (const { f, dt, to } of tl.lag || []) {
      const d = dt * clamp01((to - t) / 150);
      if (d <= 0.5) continue;
      const q = keyPose(tl, Math.max(0, t - d));
      for (const k of f) if (k in q) p[k] = q[k];
    }
    // timed effects that run on their own clock: [field, at, duration, start value]
    for (const [f, at, dur, k0] of tl.fx || [])
      p[f] = t >= at && t < at + dur ? k0 + (1 - k0) * ((t - at) / dur) : 0;
    // ruled ground marks: appear on their landing (or are ruled ahead), fade out before the end
    const fade = clamp01(1 - (t - (D - 14 * CM.FR)) / (11 * CM.FR));
    p.marks = tl.marks
      .map(([x, at, pre]) => [
        x,
        t >= at ? fade : pre != null && t >= pre ? 0.8 * clamp01((t - pre) / 110) : 0,
      ])
      .filter((m) => m[1] > 0);
    return p;
  }

  window.CheckSmooth = { poseAt, timeline };
})();
