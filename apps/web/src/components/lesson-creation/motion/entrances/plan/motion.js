// Plan v6b, "Sets down, stands up": v6 with the audit gaps closed (POLISH-AUDIT-2).
// - It reads as Plan from the first beat. Lying down is drawn as a cheated top-down view (pitch
//   -1.2, not a sliver), and it peeks out from under its cover while it arrives: one eye, one mouth
//   corner. The cover claps shut on the stop, which is the anticipation for the flip.
// - The gather accelerates into the compression (ease in), then the spring is the fastest move.
// - The smoothing and the nod each start with a counter-move.
// - A 300 ms moving hold on the pleased pose (eyes closed, a 2% swell) before the settle.
// - From below it rises out of a slot fully closed, lands on its mark with a soft plie, then opens in
//   place and stands (Greg, 29 Sep; the tip-back version is motion.before-greg-below-fix.js).
// Timing chart and critique: NOTES.md. All four ways in share the keys from E.
(() => {
  const K = window.PlanKit, K5 = window.PlanKit5, CX = window.PlanRig.CX;
  const LIE = -1.2; // lying on its back, drawn a little from above so the cover and face read
  const TUCK = { L: [[0.5, 0.5, 0], [1, 1, 0]], R: [[-0.5, 0.5, 0], [-1, 1, 0]] };
  const FLAT = { pitch: LIE, cL: -1, cR: 0, pL: -1, pR: 0, ty: 42, gnd: 1, lim: 0, arms: TUCK, legs: TUCK };
  const PEEK = (w) => ({ ...FLAT, cL: -0.42, pL: -0.46, eyeDx: 3 * w, eyeDy: -2 }); // cover and its page lift together: the right page (an eye, half a smile) shows under them
  const OPEN = { pitch: LIE, ty: 42, gnd: 1, cL: 0, cR: 0, pL: 0, pR: 0 };
  const PROP_ARMS = { L: [[-26, 26, -12], [-34, 54, -30]], R: [[26, 26, -12], [34, 54, -30]] };
  const PROP_LEGS = { L: [[-8, 22, 12], [-16, 38, 22]], R: [[8, 22, 12], [16, 38, 22]] };
  const PRESS_ARMS = { L: [[-26, 10, 0], [-44, 30, 0]], R: [[26, 10, 0], [44, 30, 0]] };
  const KNEES = { L: [[-6, 22, 20], [-16, 40, 8]], R: [[6, 22, 20], [16, 40, 8]] };
  const FLING = { L: [[-30, -30, 6], [-40, -70, 8]], R: [[30, -30, 6], [42, -72, 8]] };
  const TUCKED = { L: [[-8, 28, 8], [-16, 40, 4]], R: [[8, 28, 8], [16, 40, 4]] };
  const REACH = { L: [[-6, 38, 2], [-14, 52, 2]], R: [[6, 38, 2], [14, 52, 2]] };
  const PLIE = { L: [[-20, 28, 0], [-34, 36, 0]], R: [[19, 28, 0], [34, 38, 0]] };
  const PLIE_ARMS = { L: [[-28, 18, 0], [-52, 14, 0]], R: [[28, 18, 0], [54, 12, 0]] };
  const GIVE = { L: [[-13, 36, 0], [-30, 41, 0]], R: [[12, 36, 0], [29, 43, 0]] };
  const DIP_ARMS = { L: [[-20, 30, 0], [-34, 30, 0]], R: [[20, 30, 0], [36, 28, 0]] }; // counter before the smooth
  const SMOOTH_TOP = { L: [[4, -44, 22], [38, -60, 24]], R: [[-4, -44, 22], [-38, -62, 24]] };
  const SMOOTH_BOT = { L: [[6, 30, 22], [38, 66, 24]], R: [[-6, 30, 22], [-38, 64, 24]] };
  const LOW = { L: [[-22, 24, 0], [-40, 12, 0]], R: [[22, 24, 0], [42, 10, 0]] };
  const C = 520; // contact, from E

  function tail(E) {
    const T = (t) => E + t;
    return [
      // shut tight on its spot (the anticipation for the flip)
      { t: T(0), ...FLAT, sx: 1.05 },
      // the flip: fast, smeared; pages trail 60 ms behind and land one way
      { t: T(110), ...OPEN, pL: -0.62, lim: 1, eyeDy: -3, eyes: "closed", arms: { L: [[-10, 8, 0], [-18, 14, 0]], R: [[10, 8, 0], [18, 14, 0]] }, legs: { L: [[-6, 20, 0], [-12, 26, 0]], R: [[6, 20, 0], [12, 26, 0]] }, ease: "in" },
      { t: T(180), ...OPEN, pL: 0.03, eyeDy: -3, ease: "out" },
      // props itself on its elbows, face to us (a push: ease out)
      { t: T(270), ...OPEN, pitch: -0.8, pL: -0.04, pR: -0.04, eyeDy: 1, mouth: "happy", arms: PROP_ARMS, legs: PROP_LEGS, ease: "out" },
      // anticipation: drops back and gathers, accelerating into the compression (ease in)
      { t: T(390), ...OPEN, sx: 1.06, sy: 0.96, pL: 0.03, pR: 0.03, eyeDy: -1, eyes: "closed", mouth: "happy", arms: PRESS_ARMS, legs: KNEES, ease: "in" },
      // SPRING (ease out from the push): past upright, lifted clear, stretched; arms lag
      { t: T(450), pitch: 0.16, ty: -30, gnd: 0, sy: 1.1, sx: 0.94, cL: 0.03, cR: 0.03, pL: 0.12, pR: 0.14, eyeDy: -2, mouth: "happy", arms: { L: [[-30, 0, 6], [-46, -30, 8]], R: [[30, 0, 6], [48, -32, 8]] }, legs: TUCKED, ease: "out" },
      { t: T(C - 1), pitch: 0.05, ty: 0, sy: 1.04, sx: 0.98, cL: 0, cR: 0, pL: 0.06, pR: 0.08, mouth: "happy", arms: FLING, legs: REACH, ease: "in" },
      // contact: snap to the plie (held 3 frames), then a moving hold; pages flop a frame late
      { t: T(C), pitch: 0.06, sy: 0.88, sx: 1.07, pL: 0.04, pR: 0.06, eyes: "closed", mouth: "happy", arms: FLING, legs: PLIE, ease: "snap" },
      { t: T(C + 110), pitch: 0.04, sy: 0.9, sx: 1.06, pL: -0.14, pR: -0.1, eyes: "closed", mouth: "happy", arms: PLIE_ARMS, legs: PLIE, ease: "out" },
      { t: T(C + 220), sy: 1.03, sx: 0.985, pL: -0.04, pR: -0.13, eyeDy: 1, mouth: "happy", arms: LOW, legs: GIVE, ease: "out" },
      // smoothing: a counter (hands dip), up to the top (ease out), sweep down into the page foot (ease in)
      { t: T(C + 300), sy: 1, pL: -0.06, pR: -0.07, mouth: "happy", arms: DIP_ARMS, eyeDy: 2, ease: "inout" },
      { t: T(C + 380), pL: -0.06, pR: -0.07, arms: SMOOTH_TOP, eyeDy: 4, mouth: "happy", ease: "out" },
      { t: T(C + 500), pL: 0, pR: -0.03, arms: SMOOTH_BOT, eyeDy: 4, mouth: "happy", ease: "in" },
      { t: T(C + 560), pL: 0, pR: 0.01, arms: LOW, eyeDy: 2, mouth: "happy", ease: "out" },
      // the nod: a small lift back first (counter), then a crisp dip, pages following through
      { t: T(C + 640), pitch: -0.07, faceDy: -1, eyeDy: -1, mouth: "happy", arms: LOW, ease: "out" },
      { t: T(C + 720), pitch: 0.24, faceDy: 5, eyes: "closed", mouth: "happy", arms: LOW, ease: "in" },
      { t: T(C + 770), pitch: 0.2, faceDy: 4, pL: -0.1, pR: -0.1, eyes: "closed", mouth: "happy", arms: LOW, ease: "out" },
      // up into the pleased pose, then a 300 ms moving hold (a 2% swell, pages easing open)
      { t: T(C + 880), pitch: 0.03, faceDy: 1, pL: -0.04, pR: -0.04, eyes: "closed", mouth: "happy", ease: "out" },
      { t: T(C + 1180), pitch: 0.01, sy: 1.02, sx: 0.995, pL: -0.01, pR: -0.02, eyes: "closed", mouth: "happy", ease: "inout" },
      // settle to rest
      { t: T(C + 1290), mouth: "happy", ease: "inout" },
      { t: T(C + 1340), mouth: "happy" },
    ];
  }

  function build(dir, ctx) {
    const room = (ctx && ctx.room) || { left: 999, right: 999 };
    let keys = [], E, mod = null, under = null;
    if (dir === "right" || dir === "left") {
      // slid across the ground; it peeks out from under its cover on the way, the cover claps shut on the stop
      const w = dir === "right" ? 1 : -1, SL = 380;
      const X0 = w > 0 ? room.right + 170 : -(room.left + 250);
      E = 440;
      keys = [
        { t: 0, ...FLAT, cL: -0.88, pL: -0.95, spd: 1 },
        { t: 130, ...PEEK(-w), spd: 0.8, ease: "out" },
        { t: SL - 40, ...PEEK(-w), cL: -0.42, pL: -0.46, eyeDx: -1 * w, spd: 0.2, ease: "inout" },
        { t: SL, ...PEEK(-w), cL: -0.42, pL: -0.46, eyeDx: 0, eyeDy: -1, spd: 0, ease: "out" },
        { t: SL + 50, ...FLAT, sx: 1.05, puff: 0.3, ease: "in" },
      ];
      mod = (p, t) => { p.tx = t < SL ? X0 * Math.pow(1 - t / SL, 2.2) : 0; };
      under = (p) => K5.slideLines(w > 0 ? CX + p.tx + 100 : CX + p.tx - 4, w, p.spd);
    } else if (dir === "above") {
      // dropped flat; peeks down at its spot on the way; lands on a cushion of air and the cover claps shut
      const D = 360;
      E = 440;
      keys = [
        { t: 0, ...FLAT, ty: -480, pitch: -1.05, gnd: 0 },
        { t: 150, ...PEEK(0), ty: -300, pitch: -1.1, gnd: 0, eyeDy: 2, ease: "in" },
        { t: D, ...PEEK(0), ty: 42, gnd: 1, eyeDy: 2, cL: -0.42, pL: -0.46, ease: "in" },
        { t: D + 60, ...FLAT, sx: 1.05, puff: 0.5, ease: "in" },
        { t: E, ...FLAT, sx: 1.05, puff: 1, ease: "out" },
      ];
      under = (p) => K5.puff(CX + p.tx - 8, CX + p.tx + 104, p.puff);
    } else {
      // below (Greg, 29 Sep: "it should arrive in as a closed book, then open"): the slot opens and it
      // rises out of it fully closed, decelerating onto its mark, and settles into a soft plie as the
      // closed book (held 3 frames, dust). Then, in place, the cover swings open with its page trailing,
      // the limbs unfold and it stands into its rest pose; then v6's smoothing and nod. No tip-back,
      // no second rise, nothing opens on the way up.
      const STAND = { ...FLAT, pitch: 0 };
      const LOWP = { L: [[-22, 24, 0], [-40, 12, 0]], R: [[22, 24, 0], [42, 10, 0]] };
      E = -60; // the shared tail joins at its smoothing counter, E + C + 300 = 760
      keys = [
        { t: 0, ...STAND, ty: 300, clipGround: true },
        { t: 50, ...STAND, ty: 300, clipGround: true },
        { t: 300, ...STAND, ty: 42, clipGround: true, ease: "out" },
        { t: 330, ...STAND, sy: 0.93, sx: 1.05, ease: "in" },
        { t: 420, ...STAND, ease: "out" },
        { t: 460, ...STAND, cL: -0.92, pL: -0.96, ease: "inout" },
        { t: 580, pitch: 0, ty: 18, gnd: 1, cL: 0, cR: 0, pL: -0.5, pR: 0, lim: 1, mouth: "happy", arms: LOWP, legs: REACH, ease: "out" },
        { t: 640, pitch: 0.02, ty: 0, sy: 1.02, sx: 0.99, cL: 0, cR: 0, pL: 0.05, pR: 0.07, mouth: "happy", arms: LOWP, legs: GIVE, ease: "out" },
        { t: 720, sy: 1, pL: -0.04, pR: -0.06, mouth: "happy", arms: LOW, legs: GIVE, ease: "inout" },
      ];
      mod = (p, t) => {
        p.slotX = 44;
        if (t < 500) { const o = t < 50 ? t / 50 : t < 300 ? 1 : Math.max(0, 1 - (t - 300) / 150); p.slot = K.sm(o); }
        if (t < 300) p.clipGround = true;
      };
      under = null;
      keys = [...keys, ...tail(E).filter((k) => k.t >= E + C + 300)];
    }
    if (dir !== "below") keys = [...keys, ...tail(E)];
    const below = dir === "below";
    const S0 = E + 390, S1 = E + C;
    return {
      duration: E + C + 1340, restAt: E + C + 1290, keys,
      holds: below ? [[330, 50, 400]] : [[S1, 50, E + C + 110]],
      mod(p, t) {
        if (mod) mod(p, t);
        const L = below ? 300 : S1; // the contact: the closed book's plie from below
        p.rk = !below && t > S0 && t < S1 + 40 ? (t - S0) / (S1 + 40 - S0) : 0;
        p.dk = t > L + 30 && t < L + 560 ? (t - L - 30) / 530 : 0;
        return p;
      },
      under(p) {
        return (under ? under(p) : "") + K5.riseLines(CX + p.tx, p.rk) + K5.dust([[CX + p.tx - 70, -1], [CX + p.tx + 78, 1]], p.dk);
      },
    };
  }
  window.SPECS = Object.fromEntries(["left", "right", "above", "below"].map((d) => [d, (ctx) => build(d, ctx)]));
})();
