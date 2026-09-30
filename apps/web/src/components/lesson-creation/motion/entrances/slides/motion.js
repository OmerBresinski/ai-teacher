// v4a Bounce (1.9 s): the shipped burst, slowed, no black flash. Overshoots off the impact into
// a happy rebound hop, lands a second time smaller, pops a hero pose, settles.
const IN = (t1, t2) => [
  { t: 0, pose: "tuck", tx: 560, ty: -340, th: 0, smear: 1, swirl: 0.8, smearDx: 40, smearDy: -26 },
  { t: t1, pose: "tuck", tx: 210, ty: -180, th: 1, smear: 1, swirl: 0.8, smearDx: 30, smearDy: -14, ease: "lin", quant: 6 },
  { t: t2, pose: "tuck", tx: 30, ty: -95, th: 2, smear: 1, swirl: 0.8, smearDx: 12, smearDy: -6, ease: "lin", quant: 6 },
];
window.SPEC = {
  duration: 1900, impact: 840, poses: window.SLIDES_POSES,
  keys: [
    ...IN(300, 640),
    { t: 740, pose: "stretch", tx: 6, ty: -60, th: 2, smear: 0, swirl: 0, ease: "in" },
    { t: 840, pose: "stretch", tx: 0, ty: -10, th: 2, ease: "in" },
    { t: 841, pose: "squash", th: 2, ease: "snap" },
    { t: 960, pose: "squash", th: 2, sy: 0.7, sx: 1.2 },
    { t: 1080, pose: "rebound", th: 2, ty: -46, ease: "out" },
    { t: 1180, pose: "land2", th: 2, ty: 0, ease: "in" },
    { t: 1290, pose: "hero", th: 2, ease: "out" },
    { t: 1620, pose: "hero", th: 2 },
    { t: 1790, pose: "rest_happy", th: 2 },
    { t: 1900, pose: "rest_happy", th: 2 },
  ],
  frames: [[0, 840, 24], [840, 1290, 24], [1290, 1900, 12]],
  fx: (t) => {
    const o = {};
    if (t >= 680 && t < 840) o.fall = 1;
    if (t >= 840 && t < 1000) o.lines = true;
    if (t >= 840 && t < 1320) { o.ring = (t - 840) / 480; o.ringSize = 1.1; }
    if (t >= 880 && t < 1440) { o.dust = (t - 880) / 560; o.dustSize = 1.2; }
    if (t >= 860 && t < 1500) o.papers = (t - 860) / 640;
    return o;
  },
  shake: [{ at: 840, dur: 280, amp: 9 }, { at: 1180, dur: 110, amp: 3 }],
};

/* ---- v3: four entry directions. `right` above is the approved v4a-final entrance, untouched.
   The others are choreographed for Slides rather than mirrored: the drawings are projected from
   the 3D card, so turning the other way (spin -1) redraws the turnarounds with the card's
   picture reading the right way round. All four end on the same rest pose. */
window.SLIDES_POSES_V3 = {
  ...window.SLIDES_POSES,
  // twirl with the arms out level and the knees tucked: stays low enough to spin under the rule
  pop: {
    sy: 1.06, sx: 0.95,
    arms: { L: [[-150, 92, 6], [-186, 72, 10]], R: [[138, 98, 6], [176, 76, 10]] },
    legs: { L: [[-112, 250, 10], [-86, 266, 0]], R: [[84, 248, 10], [60, 264, 0]] },
    mouth: "happy",
  },
};
window.SPECS = {
  right: window.SPEC,

  // Left: dives in from the upper left turning the other way, touches down short of its mark
  // with the momentum still in it (the squash leans forward), and the rebound hop carries it
  // onto the mark, where the top sways past and back once.
  // `left` (artwork units, from the layout) shortens the skip where the screen edge is close.
  left: ({ left = -85 } = {}) => {
    const S = Math.max(-62, Math.min(-20, left + 17)); // where it first touches down
    return {
    duration: 1920, impact: 860, spin: -1, smearUntil: 620, poses: window.SLIDES_POSES_V3,
    keys: [
      { t: 0, pose: "tuck", tx: -600, ty: -330, th: 0, smear: 1, swirl: 0.8, smearDx: -44, smearDy: -24 },
      { t: 250, pose: "tuck", tx: -190, ty: -190, th: -0.9, smear: 1, swirl: 0.8, smearDx: -30, smearDy: -16, ease: "lin" },
      { t: 620, pose: "tuck", tx: -104, ty: -98, th: -2, smear: 1, swirl: 0.8, smearDx: -12, smearDy: -8, ease: "lin" },
      { t: 760, pose: "stretch", tx: S - 18, ty: -58, th: -2, smear: 0, swirl: 0, lean: 0.06, ease: "in" },
      { t: 860, pose: "stretch", tx: S - 2, ty: -10, th: -2, lean: 0.1, ease: "in" },
      { t: 861, pose: "squash", tx: S, th: -2, lean: 0.07, ease: "snap" },
      { t: 980, pose: "squash", tx: S + 2, th: -2, sy: 0.7, sx: 1.2, lean: 0.03 },
      { t: 1110, pose: "rebound", tx: S * 0.45, ty: -52, th: -2, lean: 0.06, ease: "out" },
      { t: 1220, pose: "land2", tx: 0, ty: 0, th: -2, lean: 0.07, ease: "in" },
      { t: 1330, pose: "hero", th: -2, lean: -0.03, ease: "out" },
      { t: 1460, pose: "hero", th: -2, lean: 0 },
      { t: 1650, pose: "hero", th: -2 },
      { t: 1810, pose: "rest_happy", th: -2 },
      { t: 1920, pose: "rest_happy", th: -2 },
    ],
    fx: (t) => {
      const o = {};
      if (t >= 860 && t < 1600) o.gx = S; // the ring and dust stay where it hit
      if (t >= 700 && t < 860) o.fall = 1;
      if (t >= 860 && t < 1020) o.lines = true;
      if (t >= 860 && t < 1340) { o.ring = (t - 860) / 480; o.ringSize = 1.1; }
      if (t >= 900 && t < 1460) { o.dust = (t - 900) / 560; o.dustSize = 1.2; }
      if (t >= 880 && t < 1520) o.papers = (t - 880) / 640;
      return o;
    },
    shake: [{ at: 860, dur: 280, amp: 9 }, { at: 1220, dur: 110, amp: 3 }],
    };
  },

  // Above: tossed in from overhead, it twirls to a stop, hangs for a beat with its arms up,
  // then drops like a stone. Deeper squash held longer, a bigger shake and a wider ring,
  // and a lower, heavier rebound.
  above: {
    duration: 1980, impact: 900, hold: 75, smearUntil: 420, poses: window.SLIDES_POSES_V3,
    keys: [
      { t: 0, pose: "tuck", tx: 0, ty: -420, th: 0, smear: 1, swirl: 0.7, smearDx: 0, smearDy: -24 },
      { t: 240, pose: "tuck", tx: 0, ty: -186, th: 1, smear: 1, swirl: 0.7, smearDx: 0, smearDy: -12, ease: "out" },
      { t: 420, pose: "tuck", tx: 0, ty: -168, th: 2, smear: 1, swirl: 0.35, smearDx: 0, smearDy: -4, ease: "out" },
      { t: 500, pose: "stretch", ty: -160, th: 2, smear: 0, swirl: 0, sy: 1.18, ease: "inout" },
      { t: 580, pose: "stretch", ty: -157, th: 2, sy: 1.14 },
      { t: 900, pose: "stretch", ty: -10, th: 2, sy: 1.34, sx: 0.76, ease: "in" },
      { t: 901, pose: "squash", th: 2, sy: 0.56, sx: 1.32, bulge: 0.14, ease: "snap" },
      { t: 1060, pose: "squash", th: 2, sy: 0.6, sx: 1.28, bulge: 0.12 },
      { t: 1180, pose: "rebound", th: 2, ty: -26, ease: "out" },
      { t: 1270, pose: "land2", th: 2, ty: 0, ease: "in" },
      { t: 1380, pose: "hero", th: 2, ease: "out" },
      { t: 1700, pose: "hero", th: 2 },
      { t: 1870, pose: "rest_happy", th: 2 },
      { t: 1980, pose: "rest_happy", th: 2 },
    ],
    fx: (t) => {
      const o = {};
      if (t >= 620 && t < 900) o.fall = 1;
      if (t >= 900 && t < 1080) o.lines = true;
      if (t >= 900 && t < 1420) { o.ring = (t - 900) / 520; o.ringSize = 1.3; }
      if (t >= 930 && t < 1530) { o.dust = (t - 930) / 600; o.dustSize = 1.4; }
      if (t >= 920 && t < 1560) o.papers = (t - 920) / 640;
      return o;
    },
    shake: [{ at: 900, dur: 330, amp: 12 }, { at: 1270, dur: 110, amp: 3 }],
  },

  // Below: a hole opens in the floor, two eyes peek over the lip, it dips and pops out of the
  // floor like toast, twirls with its arms out, and comes down on its mark with the same
  // impact, rebound and hero as the approved entrance. Nothing crosses the copy under the
  // floor: the character is clipped at the hole's front lip until it is out. `ceil` (artwork
  // units, from the layout) keeps the twirl under the rule on narrow screens.
  below: ({ ceil = -200 } = {}) => {
    const A = Math.max(-170, Math.min(-40, ceil - 49 + 4));
    return {
      duration: 1960, impact: 900, smearUntil: 780, poses: window.SLIDES_POSES_V3,
      keys: [
        { t: 0, pose: "rest", ty: 300, th: 0 },
        { t: 140, pose: "rest", ty: 140, th: 0, head: 0, ease: "out" },
        { t: 200, pose: "rest", ty: 140, th: 0, head: 0 },
        { t: 201, pose: "rest", ty: 140, th: 0, head: -0.09, ease: "snap" },
        { t: 280, pose: "rest", ty: 140, th: 0, head: -0.09 },
        { t: 281, pose: "rest", ty: 140, th: 0, head: 0.09, ease: "snap" },
        { t: 350, pose: "rest", ty: 140, th: 0, head: 0.09 },
        { t: 400, pose: "land2", ty: 170, th: 0, ease: "inout" },
        { t: 530, pose: "pop", ty: A * 0.8, sy: 1.22, sx: 0.86, th: 0.3, smear: 1, smearDy: 12, ease: "out" },
        { t: 660, pose: "pop", ty: A, th: 1.1, smear: 1, smearDy: 4, swirl: 0.5, ease: "out" },
        { t: 780, pose: "pop", ty: A * 0.55, th: 2, smear: 1, smearDy: -8, swirl: 0.3, ease: "in" },
        { t: 900, pose: "stretch", ty: -10, th: 2, smear: 0, swirl: 0, ease: "in" },
        { t: 901, pose: "squash", th: 2, ease: "snap" },
        { t: 1020, pose: "squash", th: 2, sy: 0.7, sx: 1.2 },
        { t: 1140, pose: "rebound", th: 2, ty: -46, ease: "out" },
        { t: 1240, pose: "land2", th: 2, ty: 0, ease: "in" },
        { t: 1350, pose: "hero", th: 2, ease: "out" },
        { t: 1680, pose: "hero", th: 2 },
        { t: 1850, pose: "rest_happy", th: 2 },
        { t: 1960, pose: "rest_happy", th: 2 },
      ],
      fx: (t) => {
        const o = {};
        if (t < 530) o.floor = true;
        const hole = t < 120 ? t / 120 : t < 560 ? 1 : t < 700 ? 1 - (t - 560) / 140 : 0;
        if (hole > 0) o.hole = hole;
        if (t >= 410 && t < 680) o.rise = (t - 410) / 270;
        if (t >= 800 && t < 900) o.fall = 1;
        if (t >= 900 && t < 1060) o.lines = true;
        if (t >= 900 && t < 1380) { o.ring = (t - 900) / 480; o.ringSize = 1.1; }
        if (t >= 940 && t < 1500) { o.dust = (t - 940) / 560; o.dustSize = 1.2; }
        if (t >= 920 && t < 1560) o.papers = (t - 920) / 640;
        return o;
      },
      // the hole and the lines the pop leaves behind, drawn under the character
      under: (p) => {
        const o = [], s = (n) => Math.round(n * 10) / 10;
        if (p.hole) {
          const e = Math.sin((Math.PI / 2) * p.hole);
          o.push(`<ellipse cx="155" cy="277" rx="${s(128 * e)}" ry="${s(9 * e)}" fill="#293b32" fill-opacity=".2" stroke="#293b32" stroke-width="2.5"/>`);
        }
        if (p.rise != null) {
          const r = p.rise;
          for (const [x, l] of [[-78, 0.7], [-40, 1], [0, 0.8], [40, 1], [78, 0.65]]) {
            const y0 = 266 - 30 * r, len = (40 + 70 * l) * Math.sin(Math.PI * Math.min(1, r * 1.4));
            o.push(`<path d="M${155 + x} ${s(y0)} L${155 + x} ${s(y0 - len)}" stroke="#293b32" stroke-width="2" stroke-opacity="${s(0.6 * (1 - r))}" fill="none"/>`);
          }
        }
        return o.join("");
      },
      // the hole's front lip, over the card, so it reads as climbing out of the floor
      over: (p) => {
        if (!p.hole) return "";
        const e = Math.sin((Math.PI / 2) * p.hole), s = (n) => Math.round(n * 10) / 10, rx = s(128 * e), ry = s(9 * e);
        return `<path d="M${s(155 + rx)} 277 A${rx} ${ry} 0 0 1 ${s(155 - rx)} 277" fill="none" stroke="#293b32" stroke-width="2.5"/>`;
      },
      shake: [{ at: 900, dur: 280, amp: 9 }, { at: 1240, dur: 110, amp: 3 }],
    };
  },
};
