// Persona choreography for the creation cast. Times are in ms at timeScale 1 and follow the timing
// chart in quality-prd/creation-motion/v2/NOTES.md. Every tween names its ease: contacts ease in,
// pushes ease out, travel is linear or the persona's, settles and gestures in the air are inOut.
// A "snap" is a `set` followed by a 2-3 frame hold. Characters never fade: they arrive and leave
// on their own feet through the stage's soft edge and are hidden only while off stage.

const PLAN = 0,
  SLIDES = 1,
  WORKSHEET = 2;

/** Timeline helpers bound to one timeline. */
function kit(tl) {
  const s = (ms) => ms / 1000;
  const to = (target, values, from, until, ease) =>
    tl.to(target, { ...values, duration: s(until - from), ease }, s(from));
  const snap = (target, values, at) => tl.set(target, values, s(at));
  /** A contact: a short eased move into the pose, never a one-frame cut (ruling 114, restraint). */
  const hit = (target, values, at, dur = 90, ease = "power2.out") =>
    tl.to(target, { ...values, duration: s(dur), ease }, s(at));
  /** A drawn walk or run: the stride swings `steps` times between two ms marks. */
  const stride = (b, from, until, steps, ease = "none") => {
    const phase = { v: 0 };
    tl.to(
      phase,
      {
        v: steps * Math.PI,
        duration: s(until - from),
        ease,
        onUpdate: () => {
          b.stride = Math.sin(phase.v);
        },
      },
      s(from),
    );
    snap(b, { stride: 0 }, until);
  };
  const call = (fn, at) => tl.call(fn, [], s(at));
  return { s, to, snap, hit, stride, call };
}

/**
 * The receiver arrives from off stage right to `xm`, in its persona's way. Returns the ms when it
 * is ready to take the prop and when its arrival has settled.
 */
function arrive(k, ctx, who, a, t0, xm) {
  const { to, snap, hit, stride, call } = k;
  const b = a.b;
  const x0 = xm + 220;
  if (who === WORKSHEET) {
    // Sprints in side-on, plants a heel, stops dead with a skid; the page curls and snaps back.
    snap(a, { x: x0, alpha: 1 }, t0);
    snap(b, { lean: -9, th: -0.1, curl: -0.6, sy: 1.02, sx: 0.98 }, t0);
    // The brake starts at the sprint's own speed (3 x 20 / 80 ms = 200 / 250 ms): no kink.
    to(a, { x: xm + 20 }, t0, t0 + 250, "none");
    stride(b, t0, t0 + 250, 3);
    to(a, { x: xm }, t0 + 250, t0 + 330, "power3.out");
    to(b, { lean: 7, curl: -0.2, sy: 1.04, sx: 0.97 }, t0 + 250, t0 + 300, "power2.out");
    hit(b, { lean: 0, sy: 0.9, sx: 1.08, bulge: 0.04, stride: 0 }, t0 + 300);
    hit(b, { curl: 0.7 }, t0 + 317);
    call(() => {
      ctx.puff(xm, 0.9);
    }, t0 + 300);
    to(b, { sy: 0.93, sx: 1.05, bulge: 0.03 }, t0 + 350, t0 + 470, "sine.inOut");
    to(b, { curl: 0 }, t0 + 350, t0 + 520, "power3.out");
    to(b, { sy: 1, sx: 1, bulge: 0, th: -0.05 }, t0 + 470, t0 + 560, "power3.out");
    return { ready: t0 + 470, end: t0 + 560 };
  }
  if (who === SLIDES) {
    // Bounds in: a first hop, a crouch, a bigger hop, an impact squash, a rebound, a second
    // smaller landing with shut eyes, a hero pop, rest. Units are the deck's (x1.2 on stage).
    snap(a, { x: x0, alpha: 1 }, t0);
    snap(b, { ty: -32, sy: 1.1, sx: 0.92, tuck: 0.5, th: -0.04 }, t0);
    to(a, { x: xm + 105 }, t0, t0 + 200, "none");
    to(b, { ty: 0 }, t0, t0 + 200, "sine.inOut");
    // The first landing runs straight into the crouch for the second bound.
    hit(b, { sy: 0.86, sx: 1.1, bulge: 0.04, tuck: 0 }, t0 + 170, 120, "sine.inOut");
    to(a, { x: xm }, t0 + 290, t0 + 470, "power1.out");
    to(b, { ty: -22 }, t0 + 290, t0 + 380, "sine.inOut");
    to(b, { ty: 0 }, t0 + 380, t0 + 470, "sine.inOut");
    to(b, { sy: 1.04, sx: 0.97, bulge: 0, tuck: 0.4 }, t0 + 290, t0 + 380, "sine.inOut");
    to(b, { sy: 1.06, sx: 0.95, tuck: 0.2 }, t0 + 380, t0 + 470, "sine.inOut");
    hit(b, { sy: 0.86, sx: 1.1, bulge: 0.05, tuck: 0 }, t0 + 440, 140, "sine.inOut");
    call(() => {
      ctx.puff(xm, 1.2);
    }, t0 + 470);
    to(b, { sy: 0.84, sx: 1.12, bulge: 0.05 }, t0 + 580, t0 + 640, "sine.inOut");
    to(b, { ty: -14, sy: 1.06, sx: 0.96, bulge: 0 }, t0 + 640, t0 + 720, "sine.inOut");
    to(b, { ty: 0, sy: 0.93, sx: 1.05, shut: 1 }, t0 + 720, t0 + 800, "sine.inOut");
    to(b, { sy: 1.035, sx: 0.98, shut: 0 }, t0 + 800, t0 + 900, "sine.inOut");
    // Hero pose held long enough to read (a moving hold), then the settle to rest.
    to(b, { sy: 1.025, sx: 0.985 }, t0 + 900, t0 + 1140, "sine.inOut");
    to(b, { sy: 1, sx: 1, th: -0.03 }, t0 + 1140, t0 + 1240, "sine.inOut");
    return { ready: t0 + 780, end: t0 + 1240 };
  }
  if (who === PLAN) {
    // Glides in on an even, decelerating walk and settles on its mark with a soft plié.
    snap(a, { x: x0, alpha: 1 }, t0);
    snap(b, { th: -0.07, lean: -2 }, t0);
    to(a, { x: xm }, t0, t0 + 560, "sine.out");
    stride(b, t0, t0 + 560, 4, "sine.out");
    to(b, { sy: 0.9, sx: 1.05, lean: 0, th: -0.04 }, t0 + 560, t0 + 640, "power2.in");
    to(b, { sy: 1, sx: 1 }, t0 + 690, t0 + 850, "sine.out");
    return { ready: t0 + 700, end: t0 + 850 };
  }
  // Check: two measured step-togethers, feet planted, glasses slipping a little with each step,
  // an exact stop held three frames with the glasses trailing.
  snap(a, { x: x0, alpha: 1 }, t0);
  snap(b, { sy: 0.96, sx: 1.02 }, t0);
  to(a, { x: xm + 108 }, t0 + 40, t0 + 300, "sine.inOut");
  to(b, { stride: 1, sy: 1 }, t0 + 60, t0 + 170, "power2.out");
  to(b, { stride: 0 }, t0 + 170, t0 + 280, "power2.in");
  to(b, { slip: 1.5 }, t0 + 140, t0 + 300, "power2.out");
  hit(b, { sy: 0.96, sx: 1.02 }, t0 + 280);
  to(a, { x: xm }, t0 + 300, t0 + 560, "sine.inOut");
  to(b, { stride: -1, sy: 1, sx: 1 }, t0 + 330, t0 + 440, "power2.out");
  to(b, { stride: 0 }, t0 + 440, t0 + 540, "power2.in");
  hit(b, { sy: 0.94, sx: 1.03 }, t0 + 540);
  to(b, { slip: 3 }, t0 + 540, t0 + 620, "power2.out");
  to(b, { sy: 1, sx: 1, th: -0.05 }, t0 + 590, t0 + 700, "power2.out");
  return { ready: t0 + 600, end: t0 + 700 };
}

/** The giver leaves through the left edge on its own gait, starting at `t0`. Returns the end. */
function leave(k, who, a, t0) {
  const { to, snap, hit, stride, call } = k;
  const b = a.b;
  // Anticipation: turn away and crouch, then push off.
  to(b, { th: 0.1, sy: 0.94, sx: 1.03 }, t0 - 120, t0, "power2.in");
  if (who === WORKSHEET) {
    hit(b, { lean: -9, sy: 1.02, sx: 0.98, curl: -0.5 }, t0);
    to(a, { x: -70 }, t0, t0 + 500, "power2.in");
    stride(b, t0, t0 + 500, 6);
  } else if (who === SLIDES) {
    to(b, { sy: 1.14, sx: 0.9, tuck: 0.5 }, t0, t0 + 60, "power2.out");
    // One continuous run out across both bounds: the speed only ever builds.
    to(a, { x: -80 }, t0, t0 + 440, "power1.in");
    to(b, { ty: -36 }, t0, t0 + 100, "power2.out");
    to(b, { ty: 0 }, t0 + 100, t0 + 200, "power2.in");
    hit(b, { sy: 0.84, sx: 1.12, tuck: 0 }, t0 + 200);
    to(b, { sy: 1.14, sx: 0.9, tuck: 0.5 }, t0 + 233, t0 + 280, "power2.out");
    to(b, { ty: -40 }, t0 + 233, t0 + 340, "power2.out");
    to(b, { ty: -10 }, t0 + 340, t0 + 440, "power2.in");
  } else if (who === PLAN) {
    hit(b, { sy: 1, sx: 1, lean: -2 }, t0);
    to(a, { x: -60 }, t0, t0 + 460, "power2.in");
    stride(b, t0, t0 + 460, 4, "power2.in");
  } else {
    hit(b, { sy: 1, sx: 1 }, t0);
    to(a, { x: a.x - 120 }, t0, t0 + 200, "power2.inOut");
    to(b, { stride: 1 }, t0, t0 + 100, "power2.out");
    to(b, { stride: 0 }, t0 + 100, t0 + 200, "power2.in");
    to(a, { x: -70 }, t0 + 240, t0 + 440, "power2.in");
    to(b, { stride: -1 }, t0 + 240, t0 + 340, "power2.out");
    to(b, { stride: 0 }, t0 + 340, t0 + 440, "power2.in");
  }
  const end = t0 + (who === PLAN ? 460 : who === WORKSHEET ? 500 : 440);
  snap(a, { alpha: 0 }, end);
  call(() => Object.assign(b, { th: 0, sy: 1, sx: 1, lean: 0, curl: 0, tuck: 0, ty: 0 }), end);
  return end;
}

/** The receiver carries the prop to centre stage in its own way. */
function carry(k, who, a, p, t0) {
  const { to, snap, hit } = k;
  const b = a.b;
  const x = { x: 320 };
  if (who === WORKSHEET) {
    to(b, { lean: -6, curl: -0.3 }, t0, t0 + 80, "power2.out");
    to(a, x, t0, t0 + 300, "power3.inOut");
    to(p, { x: 320, y: 251, gazeMix: 0 }, t0, t0 + 300, "power3.inOut");
    hit(b, { lean: 0, sy: 0.94, sx: 1.05 }, t0 + 300);
    snap(p, { carryFront: 1 }, t0 + 300);
    hit(b, { curl: 0.4 }, t0 + 317);
    to(b, { sy: 1, sx: 1, curl: 0, th: 0 }, t0 + 350, t0 + 480, "power3.out");
    return t0 + 480;
  }
  if (who === SLIDES) {
    to(b, { sy: 0.88, sx: 1.08 }, t0, t0 + 70, "power2.in");
    to(a, x, t0 + 70, t0 + 330, "power1.inOut");
    to(p, { x: 320, gazeMix: 0 }, t0 + 70, t0 + 330, "power1.inOut");
    to(b, { ty: -26, sy: 1.1, sx: 0.92 }, t0 + 70, t0 + 200, "power2.out");
    to(p, { y: 251 - 31 }, t0 + 70, t0 + 200, "power2.out");
    to(b, { ty: 0, sy: 1.06 }, t0 + 200, t0 + 330, "power2.in");
    to(p, { y: 251 }, t0 + 200, t0 + 330, "power2.in");
    hit(b, { sy: 0.86, sx: 1.12, bulge: 0.05 }, t0 + 330);
    snap(p, { carryFront: 1 }, t0 + 330);
    to(b, { sy: 1, sx: 1, bulge: 0, th: 0 }, t0 + 380, t0 + 500, "power2.out");
    return t0 + 500;
  }
  if (who === PLAN) {
    to(a, x, t0, t0 + 480, "sine.out");
    to(p, { x: 320, y: 251, gazeMix: 0 }, t0, t0 + 480, "sine.out");
    k.stride(b, t0, t0 + 480, 3, "sine.out");
    to(b, { sy: 0.94, sx: 1.03, th: 0 }, t0 + 480, t0 + 540, "power2.in");
    snap(p, { carryFront: 1 }, t0 + 540);
    to(b, { sy: 1, sx: 1 }, t0 + 590, t0 + 720, "sine.out");
    return t0 + 720;
  }
  to(a, x, t0, t0 + 300, "power2.inOut");
  to(p, { x: 320, y: 251, gazeMix: 0 }, t0, t0 + 300, "power2.inOut");
  to(b, { stride: 1 }, t0, t0 + 150, "power2.out");
  to(b, { stride: 0 }, t0 + 150, t0 + 300, "power2.in");
  hit(b, { sy: 0.96, sx: 1.02 }, t0 + 300);
  snap(p, { carryFront: 1 }, t0 + 300);
  to(b, { sy: 1, sx: 1, th: 0 }, t0 + 350, t0 + 450, "power2.out");
  to(b, { slip: 0 }, t0 + 450, t0 + 700, "power2.out");
  return t0 + 700;
}

// Source production.js work beats. All hand/prop contact timing is preserved.
export function buildBeat(context, n, gsap) {
  const { p, actors, fan, questionNodes, questionLengths, draw, setFanMode, onComplete } = context;
  const tl = gsap.timeline({ paused: true, onUpdate: draw, onComplete });
  const go = (v, t, d = 0.6, e = "sine.inOut") => tl.to(p, { ...v, duration: d, ease: e }, t);
  const k = kit(tl);
  const { to, snap, hit } = k;
  if (n === 0) {
    const b = actors[PLAN].b;
    // Sink before unfolding, rise with the unfold; the plan is lifted, read and set down with a plié.
    to(b, { sy: 0.95, sx: 1.02 }, 0, 180, "sine.inOut");
    go({ fold: 1 }, 0.2, 1.05, "power2.out");
    to(b, { sy: 1.02, sx: 0.99 }, 180, 520, "power2.out");
    to(b, { sy: 1, sx: 1 }, 520, 1000, "sine.inOut");
    go({ y: 244 }, 1.55, 0.6, "sine.inOut");
    to(b, { th: -0.03 }, 1550, 2150, "sine.inOut");
    go({ y: 251 }, 2.75, 0.7, "power2.in");
    to(b, { th: 0 }, 2750, 3300, "sine.inOut");
    hit(b, { sy: 0.92, sx: 1.04 }, 3450);
    to(b, { sy: 1, sx: 1 }, 3500, 3700, "sine.out");
    tl.to({}, { duration: 0.2 }, 3.7);
  }
  if (n === 1) {
    const b = actors[PLAN].b;
    // Checks the plan through: Plan's own check-through from its cast module (plan.hover: the
    // corner lifted, a riffle of the pages, one content nod with shut eyes), laid on the lift.
    go({ y: 242 }, 0, 0.7, "sine.out");
    to(b, { sy: 1.01 }, 500, 700, "sine.inOut");
    k.call(() => context.cast(PLAN, "plan.hover", { hands: 1 }), 700);
    to(b, { sy: 1 }, 1900, 2300, "sine.inOut");
    go({ fold: 0 }, 2.6, 0.7, "power2.inOut");
    go({ y: 251 }, 2.6, 0.7, "power2.in");
    hit(b, { sy: 0.93, sx: 1.03 }, 3300);
    to(b, { sy: 1, sx: 1 }, 3350, 3550, "sine.out");
  }
  if ([2, 5, 8, 11].includes(n)) {
    const { from, to: into } = context;
    const giver = actors[from],
      taker = actors[into];
    tl.timeScale(1);
    if (n === 11) {
      // A declined worksheet: Worksheet acknowledges the choice and leaves empty-handed while
      // Slides arrives on the mark.
      go({ gesture: 1, look: 2 }, 0, 0.35, "sine.inOut");
      go({ gesture: 0, look: 0 }, 0.35, 0.3, "sine.inOut");
      leave(k, from, giver, 640);
      const { end } = arrive(k, context, into, taker, 600, 320);
      tl.to({}, { duration: 0.1 }, end / 1000);
    } else {
      snap(taker, { alpha: 0, x: 760 }, 0);
      // Giver notices (eyes lead, head follows), sinks, then offers the prop up and forward.
      go({ gazeMix: 1 }, 0, 0.1, "power2.out");
      to(giver.b, { th: 0.07 }, 80, 200, "power2.out");
      to(giver.b, { sy: 0.94, sx: 1.03, lean: -3 }, 120, 330, "power2.inOut");
      to(giver, { x: 250 }, 120, 330, "power2.inOut");
      k.stride(giver.b, 120, 330, 1, "power2.inOut");
      go({ y: 255, outerRelease: 1 }, 0.12, 0.21, "power2.inOut");
      to(giver.b, { sy: 1.03, sx: 0.99, lean: 0 }, 330, 480, "power2.out");
      go({ x: 336 }, 0.33, 0.15, "power2.out");
      go({ y: 243 }, 0.33, 0.15, "power2.out");
      to(giver.b, { sy: 1.02 }, 480, 700, "sine.inOut");
      const { ready } = arrive(k, context, into, taker, 0, 440);
      // Reach, tug, release (timing chart "the exchange"). The taker leans in and grips, then leans
      // back and draws the prop over on an arc; the giver is pulled after it 60 ms late, lets go,
      // rocks back one way and closes its eyes, pleased. The taker takes the weight: the prop
      // drops into its hands and the body snaps to a small squash held three frames.
      const R = ready;
      to(taker.b, { lean: -6 }, R, R + 200, "power2.out");
      go({ grip: 1 }, R / 1000, 0.2, "power2.out");
      to(giver.b, { sy: 1.03 }, 480, R + 200, "sine.inOut");
      to(taker.b, { lean: 3 }, R + 200, R + 380, "power2.inOut");
      go({ x: 350 }, (R + 200) / 1000, 0.18, "power2.inOut");
      go({ y: 235 }, (R + 200) / 1000, 0.18, "sine.out");
      to(giver.b, { lean: 5, sy: 1.05, sx: 0.98 }, R + 260, R + 380, "power2.out");
      go({ offer: 1 }, (R + 380) / 1000, 0.12, "power2.out");
      to(giver.b, { lean: -3, sy: 0.97, sx: 1.02 }, R + 380, R + 470, "power2.out");
      to(giver.b, { shut: 1 }, R + 420, R + 470, "power2.in");
      to(giver.b, { lean: 0 }, R + 470, R + 540, "sine.inOut");
      to(giver.b, { shut: 0 }, R + 560, R + 620, "power2.out");
      go({ y: 247 }, (R + 380) / 1000, 0.08, "power2.in");
      hit(taker.b, { sy: 0.93, sx: 1.04, lean: 1 }, R + 460);
      to(taker.b, { sy: 0.95, sx: 1.03 }, R + 510, R + 560, "sine.inOut");
      to(taker.b, { sy: 1, sx: 1, lean: 0 }, R + 560, R + 660, "power2.out");
      go({ y: 251 }, (R + 510) / 1000, 0.15, "sine.inOut");
      const out = ready + 660;
      leave(k, from, giver, out);
      const end = carry(k, into, taker, p, out);
      tl.to({}, { duration: 0.1 }, end / 1000);
    }
  }
  if (n === 3) {
    p.pending = 1;
    p.stackGap = 0;
    p.magic = 0;
    p.py = 4;
    p.px = 0;
    p.pr = 0;
    p.paperFront = 0;
    p.contact = 0;
    go({ gesture: 1, px: 45, py: -19, pr: -5 }, 0.15, 0.65);
    go({ px: 82, py: -12, pr: -3 }, 0.8, 0.45);
    tl.set(p, { paperFront: 1 }, 1.25);
    go({ px: 0, py: -18, pr: 0 }, 1.25, 0.75);
    // Travel to the starting edge before revealing anything; the hand then owns the wipe.
    go({ sweep: 1 }, 2, 0.35);
    go({ magic: 1, spark: 1 }, 2.35, 0.95, "power1.inOut");
    go({ spark: 0 }, 3.3, 0.2, "power2.out");
    {
      // The slide is made. Slides draws back a touch (anticipation), then presents it: a lean
      // toward the slide, a pleased squint, the slide kicks and settles, an accent bursts off its
      // top edge. Feet planted, nothing leaves the ground. Every other slide it then glances out
      // at the teacher (its cast module's glance). No shake: that is Slides' landing only.
      const b = actors[SLIDES].b;
      to(b, { sy: 0.975, sx: 1.015, lean: -2.5, th: -0.02 }, 3120, 3300, "power2.in");
      to(b, { sy: 1.03, sx: 0.985, lean: 3, th: 0.035, shut: 0.75 }, 3300, 3420, "power2.out");
      k.call(() => context.accentAt("slide", 36, -24, 1.3), 3300);
      go({ pr: 4 }, 3.3, 0.11, "power2.out");
      go({ pr: 0 }, 3.41, 0.34, "back.out(2)");
      to(b, { sy: 1.018, sx: 0.992, lean: 2 }, 3420, 3720, "sine.inOut");
      to(b, { sy: 1, sx: 1, lean: 0, th: 0, shut: 0 }, 3720, 3900, "sine.inOut");
      if (context.loops % 2 === 1) k.call(() => context.cast(SLIDES, "slides.glance"), 3950);
    }
    go({ sweep: 0 }, 3.5, 0.2);
    go({ py: 0 }, 3.7, 0.7);
    tl.set(p, { deck: 1, ink: 1, pending: 0 }, 4.4);
    go({ gesture: 0, gripShape: 1, y: 253.2, x: 326 }, 4.4, 0.5);
    tl.to({}, { duration: 0.2 }, 4.9);
  }
  if (n === 4) {
    go({ ambientGate: 0 }, 0, 0.2);
    go({ x: 326, y: 253.2, r: 3, stackGap: 0 }, 0, 0.3);
    tl.call(
      () => {
        setFanMode(true);
      },
      [],
      0.3,
    );
    const time = { value: 0 };
    tl.to(
      time,
      {
        value: fan.t.duration(),
        duration: fan.t.duration(),
        ease: "none",
        onUpdate() {
          fan.t.time(time.value);
        },
      },
      0.3,
    );
    const end = 0.3 + fan.t.duration();
    tl.call(
      () => {
        setFanMode(false);
        p.x = 326;
        p.y = 253.2;
        p.r = 3;
      },
      [],
      end,
    );
    go({ x: 320, y: 251, r: 0, stackGap: 0, ambientGate: 1 }, end, 0.4);
  }
  if (n === 6) {
    p.questions = 0;
    p.q0 = p.q1 = p.q2 = 0;
    p.sheet = 1;
    p.sheetFront = 0;
    p.sx = 0;
    p.sy = 18;
    p.sr = 0;
    go({ extractGrip: 1 }, 0, 0.2, "power2.out");
    go({ sx: 48, sy: -18, sr: -6 }, 0.2, 0.65, "power2.out");
    go({ sx: 84, sy: -10, sr: -4 }, 0.85, 0.45, "power2.inOut");
    tl.set(p, { sheetFront: 1 }, 1.3);
    go({ sx: 0, sy: 0, sr: 0, y: 249, sheetGrip: 1 }, 1.3, 0.7, "power3.inOut");
    // The pen touches down exactly where each stroke starts, so the line grows out of its tip.
    const starts = questionNodes.map((node) => node.getPointAtLength(0));
    tl.set(p, { tool: 1, stroke: -1, penX: starts[0].x, penY: starts[0].y - 6 }, 2);
    go({ gesture: 1, toolAlpha: 1 }, 2, 0.4, "power2.out");
    // Cocks the pencil before the first stroke.
    go({ penY: starts[0].y - 13 }, 2.3, 0.12, "power2.out");
    go({ penY: starts[0].y }, 2.42, 0.14, "power3.in");
    let at = 2.56;
    for (let i = 0; i < 3; i++) {
      tl.set(p, { stroke: i, contact: 1 }, at);
      go({ [`q${i}`]: 1 }, at, 0.72, "none");
      at += 0.72;
      const end = questionNodes[i].getPointAtLength(questionLengths[i]);
      tl.set(p, { contact: 0, penX: end.x, penY: end.y }, at);
      // The full stop: a one-frame cut into a small squash, held, then released.
      hit(actors[WORKSHEET].b, { sy: 0.95, sx: 1.03 }, at * 1000);
      to(actors[WORKSHEET].b, { sy: 1, sx: 1 }, at * 1000 + 50, at * 1000 + 160, "power2.out");
      go({ penY: end.y - 6 }, at, 0.14, "power2.out");
      at += 0.14;
      if (i < 2) {
        go({ penX: starts[i + 1].x, penY: starts[i + 1].y - 6 }, at, 0.3, "power2.inOut");
        at += 0.3;
        go({ penY: starts[i + 1].y }, at, 0.14, "power2.in");
        at += 0.14;
      }
    }
    tl.set(p, { questions: 1, stroke: -1 }, at);
    go({ penX: 31, penY: -42 }, at, 0.35, "power2.inOut");
    // The sheet is done: Worksheet's own twirl-and-catch from its cast module, caught dead with
    // an accent off the hand. The clip runs in real time; the beat waits it out at its tempo.
    k.call(
      () =>
        context.cast(WORKSHEET, "worksheet.twirl", {
          hands: 0.6,
          onCatch: () => context.accentAt("hand", 0, 0, 0.7),
        }),
      (at + 0.4) * 1000,
    );
    at += 0.4 + 1.45 * 1.4;
    go({ toolAlpha: 0 }, at, 0.25, "power1.out");
    go({ gesture: 0, extractGrip: 0, y: 245 }, at + 0.25, 0.5, "power2.inOut");
  }
  if (n === 7) {
    const b = actors[WORKSHEET].b;
    go({ gesture: 1, rx: 351, ry: 267 }, 0, 0.4, "power2.out");
    go({ extend: 1, ry: 293, y: 241 }, 0.45, 1.1, "power2.inOut");
    to(b, { sy: 1.03, sx: 0.98 }, 450, 900, "power2.out");
    to(b, { sy: 1, sx: 1 }, 900, 1400, "sine.inOut");
    to(b, { th: -0.05 }, 1700, 1950, "power2.out");
    to(b, { th: 0 }, 2350, 2600, "power2.out");
    go({ extend: 0, gesture: 0, sheetGrip: 0, y: 251 }, 3.05, 0.6, "power2.in");
    hit(b, { sy: 0.94, sx: 1.04, curl: 0.4 }, 3650);
    to(b, { sy: 1, sx: 1, curl: 0 }, 3700, 3850, "power3.out");
  }
  if (n === 9) {
    const b = actors[3].b;
    go({ compare: 1, y: 249 }, 0, 0.85, "power2.out");
    // Eyes snap to each page first; the head follows 80 ms later and holds (a moving hold).
    hit(p, { look: -3 }, 1200, 70);
    to(b, { th: -0.06 }, 1280, 1500, "power2.out");
    to(b, { sy: 1.012 }, 1500, 2000, "sine.inOut");
    hit(p, { look: 3 }, 2000, 70);
    to(b, { th: 0.06, sy: 1 }, 2080, 2300, "power2.out");
    to(b, { sy: 1.012 }, 2300, 2800, "sine.inOut");
    hit(p, { look: 0 }, 2800, 70);
    to(b, { th: 0, sy: 1 }, 2880, 3100, "power2.out");
    go({ compare: 0, y: 251 }, 3.5, 0.85, "power2.inOut");
    if (context.loops % 3 === 0) {
      // Then its own dry look over the glasses at the teacher (the cast module's look).
      k.call(() => context.cast(3, "check.look", { hands: 0.9 }), 4400);
      tl.to({}, { duration: 2.9 * 1.45 }, 4.4);
    }
  }
  if (n === 10) {
    const b = actors[3].b;
    go({ gesture: 1, rx: 369, ry: 234 }, 0, 0.65, "power2.out");
    tl.set(p, { tool: 2 }, 0.4);
    go({ toolAlpha: 1 }, 0.4, 0.3, "power1.out");
    go({ rx: 320, ry: 236 }, 0.8, 0.3, "power2.inOut");
    // Wind-up: the stamp lifts and the body rises; then the strike cuts into a held squash.
    go({ ry: 212 }, 1.1, 0.25, "power2.out");
    to(b, { sy: 1.03, sx: 0.99 }, 1100, 1350, "power2.out");
    go({ ry: 251 }, 1.35, 0.09, "power3.in");
    to(b, { sy: 1 }, 1350, 1440, "power3.in");
    tl.set(p, { seal: 1 }, 1.44);
    k.call(() => context.accentAt("scene", 320, 238, 1), 1440);
    hit(b, { sy: 0.93, sx: 1.04, shut: 0.5 }, 1440);
    to(b, { sy: 0.95, sx: 1.03 }, 1490, 1610, "sine.inOut");
    to(b, { sy: 1, sx: 1, shut: 0 }, 1610, 1750, "power2.out");
    go({ rx: 365, ry: 226 }, 1.75, 0.4, "power2.out");
    go({ toolAlpha: 0 }, 2.2, 0.25, "power1.out");
    go({ gesture: 0, y: 239 }, 2.45, 0.6, "power2.inOut");
    tl.to({}, { duration: 0.3 }, 3.05);
    if (context.loops === 0) {
      // First sign-off: Check's own dry look over the glasses at the teacher (its cast module's
      // look) before the stamp. The stamp's run moves back by the look's length at this tempo.
      const look = 2.9 * 1.7;
      for (const child of tl.getChildren(false)) child.startTime(child.startTime() + look);
      k.call(() => context.cast(3, "check.look", { hands: 1 }), 0);
    }
  }

  return tl;
}

/**
 * Reactions on the current holder: a nod, the leap that rides the flight, the exit. They move the
 * reaction layer `a.r` (deltas from rest, added to the beat's pose), so they never fight the beat.
 */
export function buildReaction(context, name, options, gsap) {
  const { actors, draw, owner, onComplete } = context;
  const tl = gsap.timeline({ paused: true, onUpdate: draw, onComplete });
  const k = kit(tl);
  const { to, snap } = k;
  const a = actors[owner],
    r = a.r;
  if (name === "nod") {
    // Rises a touch (anticipation), dips forward toward the form with shut eyes, holds, recovers.
    to(r, { sy: 0.03, lean: -1 }, 0, 90, "power2.out");
    to(r, { sy: -0.07, sx: 0.04, lean: 4, shut: 1 }, 90, 260, "sine.inOut");
    to(r, { sy: -0.06, sx: 0.035 }, 260, 360, "sine.inOut");
    to(r, { sy: 0, sx: 0, lean: 0, shut: 0 }, 360, 560, "sine.inOut");
  } else if (name === "leap") {
    // Crouch (the flight waits for it), launch stretched and tucked, land with a soft squash.
    const L = 130 + (options.flight ?? 0.65) * 1000;
    to(r, { sy: -0.1, sx: 0.07, bulge: 0.03 }, 0, 130, "sine.inOut");
    to(r, { sy: 0.1, sx: -0.08, bulge: 0, tuck: 0.4, ty: -16 }, 130, 260, "power2.out");
    to(r, { sy: 0.05, sx: -0.04 }, 260, L - 140, "sine.inOut");
    to(r, { ty: 0, sy: 0.08, sx: -0.07, tuck: 0.1 }, L - 140, L, "power2.in");
    to(r, { sy: -0.14, sx: 0.1, bulge: 0.04, tuck: 0 }, L, L + 110, "power2.out");
    k.call(() => context.puff(a.x, 0.8), L);
    to(r, { ty: -6, sy: 0.04, sx: -0.02, bulge: 0 }, L + 110, L + 230, "sine.inOut");
    to(r, { ty: 0, sy: -0.04, sx: 0.03 }, L + 230, L + 330, "sine.inOut");
    to(r, { sy: 0, sx: 0 }, L + 330, L + 470, "sine.inOut");
  } else if (name === "leave") {
    // A pleased nod doubles as the anticipation, then two exact steps out through the edge.
    to(r, { sy: 0.03 }, 0, 90, "power2.out");
    to(r, { sy: -0.06, sx: 0.03, shut: 0.7 }, 90, 220, "sine.inOut");
    to(r, { sy: 0, sx: 0, shut: 0, th: 0.08 }, 220, 340, "sine.inOut");
    // It takes the finished deck with it: the prop travels in its hands.
    const lead = context.p.x - a.x;
    to(a, { x: a.x + 110 }, 340, 580, "sine.inOut");
    to(context.p, { x: a.x + 110 + lead }, 340, 580, "sine.inOut");
    to(context.p, { x: 700 + lead }, 600, 900, "sine.in");
    to(r, { stride: 1, slip: 1.5 }, 340, 440, "power2.out");
    to(r, { stride: 0 }, 440, 540, "power2.in");
    to(a, { x: 700 }, 600, 900, "sine.in");
    to(r, { stride: -1 }, 600, 750, "power2.out");
    to(r, { stride: 0 }, 750, 900, "power2.in");
    snap(a, { alpha: 0 }, 900);
  }
  return tl;
}
