/* Plan v4 kit: the ways in (v3's flights, drop and climb, retimed to touch down at TL beside a spot
   X0 art units from the mark) and a stepping helper that keeps planted feet planted. The concepts
   (motion.js) take over from touchdown. Every concept ends on the rest keys, so all rest poses match. */
(() => {
  const REST_ARMS = { L: [[-21, 27, 0], [-40, 8, 0]], R: [[22, 28, 0], [44, 4, 0]] };
  const REST_LEGS = { L: [[-9, 40, 0], [-28, 42, 0]], R: [[9, 40, 0], [27, 44, 0]] };
  const UP = { L: [[-34, -24, 0], [-46, -64, 0]], R: [[34, -24, 0], [46, -64, 0]] };
  const DOWN = { L: [[-36, 16, 0], [-38, 54, 0]], R: [[36, 16, 0], [38, 54, 0]] };
  const LOW = { L: [[-22, 18, 0], [-38, 14, 0]], R: [[22, 18, 0], [38, 14, 0]] };
  const mirrorLegs = (l) => ({ L: l.R.map(([x, y, z]) => [-x, y, z]), R: l.L.map(([x, y, z]) => [-x, y, z]) });
  const sm = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };

  // ---- the ways in. Each returns { keys (ending on a touchdown-and-settle at `end`), mod, holds, end }
  function flight(s, P0, C, TL, X0) {
    const k = TL / 1000, T = (t) => Math.round(t * k);
    const path = (u) => { const v = 1 - u; return [v * v * P0[0] + 2 * v * u * C[0], v * v * P0[1] + 2 * v * u * C[1]]; };
    const along = (t) => { const u = Math.min(1, t / TL); return 1.45 * u - 0.45 * u * u; };
    const legsFly = { L: [[12, 26, -4], [30, 34, -6]], R: [[16, 24, -4], [36, 28, -6]] };
    const legsFlare = { L: [[-6, 34, 6], [-14, 50, 8]], R: [[4, 34, 6], [-4, 50, 8]] };
    const FLY = { th: -0.035 * s, lean: -0.06 * s, pitch: -0.18, sy: 1.03, sx: 0.98, eyeDx: -4 * s, eyeDy: 1, legs: s > 0 ? legsFly : mirrorLegs(legsFly) };
    const keys = [
      { t: 0, ...FLY, cL: 0.2, cR: 0.2, arms: UP },
      { t: T(160), ...FLY, cL: 0.26, cR: 0.26, arms: UP, bob: 4 },
      { t: T(250), ...FLY, cL: 0.3, cR: 0.3, arms: UP, sy: 1.05, sx: 0.97, bob: 6 },
      { t: T(370), ...FLY, cL: -0.12, cR: -0.12, arms: DOWN, sy: 0.96, sx: 1.03, bob: -14, ease: "in" },
      { t: T(430), ...FLY, cL: -0.08, cR: -0.08, arms: DOWN, bob: -20, ease: "out" },
      { t: T(600), ...FLY, cL: 0.24, cR: 0.24, arms: UP, bob: -8 },
      { t: T(680), ...FLY, cL: 0.3, cR: 0.3, arms: UP, bob: -4 },
      { t: T(770), ...FLY, cL: -0.06, cR: -0.06, arms: DOWN, sy: 0.97, bob: -16, ease: "in" },
      { t: T(880), th: -0.04 * s, lean: 0.03 * s, pitch: -0.14, sy: 1.04, sx: 0.98, cL: 0.05, cR: 0.05, pL: -0.02, pR: -0.02, bob: -4, eyeDx: -1 * s, eyeDy: 3,
        arms: { L: [[-20, 2, 0], [-38, -4, 0]], R: [[20, 2, 0], [38, -4, 0]] }, legs: s > 0 ? legsFlare : mirrorLegs(legsFlare), ease: "out" },
      { t: TL, pitch: -0.04, sy: 1.02, cL: 0.02, cR: 0.02, pL: -0.08, pR: -0.08, eyeDy: 2, arms: LOW, ease: "in" },
      // a small give on touchdown (the full plie is saved for the mark)
      { t: TL + 83, sy: 0.95, sx: 1.03, pitch: 0.02, pL: -0.1, pR: -0.1, arms: { L: [[-24, 28, 0], [-40, 22, 0]], R: [[24, 28, 0], [40, 22, 0]] },
        legs: { L: [[-13, 36, 0], [-30, 41, 0]], R: [[12, 36, 0], [29, 43, 0]] }, ease: "out" },
      { t: TL + 170, pL: -0.03, pR: -0.03, mouth: "happy" },
    ];
    return {
      keys, holds: [[TL + 83, 42, TL + 150]], end: TL + 170,
      mod(p, t) { if (t < TL) { const [x, y] = path(along(t)); p.tx = X0 + x; p.ty = y; } else p.tx = X0; },
    };
  }

  function above(TL, X0) {
    const k = TL / 1050, T = (t) => Math.round(t * k), TOP = -470;
    const HANG = { L: [[-5, 40, 0], [-9, 53, 2]], R: [[5, 40, 0], [9, 54, 2]] };
    const DROP = { th: 0, lean: 0, pitch: -0.1, sy: 1.05, sx: 0.97, eyeDy: 3, legs: HANG };
    const REACHDOWN = { L: [[-8, 36, 4], [-16, 52, 6]], R: [[8, 36, 4], [16, 52, 6]] };
    const keys = [
      { t: 0, ...DROP, ty: TOP, cL: 0.32, cR: 0.32, pL: 0.36, pR: 0.36, arms: UP },
      { t: T(430), ...DROP, ty: -250, cL: 0.34, cR: 0.34, pL: 0.38, pR: 0.38, arms: UP, sy: 1.07, sx: 0.96, ease: "in" },
      { t: T(480), ...DROP, ty: -214, cL: 0.4, cR: 0.4, arms: { L: [[-30, -30, 0], [-40, -70, 0]], R: [[30, -30, 0], [40, -70, 0]] }, ease: "lin" },
      { t: T(590), ...DROP, ty: -168, cL: -0.14, cR: -0.14, pL: -0.02, pR: -0.02, arms: DOWN, sy: 0.95, sx: 1.04, ease: "in" },
      { t: T(660), ...DROP, ty: -150, cL: -0.1, cR: -0.1, arms: DOWN, sy: 1, ease: "out" },
      { t: T(820), ...DROP, ty: -96, cL: 0.28, cR: 0.28, pL: 0.32, pR: 0.32, arms: UP },
      { t: T(870), ...DROP, ty: -80, cL: 0.34, cR: 0.34, arms: UP, ease: "lin" },
      { t: T(960), ...DROP, ty: -40, cL: -0.08, cR: -0.08, pL: 0, pR: 0, arms: DOWN, sy: 0.97, legs: REACHDOWN, eyeDy: 4, ease: "in" },
      { t: TL, pitch: 0, sy: 1.03, sx: 0.98, ty: 0, cL: 0.03, cR: 0.03, pL: 0.06, pR: 0.06, eyeDy: 4, arms: LOW, ease: "in" },
      { t: TL + 100, sy: 0.9, sx: 1.06, pitch: 0.08, faceDy: 2, pL: -0.14, pR: -0.14, eyes: "closed",
        arms: { L: [[-24, 34, 0], [-36, 40, 0]], R: [[24, 34, 0], [36, 40, 0]] }, legs: { L: [[-20, 30, 0], [-32, 39, 0]], R: [[18, 30, 0], [32, 41, 0]] }, ease: "out" },
      { t: TL + 240, pL: -0.04, pR: -0.04, mouth: "happy" },
    ];
    return { keys, holds: [[TL + 100, 58, TL + 190]], end: TL + 240, mod(p) { p.tx = X0; } };
  }

  function below(TL, X0) {
    const k = TL / 1020, T = (t) => Math.round(t * k), SHUT = 0.28;
    const HANDS_UP = { L: [[-18, -50, 0], [-26, -102, 0]], R: [[18, -50, 0], [26, -102, 0]] };
    const PLANT = { L: [[-28, -52, 0], [-62, -46, 0]], R: [[28, -52, 0], [62, -46, 0]] };
    const PUSH = { L: [[-34, -6, 0], [-60, 18, 0]], R: [[34, -6, 0], [60, 18, 0]] };
    const PRESS = { L: [[-30, 24, 0], [-52, 48, 0]], R: [[30, 24, 0], [52, 48, 0]] };
    const TUCK = { L: [[-6, 38, 0], [-10, 50, 0]], R: [[6, 38, 0], [10, 50, 0]] };
    const CLIMB = { th: 0, pitch: 0.06, sy: 1.03, sx: 0.98, cL: SHUT, cR: SHUT, pL: SHUT + 0.02, pR: SHUT + 0.02, eyeDy: -3, legs: TUCK, clipGround: true };
    const keys = [
      { t: 0, ...CLIMB, ty: 230, arms: HANDS_UP },
      { t: T(300), ...CLIMB, ty: 230, arms: HANDS_UP },
      { t: T(440), ...CLIMB, ty: 200, arms: HANDS_UP, ease: "out" },
      { t: T(540), ...CLIMB, ty: 180, arms: PLANT, eyeDy: -1, ease: "inout" },
      { t: T(600), ...CLIMB, ty: 186, arms: PLANT, sy: 0.98, sx: 1.01, eyeDy: -1, ease: "out" },
      { t: T(780), ...CLIMB, ty: 70, arms: PUSH, sy: 1.05, sx: 0.97, eyeDy: 0, ease: "inout" },
      { t: T(865), ...CLIMB, ty: 38, arms: PRESS, eyeDy: 1, legs: { L: [[-14, 20, -6], [-24, 34, -6]], R: [[6, 40, 0], [10, 52, 0]] }, lean: -0.02, ease: "out" },
      { t: T(945), ...CLIMB, ty: 14, arms: PRESS, eyeDy: 1, legs: { L: [[-10, 40, 0], [-26, 43, 0]], R: [[14, 22, -6], [24, 36, -6]] }, lean: 0.02, ease: "inout" },
      { t: TL, ...CLIMB, ty: 0, pitch: 0, arms: REST_ARMS, eyeDy: 2, legs: REST_LEGS, lean: 0, clipGround: false, ease: "out" },
      // the pop: folds a touch further, knees give, the covers spring open, pages following
      { t: TL + 63, sy: 0.95, sx: 1.03, cL: 0.33, cR: 0.33, pL: 0.35, pR: 0.35, eyes: "closed", arms: { L: [[-20, 20, 0], [-34, 24, 0]], R: [[20, 20, 0], [34, 24, 0]] },
        legs: { L: [[-14, 35, 0], [-28, 41, 0]], R: [[12, 35, 0], [28, 43, 0]] }, ease: "inout" },
      { t: TL + 190, sy: 1.02, sx: 0.99, cL: 0, cR: 0, pL: 0.12, pR: 0.12, mouth: "happy", eyeDy: 1, arms: { L: [[-26, 14, 0], [-46, 0, 0]], R: [[26, 14, 0], [48, -2, 0]] }, ease: "out" },
      { t: TL + 270, pL: -0.03, pR: -0.03, mouth: "happy", ease: "out" },
    ];
    return {
      keys, holds: [], end: TL + 270,
      mod(p, t) {
        p.tx = X0; p.slotX = X0;
        if (t < TL + 120) {
          const a = T(200), b = T(360), c = TL - 60;
          let o = t < a ? 0 : t < b ? (t - a) / (b - a) : t < c ? 1 : Math.max(0, 1 - (t - c) / 170);
          p.slot = sm(o);
        }
      },
    };
  }

  // dir + stage room -> the way in, touching down X0 from the mark (X0 > 0: right of it)
  function approach(dir, { TL, X0, ctx }) {
    if (dir === "right") return flight(1, [660, -150], [250, -40], TL, X0);
    // from the left: across from the screen edge on phones, over the top on desktop; where there is
    // no room to touch down left of the mark it comes over the top and touches down right of it
    if (dir === "left") return ctx && ctx.stageAtScreenEdge && X0 < 0 ? flight(-1, [-660, -150], [-250, -40], TL, X0) : flight(-1, [-150 - Math.max(0, X0), -640], [-130 - Math.max(0, X0) * 0.5, -50], TL, X0);
    if (dir === "above") return above(TL + 60, X0);
    return below(TL + 60, X0);
  }

  // where to touch down: beside the mark on the side it came from, never outside the stage
  function spot(dir, dist, ctx) {
    if (dir === "left") {
      // keep the left arm (art x 17) on screen; with too little room, touch down on the right instead
      const room = ((ctx && ctx.room && ctx.room.left) ?? 999) + 11;
      if (room >= dist * 0.7) return -Math.min(dist, room);
      dir = "right";
    }
    return Math.min(dist, Math.max(0, ((ctx && ctx.room && ctx.room.right) || 999) + 20));
  }

  // steps: per foot, [lift, land, fromX, toX] in art units along the ground. Planted feet stay put
  // while the body moves over them; the swinging foot lifts in an arc, toe down.
  const ANK = { L: [-9, 40], R: [9, 40] }, TOE = { L: [-19, 2], R: [18, 4] };
  function feet(p, t, plan) {
    const yaw = Math.max(0.5, Math.cos(2 * Math.PI * p.th));
    let lift = 0;
    for (const f of ["L", "R"]) {
      const segs = plan[f];
      if (!segs) continue;
      let x = segs[0][2], h = 0, u = 0;
      for (const [a, b, x0, x1] of segs) {
        if (t < a) { x = x0; break; }
        if (t < b) { u = (t - a) / (b - a); x = x0 + (x1 - x0) * sm(u); h = Math.sin(Math.PI * u) * 12; break; }
        x = x1;
      }
      const ax = ANK[f][0] + (x - p.tx) / yaw, ay = ANK[f][1] - h;
      const toe = h > 0.5 ? [TOE[f][0] * 0.8, TOE[f][1] + h * 0.45] : TOE[f];
      p.legs[f] = [[ax, ay, 0], [ax + toe[0], ay + toe[1], 0]];
      lift = Math.max(lift, h);
    }
    p.bob -= lift * 0.3; // the body rises a touch over the passing foot
    return lift;
  }
  // body travel between two times, eased in and out (calm, no overshoot)
  const travel = (t, a, b, x0, x1) => x0 + (x1 - x0) * sm((t - a) / (b - a));

  window.PlanKit = { approach, spot, feet, travel, sm, REST_ARMS, REST_LEGS, UP, DOWN, LOW };
})();
