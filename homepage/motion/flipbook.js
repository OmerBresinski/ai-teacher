/* Flipbook engine for the Slides character. Every frame is a fresh drawing: the card is projected
   from 3D corners (a turn redraws it as a trapezoid, an edge, a back), limbs are posed per drawing
   and the face spots. Frames swap on a stepped Web Animations timeline, so the browser only ever
   shows whole drawings, never a tween. The original artwork stays in the page as the rest pose;
   the drawings replace it only while the entrance plays. */
(() => {
  const F = 480,
    CX = 156,
    EYE_Y = 150,
    YB = 224,
    T = 11,
    GROUND = 278;
  const INK = "#293b32",
    CREAM = "#faf5df",
    YEL = "#f5c054",
    ORANGE = "#e88f52",
    SUN = "#fff3cb",
    BG = "#fcf9ee";
  // Sheets in local coordinates: X relative to CX, y absolute, z toward the viewer.
  const FRONT = [
    [-104, 62],
    [97, 54],
    [104, 218],
    [-96, 225],
  ];
  const OUTLINE = [
    [-99, 64],
    [100, 57],
    [105, 217],
    [-94, 225],
  ];
  const BACK = [
    [-112, 68],
    [88, 59],
    [96, 223],
    [-104, 230],
  ];
  const SH = { L: [-101, 105], R: [88, 117] },
    HIP = { L: [-96, 221], R: [67, 217] };
  const FACE_C = [-19, 135];

  // Named poses. Limb points follow the anchor: [control, end] for arms, [knee, foot] for legs.
  const P = {};
  P.rest = {
    th: 0,
    sx: 1,
    sy: 1,
    lean: 0,
    bulge: 0,
    tx: 0,
    ty: 0,
    arms: {
      L: [
        [-132, 96, 0],
        [-137, 130, 0],
      ],
      R: [
        [119, 123, 0],
        [121, 94, 0],
      ],
    },
    legs: {
      L: [
        [-105, 274, 0],
        [-124, 277, 0],
      ],
      R: [
        [84, 268, 0],
        [104, 268, 0],
      ],
    },
    mouth: "rest",
    eyes: "dot",
  };
  const pose = (o) => Object.assign(structuredClone(P.rest), o);
  // Spinning with arms overhead, one leg tucked.
  P.tuck = pose({
    ty: -12,
    sy: 1.08,
    sx: 0.93,
    arms: {
      L: [
        [-124, 50, 12],
        [-26, 14, 18],
      ],
      R: [
        [112, 52, 12],
        [16, 12, 18],
      ],
    },
    legs: {
      L: [
        [-38, 262, 0],
        [-28, 292, 0],
      ],
      R: [
        [106, 238, 40],
        [-58, 246, 10],
      ],
    },
  });
  // Stretch before impact: long card, pinched sides, legs together and pointed.
  P.stretch = pose({
    sy: 1.28,
    sx: 0.8,
    bulge: -0.05,
    arms: {
      L: [
        [-122, 30, 6],
        [-60, -10, 8],
      ],
      R: [
        [108, 32, 6],
        [50, -12, 8],
      ],
    },
    legs: {
      L: [
        [-60, 280, 0],
        [-40, 305, 0],
      ],
      R: [
        [40, 280, 0],
        [20, 305, 0],
      ],
    },
    mouth: "o",
  });
  // Squash on contact: the card redrawn short and fat, knees out, arms flung.
  P.squash = pose({
    sy: 0.62,
    sx: 1.26,
    bulge: 0.11,
    arms: {
      L: [
        [-170, 150, 0],
        [-196, 196, 0],
      ],
      R: [
        [160, 150, 0],
        [188, 186, 0],
      ],
    },
    legs: {
      L: [
        [-160, 250, 0],
        [-150, 277, 0],
      ],
      R: [
        [128, 248, 0],
        [134, 277, 0],
      ],
    },
    mouth: "grit",
    eyes: "shut",
  });
  // Hero finish: arms up and open, feet planted wide.
  P.hero = pose({
    sy: 1.03,
    sx: 0.99,
    arms: {
      L: [
        [-138, 80, 0],
        [-168, 40, 0],
      ],
      R: [
        [128, 88, 0],
        [158, 44, 0],
      ],
    },
    legs: {
      L: [
        [-116, 272, 0],
        [-136, 277, 0],
      ],
      R: [
        [96, 268, 0],
        [118, 270, 0],
      ],
    },
    mouth: "happy",
  });
  P.rest_happy = pose({ mouth: "happy" });

  // Geometry.
  const TAU = Math.PI * 2;
  function projector(p) {
    const c = Math.cos(TAU * p.th),
      s = Math.sin(TAU * p.th);
    return ([X, y, z]) => {
      const x1 = X * c + z * s,
        z1 = -X * s + z * c,
        k = F / (F - z1);
      return [CX + x1 * k + p.tx, EYE_Y + (y - EYE_Y) * k + p.ty, z1];
    };
  }
  const deform =
    (p) =>
    ([X, y], z = 0) => {
      const y2 = YB + (y - YB) * p.sy;
      return [X * p.sx + (YB - y2) * p.lean, y2, z];
    };
  const f1 = (n) => Math.round(n * 10) / 10;
  const pt = (q) => `${f1(q[0])} ${f1(q[1])}`;
  function poly(pts, bulge, attrs) {
    if (!bulge) return `<path d="M${pts.map(pt).join(" L")}Z" ${attrs}/>`;
    const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length,
      cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    let d = `M${pt(pts[0])}`;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2,
        my = (a[1] + b[1]) / 2,
        len = Math.hypot(b[0] - a[0], b[1] - a[1]);
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
  const rnd = (seed) => {
    const x = Math.sin(seed * 999.7) * 43758.5453;
    return x - Math.floor(x);
  };
  // Spotting: the face holds front while the body turns away and is hidden through the back.
  const spot = (th) => {
    const u = th - Math.floor(th);
    return u <= 0.2 || u >= 0.8 ? 0 : null;
  };

  // One drawing.
  function draw(p, i) {
    const inv = !!p.negative;
    const ink = inv ? BG : INK;
    const fill = (c) => `fill="${inv ? INK : c}"`;
    const pr = projector(p),
      df = deform(p);
    const c = Math.cos(TAU * p.th),
      s = Math.sin(TAU * p.th);
    const out = [];
    const S = (w) => `stroke="${ink}"${w ? ` stroke-width="${w}"` : ""}`;

    if (inv)
      out.push(
        `<rect x="-3000" y="-3000" width="6000" height="6000" fill="${INK}" stroke="none"/>`,
      );
    else {
      const h = Math.min(1, Math.max(0, -p.ty / 180));
      const rx = 86 * (1 - h * 0.55);
      out.push(
        `<ellipse cx="${f1(155 + p.tx)}" cy="${GROUND - 3}" rx="${f1(rx)}" ry="${f1(rx * 0.09)}" fill="${INK}" fill-opacity="${f1((1 - h * 0.6) * 9) / 100}" stroke="none" filter="url(#hiw-blur)"/>`,
      );
    }
    if (p.ring != null) ring(out, p, ink);
    if (p.dust != null && p.dust < 1) dust(out, p, ink, -1);

    const limb = (anchor, pts, isArm) => {
      const a = pr(df(anchor)),
        q = pts.map(pr);
      const z = (a[2] + q[0][2] + q[1][2]) / 3;
      const d = isArm
        ? `M${pt(a)} Q${pt(q[0])} ${pt(q[1])}`
        : `M${pt(a)} L${pt(q[0])} L${pt(q[1])}`;
      return { z, svg: `<path d="${d}" ${S()} fill="none"/>` };
    };
    const limbs = [
      limb(SH.L, p.arms.L, true),
      limb(SH.R, p.arms.R, true),
      limb(HIP.L, p.legs.L, false),
      limb(HIP.R, p.legs.R, false),
    ];
    // Smear ghosts: earlier positions of the arms and the card outline.
    if (p.smear) {
      for (const k of [2, 1]) {
        const g = {
          ...p,
          th: p.th - p.smear * 0.09 * k,
          tx: p.tx + (p.smearDx || 0) * k,
          ty: p.ty + (p.smearDy || 0) * k,
        };
        const gp = projector(g);
        const o = (0.5 - k * 0.15).toFixed(2);
        out.push(
          poly(
            FRONT.map((q) => gp(df(q))),
            p.bulge,
            `fill="none" ${S(2)} stroke-opacity="${o}"`,
          ),
        );
        for (const side of ["L", "R"]) {
          const a = gp(df(SH[side])),
            q = p.arms[side].map(gp);
          out.push(
            `<path d="M${pt(a)} Q${pt(q[0])} ${pt(q[1])}" fill="none" ${S(2)} stroke-opacity="${o}"/>`,
          );
        }
      }
    }
    for (const l of limbs) if (l.z <= 4) out.push(l.svg);

    // Sheets: far, edge, near.
    const front = FRONT.map((q) => pr(df(q))),
      outline = OUTLINE.map((q) => pr(df(q, 0.5)));
    const back = BACK.map((q) => pr(df(q, -T)));
    const sheetF = poly(front, p.bulge, `${fill(YEL)} ${S()}`);
    const sheetO = poly(outline, p.bulge, `fill="none" ${S()}`);
    const sheetB = poly(back, p.bulge, `${fill(CREAM)} ${S()}`);
    // Thickness strip on the side turned toward us.
    let edge = "";
    if (Math.abs(s) > 0.05) {
      const [a, b] = s > 0 ? [0, 3] : [1, 2];
      const d1 = pr(df(FRONT[a], -20)),
        d2 = pr(df(FRONT[b], -20));
      edge = `<path d="M${pt(front[a])} L${pt(front[b])} L${pt(d2)} L${pt(d1)}Z" ${fill(CREAM)} ${S()}/>`;
    }
    if (c >= 0) {
      out.push(sheetB, edge, sheetF, sheetO);
      if (c > 0.08) details(out, pr, df, fill, S);
    } else {
      out.push(sheetF, edge, sheetB);
      // The back is plain; a faint crease so it reads as the back of the same card.
      if (c < -0.3) {
        const m1 = pr(df([-4, 72], -T - 0.5)),
          m2 = pr(df([2, 214], -T - 0.5));
        out.push(`<path d="M${pt(m1)} L${pt(m2)}" ${S(1.5)} stroke-opacity=".25" fill="none"/>`);
      }
    }
    const head = spot(p.th);
    if (head != null && !(c < -0.1)) face(out, pr, df, p, head, ink, S);
    for (const l of limbs) if (l.z > 4) out.push(l.svg);

    if (p.swirl) swirl(out, p, ink);
    if (p.fall) fall(out, p, ink, i);
    if (p.dust != null && p.dust < 1) dust(out, p, ink, 1);
    if (p.lines) lines(out, p, ink, i);
    if (p.papers != null && p.papers < 1) papers(out, p, ink);
    return out.join("");
  }

  function details(out, pr, df, fill, S) {
    const q = (X, y) => pr(df([X - CX, y], 0.6));
    out.push(`<path d="M${pt(q(83, 88))} L${pt(q(230, 82))}" ${S()} fill="none"/>`);
    const hills = [
      [89, 186],
      [116, 161],
      [140, 176],
      [170, 144],
      [224, 183],
    ];
    out.push(
      `<path d="M${hills.map(([a, b]) => pt(q(a, b))).join(" L")}Z" ${fill(ORANGE)} ${S()}/>`,
    );
    const sc = q(207, 113),
      sr = q(221, 113),
      st = q(207, 99);
    out.push(
      `<ellipse cx="${f1(sc[0])}" cy="${f1(sc[1])}" rx="${f1(Math.abs(sr[0] - sc[0]))}" ry="${f1(Math.abs(st[1] - sc[1]))}" ${fill(SUN)} ${S()}/>`,
    );
  }

  function face(out, pr, df, p, head, ink, S) {
    const cpt = pr(df(FACE_C, 0.6));
    const kx = Math.cos(TAU * head) * p.sx,
      ky = p.sy;
    const shift = Math.sin(TAU * head) * 22;
    const at = (dx, dy) => [cpt[0] + shift + dx * kx, cpt[1] + dy * ky];
    if (p.eyes === "shut") {
      out.push(
        `<path d="M${pt(at(-24, -12))} L${pt(at(-14, -8))} L${pt(at(-24, -4))}M${pt(at(24, -14))} L${pt(at(14, -10))} L${pt(at(24, -6))}" ${S()} fill="none"/>`,
      );
    } else {
      for (const [dx, dy] of [
        [-18, -8],
        [18, -10],
      ]) {
        const e = at(dx, dy);
        out.push(
          `<ellipse cx="${f1(e[0])}" cy="${f1(e[1])}" rx="${f1(3 * Math.max(0.35, Math.abs(kx)))}" ry="3" fill="${ink}" stroke="none"/>`,
        );
      }
    }
    if (p.mouth === "happy")
      out.push(
        `<path d="M${pt(at(-13, 4))} Q${pt(at(2, 22))} ${pt(at(16, 1))}" ${S()} fill="none"/>`,
      );
    else if (p.mouth === "o") {
      const m = at(1, 8);
      out.push(
        `<ellipse cx="${f1(m[0])}" cy="${f1(m[1])}" rx="${f1(4 * Math.max(0.4, Math.abs(kx)))}" ry="5" fill="none" ${S()}/>`,
      );
    } else if (p.mouth === "grit")
      out.push(`<path d="M${pt(at(-12, 8))} L${pt(at(14, 6))}" ${S(3)} fill="none"/>`);
    else
      out.push(
        `<path d="M${pt(at(-10, 6))} Q${pt(at(1, 16))} ${pt(at(13, 4))}" ${S()} fill="none"/>`,
      );
  }

  // Effects: shockwave ring, dust, swirl strokes, falling speed lines, impact lines, flung cards.
  function ring(out, p, ink) {
    for (const [lag, w] of [
      [0, 4],
      [0.22, 2.5],
    ]) {
      const r = (p.ring - lag) / (1 - lag);
      if (r <= 0 || r >= 1) continue;
      const rx = 70 + 230 * Math.sqrt(r) * (p.ringSize || 1);
      out.push(
        `<ellipse cx="${f1(155 + p.gx)}" cy="${GROUND}" rx="${f1(rx)}" ry="${f1(rx * 0.12)}" fill="none" stroke="${ink}" stroke-width="${f1(w * (1 - r) + 0.8)}" stroke-opacity="${f1(1 - r * r)}"/>`,
      );
    }
  }
  function dust(out, p, ink, side) {
    const r = p.dust,
      sz = p.dustSize || 1;
    for (const dir of [-1, 1])
      for (let k = 0; k < 3; k++) {
        if ((k === 1) !== side > 0) continue;
        const d = (70 + k * 22 + 150 * r ** 0.6) * sz;
        const x = 155 + p.gx + dir * d,
          y = GROUND - 10 - k * 9 - 22 * r;
        const rad = (13 - k * 2) * sz * (0.6 + Math.sin(Math.PI * Math.min(1, r * 1.3)) * 0.9);
        out.push(
          `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad)}" fill="${CREAM}" fill-opacity="${f1(1 - r)}" stroke="${ink}" stroke-width="2" stroke-opacity="${f1(1 - r)}"/>`,
        );
      }
  }
  function swirl(out, p, ink) {
    for (const [yy, w, len] of [
      [92, 2.5, 0.8],
      [146, 3.2, 1],
      [200, 2.5, 0.7],
    ]) {
      const cy = yy + p.ty,
        cx = CX + p.tx,
        rx = 150,
        ry = 26;
      for (const [a0, a1] of [
        [0.02, 0.02 + 0.3 * len],
        [0.98 - 0.3 * len, 0.98],
      ]) {
        const A = [cx + rx * Math.cos(Math.PI * a0), cy + ry * Math.sin(Math.PI * a0)];
        const B = [cx + rx * Math.cos(Math.PI * a1), cy + ry * Math.sin(Math.PI * a1)];
        out.push(
          `<path d="M${pt(A)} A${rx} ${ry} 0 0 1 ${pt(B)}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-opacity="${p.swirl}"/>`,
        );
      }
    }
  }
  function fall(out, p, ink, i) {
    for (let k = 0; k < 6; k++) {
      const x = CX + p.tx - 110 + k * 44 + (rnd(i * 7 + k) - 0.5) * 18;
      const y0 = 40 + p.ty - 60 - rnd(k + i) * 70,
        len = 50 + rnd(k * 3 + i) * 70;
      out.push(
        `<path d="M${f1(x)} ${f1(y0)} L${f1(x)} ${f1(y0 - len * p.fall)}" stroke="${ink}" stroke-width="2" stroke-opacity=".55" fill="none"/>`,
      );
    }
  }
  function lines(out, p, ink, i) {
    const cx = 155 + p.gx,
      cy = 180;
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * TAU + rnd(k + i * 3) * 0.2;
      const r0 = 190 + rnd(k * 5 + i) * 50,
        r1 = r0 + 90 + rnd(k) * 120;
      out.push(
        `<path d="M${f1(cx + Math.cos(a) * r0)} ${f1(cy + Math.sin(a) * r0 * 0.8)} L${f1(cx + Math.cos(a) * r1)} ${f1(cy + Math.sin(a) * r1 * 0.8)}" stroke="${ink}" stroke-width="${f1(1.5 + rnd(k * 9) * 2.5)}" fill="none"/>`,
      );
    }
  }
  function papers(out, p, ink) {
    const r = p.papers;
    for (const [dir, sp, col, spin] of [
      [-1, 1.1, "#d6e2bd", 20],
      [1, 1, "#efa991", -30],
      [1, 0.7, "#d6e2bd", 50],
    ]) {
      const x = 155 + p.gx + dir * (60 + 190 * r * sp),
        y = 250 - 150 * sp * r + 160 * r * r;
      const a = (spin * r * 6 * Math.PI) / 180,
        w = 20,
        h = 14;
      const corners = [
        [-w, -h],
        [w, -h],
        [w, h],
        [-w, h],
      ].map(([u, v]) => [
        x + u * Math.cos(a) - v * Math.sin(a) * 0.9,
        y + u * Math.sin(a) + v * Math.cos(a),
      ]);
      out.push(
        poly(
          corners,
          0,
          `fill="${col}" stroke="${ink}" stroke-width="2" opacity="${f1(1 - r * r)}"`,
        ),
      );
    }
  }

  // Timelines.
  const ease = {
    lin: (u) => u,
    in: (u) => u * u,
    out: (u) => 1 - (1 - u) * (1 - u),
    inout: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
    snap: () => 1,
  };
  function lerp(a, b, u) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
    if (Array.isArray(a)) return a.map((v, i) => lerp(v, b[i], u));
    if (a && typeof a === "object") {
      const o = {};
      for (const k in a) o[k] = k in b ? lerp(a[k], b[k], u) : a[k];
      return o;
    }
    return u < 0.5 ? a : b;
  }
  const resolve = (k) => Object.assign(structuredClone(P[k.pose || "rest"]), k);
  // keys: [{t, pose, ...overrides, ease, quant}]; fx(t) adds the effects for that moment.
  function poseAt(keys, t, fx) {
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
    const a = resolve(keys[i]),
      b = resolve(keys[i + 1]);
    const u = Math.min(1, Math.max(0, (t - keys[i].t) / (keys[i + 1].t - keys[i].t)));
    const p = lerp(a, b, ease[keys[i + 1].ease || "inout"](u));
    // Quantise the turn to a fixed turnaround set of drawings.
    const q = keys[i + 1].quant;
    if (q) p.th = Math.round(p.th * q) / q;
    p.gx = p.tx;
    return Object.assign(p, fx ? fx(t) : {});
  }

  /* Mounts a spec on an actor whose <svg> holds the original artwork in `g.body`.
     `region()` returns the page rectangle the drawings may occupy; everything outside it is
     clipped, so the spin, impact lines and flash never cross neighbouring content.
     `shake` is the element that takes the impact shake. Returns play(). */
  function mount(actor, spec, { region, shake }) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = actor.querySelector("svg"),
      base = svg.querySelector("g.body");
    const uid = `hiw-${Math.random().toString(36).slice(2, 8)}`;
    svg.insertAdjacentHTML(
      "afterbegin",
      `<defs><filter id="hiw-blur" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="3"/></filter><clipPath id="${uid}" clipPathUnits="userSpaceOnUse"><rect/></clipPath></defs>`,
    );
    const clip = svg.querySelector(`#${uid} rect`);
    const layer = document.createElementNS(ns, "g");
    layer.setAttribute("class", "flipbook-frames");
    layer.setAttribute("clip-path", `url(#${uid})`);
    svg.appendChild(layer);
    const times = new Set();
    for (const [a, b, fps] of spec.frames)
      for (let t = a; t < b - 0.5; t += 1000 / fps) times.add(Math.round(t));
    const list = [...times].sort((x, y) => x - y);
    layer.innerHTML = list
      .map((t, i) => `<g class="flipbook-frame">${draw(poseAt(spec.keys, t, spec.fx), i)}</g>`)
      .join("");
    const frames = [...layer.children];
    let anims = [];

    function fitClip() {
      const box = svg.getBoundingClientRect(),
        r = region();
      const k = box.width / svg.viewBox.baseVal.width;
      clip.setAttribute("x", f1((r.left - box.left) / k));
      clip.setAttribute("y", f1((r.top - box.top) / k));
      clip.setAttribute("width", f1(r.width / k));
      clip.setAttribute("height", f1(r.height / k));
    }
    function play() {
      for (const a of anims) a.cancel();
      anims = [];
      fitClip();
      const D = spec.duration;
      frames.forEach((g, i) => {
        const t0 = list[i],
          t1 = i + 1 < list.length ? list[i + 1] : D;
        anims.push(
          g.animate([{ visibility: "visible" }, { visibility: "visible" }], {
            delay: t0,
            duration: t1 - t0,
          }),
        );
      });
      anims.push(base.animate([{ opacity: 0 }, { opacity: 0 }], { duration: D }));
      for (const sh of spec.shake || []) {
        const kf = [];
        const n = Math.round((sh.dur / 1000) * 30);
        for (let k = 0; k <= n; k++) {
          const amp = sh.amp * (1 - k / n);
          kf.push({
            translate:
              k === n
                ? "0 0"
                : `${f1((k % 2 ? -1 : 1) * amp * (0.6 + rnd(k) * 0.4))}px ${f1((rnd(k + 5) - 0.5) * amp * 1.2)}px`,
            easing: "steps(1, end)",
          });
        }
        anims.push(shake.animate(kf, { delay: sh.at, duration: sh.dur }));
      }
      return anims;
    }
    return { play, duration: spec.duration, frames: list };
  }

  window.Flipbook = { mount };
})();
