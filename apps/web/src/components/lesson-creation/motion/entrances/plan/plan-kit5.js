/* Plan v5 kit: no flight, no wing beats. Shared by v5a|b|c: a bookmark ribbon (drawn strip with a
   swallowtail end), a calm decelerating walk with planted feet, and small ground accents (slide
   lines, a landing puff). Poses come from plan-rig.js; the concepts live in motion.js. */
(() => {
  const R0 = window.PlanRig, U = R0.util, K = window.PlanKit;
  const RIB = "#f5c054", F = 480, EYE = 150;

  // a ribbon along a centre polyline (screen units), with a swallowtail at the free (last) end
  function ribbon(pts, w = 7) {
    if (pts.length < 2) return "";
    const L = [], Rt = [], h = w / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      L.push([pts[i][0] - dy * h, pts[i][1] + dx * h]); Rt.push([pts[i][0] + dy * h, pts[i][1] - dx * h]);
    }
    const e = pts[pts.length - 1], q = pts[pts.length - 2], n = Math.hypot(e[0] - q[0], e[1] - q[1]) || 1;
    const notch = [e[0] - ((e[0] - q[0]) / n) * w * 0.8, e[1] - ((e[1] - q[1]) / n) * w * 0.8];
    return `<path d="M${L.map(U.pt).join(" L")} L${U.pt(notch)} L${Rt.reverse().map(U.pt).join(" L")}Z" fill="${RIB}" ${U.S(2)} stroke-linejoin="round"/>`;
  }
  // points on a quadratic from a via c to b, only the first `len` of its length
  function quad(a, c, b, len = 1, n = 16) {
    const o = [];
    for (let k = 0; k <= n; k++) {
      const u = (k / n) * len, v = 1 - u;
      o.push([v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]]);
    }
    return o;
  }

  // A calm walk: the body eases from X0 to 0 between t0 and t1 at a constant cadence, so the
  // strides shorten as it slows (even deceleration, no overshoot). The last two steps both land on
  // the mark, so the feet end together in the rest stance. Returns { X(t), steps } for PlanKit.feet.
  function walk(t0, t1, X0, n, lead = "L", pow = 1.7) {
    const T = (t1 - t0) / (n - 0.15);
    const X = (t) => X0 * Math.pow(1 - Math.min(1, Math.max(0, (t - t0) / (t1 - t0))), pow);
    const steps = { L: [], R: [] }, at = { L: X0, R: X0 };
    for (let k = 0; k < n; k++) {
      const f = (k % 2 === 0) === (lead === "L") ? "L" : "R", a = t0 + k * T, b = a + 0.85 * T;
      const to = k >= n - 2 ? 0 : X(b + 0.5 * T);
      steps[f].push([a, b, at[f], to]); at[f] = to;
    }
    for (const f of ["L", "R"]) if (!steps[f].length) steps[f].push([t1, t1 + 1, 0, 0]);
    return { X, steps, T };
  }

  // slide lines trailing a sliding book (screen units): three straight, soft lines on the ground
  function slideLines(x, w, k) {
    if (k < 0.04) return "";
    let d = "";
    for (const [dy, len, off] of [[-4, 1, 6], [-12, 0.7, 14], [3, 0.5, 22]]) {
      const x0 = x + w * off, x1 = x0 + w * 70 * len * k;
      d += `M${U.f1(x0)} ${R0.GROUND + dy} L${U.f1(x1)} ${R0.GROUND + dy}`;
    }
    return `<path d="${d}" ${U.S(2, U.f1(0.5 * Math.min(1, k * 1.5)))} fill="none" stroke-linecap="round"/>`;
  }
  // a soft landing: small curls of air pushed out along the ground either side, fading as they go
  function puff(x0, x1, k) {
    if (k <= 0.02 || k >= 0.98) return "";
    const o = U.f1(0.6 * Math.sin(Math.PI * k)), s = 10 + 26 * k, y = R0.GROUND - 3;
    let d = "";
    for (const [x, w] of [[x0, -1], [x1, 1]]) {
      d += `M${U.f1(x + w * (s - 10))} ${y} q${U.f1(w * 8)} -1 ${U.f1(w * 12)} -8`;
      d += `M${U.f1(x + w * (s - 4))} ${y + 2} l${U.f1(w * 14)} 0`;
    }
    return `<path d="${d}" ${U.S(2, o)} fill="none" stroke-linecap="round"/>`;
  }

  // v6: soft dust at the feet on the plant: small open curls rolling outward and up, fading
  function dust(xs, k) {
    if (k <= 0.01 || k >= 0.99) return "";
    const o = U.f1(0.55 * (1 - k) * Math.min(1, k * 6)), y = R0.GROUND - 1;
    let d = "";
    for (const [x, w] of xs) for (const [dx, r, dy] of [[4, 4, 0], [14, 3, -4], [9, 2.4, -9]]) {
      const cx = x + w * (dx + 20 * k), cy = y + dy - 8 * k, rr = r * (0.6 + 0.8 * k);
      d += `M${U.f1(cx - rr)} ${U.f1(cy)}a${U.f1(rr)} ${U.f1(rr)} 0 1 1 ${U.f1(rr * 1.6)} ${U.f1(rr * 0.9)}`;
    }
    return `<path d="${d}" ${U.S(1.8, o)} fill="none" stroke-linecap="round"/>`;
  }
  // v6: speed lines for the spring up: straight strokes either side, sliding up and thinning out
  function riseLines(x, k) {
    if (k <= 0.01 || k >= 0.99) return "";
    const o = U.f1(0.6 * Math.sin(Math.PI * k));
    let d = "";
    for (const [dx, y0, len] of [[-122, 250, 60], [-110, 200, 44], [122, 246, 58], [111, 196, 40]]) {
      const y = y0 - 110 * k;
      d += `M${U.f1(x + dx)} ${U.f1(y)} L${U.f1(x + dx)} ${U.f1(y - len * (1 - 0.5 * k))}`;
    }
    return `<path d="${d}" ${U.S(2, o)} fill="none" stroke-linecap="round"/>`;
  }

  window.PlanKit5 = { dust, riseLines, ribbon, quad, walk, slideLines, puff, RIB };
})();
