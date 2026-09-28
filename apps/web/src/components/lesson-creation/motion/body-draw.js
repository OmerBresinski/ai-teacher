// Drawn bodies for the creation cast (UX ruling 114: smooth base, anime accents). Every path of a
// character is re-projected per frame from its artwork geometry: squash and stretch about the planted
// base with a side bulge, a breath that swells up from the base, a drawn lean, a three-quarter turn
// projected about the vertical axis (the face spots a little further), a knee drop, a stride drawn
// into the legs, a hop with tucked feet, Worksheet's page curl and Check's glasses slip. Nothing is
// a scale, skew or opacity on the drawing. At identity the artwork's own strings are written back,
// so the rest pose is pixel-identical to the artwork.

/** A fresh body pose. Zero/one values are the artwork. */
export const restBody = () => ({
  sx: 1,
  sy: 1,
  bulge: 0,
  swell: 0,
  lean: 0,
  th: 0,
  ty: 0,
  tuck: 0,
  stride: 0,
  curl: 0,
  slip: 0,
  shut: 0,
  spot: 0,
});
const REST = restBody();
const FIELDS = Object.keys(REST);

/** Geometry per character, in its own artwork space. `ground` is where the feet are planted. */
export const FRAMES = {
  support: { cx: 146, base: 228, top: 70, ground: 272, eyeY: 143 },
  activity: { cx: 150, base: 232, top: 32, ground: 275, eyeY: 108 },
  answers: { cx: 147, base: 224, top: 66, ground: 270, eyeY: 131 },
  slides: { cx: 0, base: 62, top: -78, ground: 90, eyeY: -12 },
};

/** Parse a path into absolute segments: M, L, Q, C, Z. H and V become L. */
function parse(d) {
  const out = [];
  const tokens = d.match(/[a-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const n = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(),
      C = cmd.toUpperCase();
    const ox = rel ? x : 0,
      oy = rel ? y : 0;
    if (C === "Z") {
      out.push({ c: "Z", p: [] });
      x = sx;
      y = sy;
      continue;
    }
    if (C === "M") {
      x = ox + n();
      y = oy + n();
      sx = x;
      sy = y;
      out.push({ c: "M", p: [x, y] });
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      x = ox + n();
      y = oy + n();
      out.push({ c: "L", p: [x, y] });
    } else if (C === "H") {
      x = ox + n();
      out.push({ c: "L", p: [x, y] });
    } else if (C === "V") {
      y = (rel ? y : 0) + n();
      out.push({ c: "L", p: [x, y] });
    } else if (C === "Q") {
      const p = [ox + n(), oy + n(), ox + n(), oy + n()];
      x = p[2];
      y = p[3];
      out.push({ c: "Q", p });
    } else if (C === "C") {
      const p = [ox + n(), oy + n(), ox + n(), oy + n(), ox + n(), oy + n()];
      x = p[4];
      y = p[5];
      out.push({ c: "C", p });
    } else i++;
  }
  // Straight edges become quadratics through their midpoint, so a bulge can bow them.
  let px = 0,
    py = 0,
    mx = 0,
    my = 0;
  return out.map((s) => {
    if (s.c === "M") {
      [px, py] = s.p;
      [mx, my] = s.p;
      return s;
    }
    if (s.c === "Z") {
      const q = { c: "Z", p: [], close: [(px + mx) / 2, (py + my) / 2, mx, my] };
      px = mx;
      py = my;
      return q;
    }
    if (s.c === "L") {
      const q = { c: "Q", p: [(px + s.p[0]) / 2, (py + s.p[1]) / 2, s.p[0], s.p[1]] };
      [px, py] = s.p;
      return q;
    }
    px = s.p[s.p.length - 2];
    py = s.p[s.p.length - 1];
    return s;
  });
}

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Mounts the drawing on a character's `.body`. `kind` picks the frame. Returns `paint(b, life)`,
 * where `b` is the body pose and `life` the breath (0..1 depth already scaled) and blink (0..1),
 * and `map(x, y)` for joints (shoulders, hips) in the same space.
 */
export function drawnBody(body, kind) {
  const f = FRAMES[kind];
  const H = f.base - f.top,
    G = f.ground - f.base;
  const parts = [];
  for (const el of body.querySelectorAll("path,circle,ellipse")) {
    if (el.closest(".arm-left,.arm-right,.arm,.fingers,.held")) continue;
    const face = !!el.closest(".gaze,.face,.glasses") || el.matches(".mouth,.eye");
    const glasses = !!el.closest(".glasses");
    const legs = el.matches(".limb") && !el.closest(".arm-left,.arm-right");
    const eye = el.matches(".eye") || !!el.closest(".eyes");
    if (el.tagName === "path") {
      const d = el.getAttribute("d");
      parts.push({ el, d, segs: parse(d), face, glasses, legs, eye, last: d });
    } else {
      const cx = Number(el.getAttribute("cx")),
        cy = Number(el.getAttribute("cy"));
      parts.push({ el, circle: true, cx, cy, face, glasses, eye, last: `${cx},${cy}` });
    }
  }
  let b = REST,
    breath = 0,
    lag = 0,
    // cached per paint
    a = 0,
    ca = 1,
    sa = 0,
    shear = 0,
    hipDrop = 0;
  function map(x, y, part) {
    let X = x - f.cx,
      Y = y;
    if (part?.glasses) Y += b.slip;
    if (part?.face) X += b.spot;
    const br = part?.face ? lag : breath;
    if (!part?.legs || y <= f.base) {
      const h = Math.max(0, Math.min(1.2, (f.base - y) / H));
      const w =
        b.sx * (1 + b.bulge * Math.sin(Math.PI * Math.min(1, h))) * (1 + (b.swell + br * 0.5) * h);
      Y = f.base + hipDrop - (f.base - y) * b.sy * (1 + br);
      X = X * w;
      // Worksheet's page curls at the top only (h squared), so its follow-through reads as paper.
      X += b.curl * h * h * 14;
      X += shear * (f.base - Y);
    } else {
      const t = Math.max(0, Math.min(1, (y - f.base) / G));
      const side = x < f.cx ? -1 : 1;
      const s = b.stride * side;
      X = X * (b.sx * (1 - t) + t) + s * t * 16;
      Y = y + hipDrop * (1 - t) - Math.max(0, s) * t * 9 - b.tuck * t * G * 0.7;
    }
    Y += b.ty;
    // Three-quarter turn: rotate about the vertical axis, then perspective about the eye line.
    const z = X * sa,
      k = 480 / (480 + z);
    return [f.cx + X * ca * k, f.eyeY + (Y - f.eyeY) * k];
  }
  function identity() {
    if (breath || lag) return false;
    for (const k of FIELDS) if (b[k] !== REST[k]) return false;
    return true;
  }
  function paint(pose, life = { breath: 0, lag: 0, blink: 0 }) {
    b = pose;
    breath = life.breath;
    lag = life.lag;
    a = b.th * Math.PI * 2;
    ca = Math.cos(a);
    sa = Math.sin(a);
    shear = Math.tan((b.lean * Math.PI) / 180);
    hipDrop = b.sy < 1 ? (1 - b.sy) * 0.35 * G : 0;
    const still = identity();
    const shut = Math.max(b.shut, life.blink);
    for (const part of parts) {
      if (part.circle) {
        const [cx, cy] = still ? [part.cx, part.cy] : map(part.cx, part.cy, part);
        const key = `${r1(cx)},${r1(cy)},${r1(shut * 100)}`;
        if (key === part.last) continue;
        part.last = key;
        part.el.setAttribute("cx", still ? String(part.cx) : r1(cx));
        part.el.setAttribute("cy", still ? String(part.cy) : r1(cy));
        if (part.eye) {
          if (shut > 0.01)
            part.el.setAttribute(
              "transform",
              `translate(0 ${r1(cy)}) scale(1 ${Math.max(0.1, 1 - shut).toFixed(3)}) translate(0 ${-r1(cy)})`,
            );
          else part.el.removeAttribute("transform");
        }
        continue;
      }
      let d = part.d;
      if (!still) {
        d = "";
        for (const s of part.segs) {
          if (s.c === "Z") {
            const [qx, qy] = map(s.close[0], s.close[1], part);
            const [ex, ey] = map(s.close[2], s.close[3], part);
            d += `Q${r1(qx)} ${r1(qy)} ${r1(ex)} ${r1(ey)}Z`;
            continue;
          }
          d += s.c;
          for (let i = 0; i < s.p.length; i += 2) {
            const [x, y] = map(s.p[i], s.p[i + 1], part);
            d += `${i ? " " : ""}${r1(x)} ${r1(y)}`;
          }
        }
      }
      if (part.eye) {
        // Fan-rig eyes are paths: blink by scaling about their own centre line.
        const key = `${r1(shut * 100)}`;
        if (key !== part.blink) {
          part.blink = key;
          const cy = f.eyeY;
          if (shut > 0.01)
            part.el.setAttribute(
              "transform",
              `translate(0 ${cy}) scale(1 ${Math.max(0.1, 1 - shut).toFixed(3)}) translate(0 ${-cy})`,
            );
          else part.el.removeAttribute("transform");
        }
      }
      if (d !== part.last) {
        part.last = d;
        part.el.setAttribute("d", d);
      }
    }
  }
  return {
    paint,
    /** Replace a path's source geometry (the deck's edge thickness changes with its look). */
    source(el, d) {
      const part = parts.find((q) => q.el === el);
      if (part) Object.assign(part, { d, segs: parse(d), last: "" });
    },
    /** A joint in artwork space under the current pose (shoulders, hips). */
    map: (x, y) => (identity() ? [x, y] : map(x, y, null)),
    frame: f,
  };
}

/**
 * Resting life for one character: a breath that differs every cycle (3.5-5.2 s, ~42 % in, 58 %
 * out, 1.5-2.6 % deep), the arms and face following 120 ms behind, and blinks at random gaps
 * (180 ms). `gaps` sets the persona's blink spacing; `double` is the chance of a double blink.
 */
export function restingLife({ gaps = [3, 5], double = 0, depth = 1 } = {}) {
  let t = Math.random() * 2,
    cycle = 4,
    inhale = 1.7,
    deep = 0.02,
    at = 0,
    nextBlink = gaps[0] + Math.random() * (gaps[1] - gaps[0]),
    blinkAt = -1,
    second = false;
  const history = [];
  const newBreath = () => {
    cycle = 3.5 + Math.random() * 1.7;
    inhale = cycle * (0.38 + Math.random() * 0.08);
    deep = (0.015 + Math.random() * 0.011) * depth;
    at = 0;
  };
  newBreath();
  const breathAt = (u) => {
    if (u < 0) return 0;
    if (u < inhale) return deep * 0.5 * (1 - Math.cos((Math.PI * u) / inhale));
    const out = cycle - inhale;
    return deep * 0.5 * (1 + Math.cos((Math.PI * Math.min(out, u - inhale)) / out));
  };
  return {
    /** Advance by `dt` seconds; `amount` 0..1 fades the life in or out. */
    step(dt, amount = 1) {
      t += dt;
      at += dt;
      if (at >= cycle) newBreath();
      history.push(breathAt(at));
      if (history.length > 8) history.shift();
      let blink = 0;
      if (blinkAt < 0 && t >= nextBlink) blinkAt = t;
      if (blinkAt >= 0) {
        const u = (t - blinkAt) / 0.18;
        blink = u < 1 ? 1 - Math.abs(u * 2 - 1) : 0;
        if (u >= 1) {
          blinkAt = -1;
          if (!second && Math.random() < double) {
            second = true;
            nextBlink = t + 0.12;
          } else {
            second = false;
            nextBlink = t + gaps[0] + Math.random() * (gaps[1] - gaps[0]);
          }
        }
      }
      return {
        breath: breathAt(at) * amount,
        // About 120 ms behind at 60 Hz.
        lag: (history[0] ?? 0) * amount,
        blink,
      };
    },
  };
}
