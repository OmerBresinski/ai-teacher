/*
 * Cast module: Slides at work in "Edit with Dayback" (TEACH-97). A port of the Slides cast module
 * (`scratchpad/how-it-works-options/new/_shared/cast/slides.js`, contract `_contract.js`): one
 * module per character, contexts pick intensity, never fork the animation. This file adds the
 * working, done and failed beats and two contexts, `bubble` (small, ambient) and `pane` (large).
 *
 * Pure data and functions: no DOM, no loops. Poses are in the contract's hero-rig vocabulary
 * (`heroState`, art units of the 300 x 300 artwork) and are evaluated every display frame between
 * keys (ANIMATION-PROCESS §5, ruling 114: a smooth base with anime accents). The only stepped
 * accent is a two-frame hold at a contact (`ease: "hold"`). Every beat starts on its base pose;
 * the runtime blends into it from wherever the character is (240 ms), so there are no pops.
 *
 * The persona (PERSONA-MOTION.md): fast and bouncy, a small overshoot, squash on contact, never
 * anxious. Restraint here: the bubble is ambient, so its loop is small and slow, and nothing loops
 * forever while idle (the resting life stops after `idleFor`).
 */

export type CastContext = "bubble" | "pane";
export type CastState = "idle" | "working" | "done" | "failed";

/** The contract's heroState, as far as Slides uses it, plus the props' own channels. */
export type Pose = {
  sx: number;
  sy: number;
  /** + sinks the body (feet stay); jump: - lifts body and feet. */
  rise: number;
  jump: number;
  /** Degrees about the feet. */
  lean: number;
  /** The face slides inside the card; gx, gy: the pupils. */
  fx: number;
  fy: number;
  gx: number;
  gy: number;
  /** 1 open .. 0 closed. */
  eye: number;
  /** 0 rest, 1 big, -0.5 flat. */
  smile: number;
  /** Hand offsets from rest, elbow bend; la, ra: arm rotation about the shoulder (degrees). */
  lx: number;
  ly: number;
  lb: number;
  rx: number;
  ry: number;
  rb: number;
  la: number;
  ra: number;
  /** Bubble: the top card's trip from the front of the stack to the back (0..1). */
  card: number;
  /** Bubble: the rest of the stack moving up one place (0..1). */
  shift: number;
};

export const REST: Pose = {
  sx: 1,
  sy: 1,
  rise: 0,
  jump: 0,
  lean: 0,
  fx: 0,
  fy: 0,
  gx: 0,
  gy: 0,
  eye: 1,
  smile: 0,
  lx: 0,
  ly: 0,
  lb: 0,
  rx: 0,
  ry: 0,
  rb: 0,
  la: 0,
  ra: 0,
  card: 0,
  shift: 0,
};

export type Ease = "lin" | "in" | "out" | "inout" | "back" | "hold";
export type Key = { t: number; ease?: Ease } & Partial<Pose>;
export type Clip = { duration: number; loop?: boolean; keys: Key[] };

/** Slides' artwork, from `homepage/motion/characters.js` (key `slides`). */
export const ART = {
  /** The bubble and pane crop of the 300 x 300 artwork. */
  viewBox: "10 40 280 250",
  /** The planted base the card swells and squashes from. */
  base: 214,
  feet: [
    [60, 221, 51, 274, 32, 277],
    [223, 217, 240, 268, 260, 268],
  ] as const,
  pivots: [
    [55, 105],
    [244, 117],
  ] as const,
  arms: ["M55 105Q24 96 19 130", "M244 117Q275 123 277 94"] as const,
  mouth: [127, 141, 138, 151, 150, 139] as const,
  eyes: [
    [119, 127],
    [155, 125],
  ] as const,
  /** The right hand at rest: props are held here. */
  hand: [277, 94] as const,
} as const;

/** The base pose per context. In the bubble Slides holds a little stack of slides at its front. */
const HOLD: Partial<Pose> = { rx: -60, ry: 70, rb: -6 };
export function base(context: CastContext): Pose {
  return context === "bubble" ? { ...REST, ...HOLD } : { ...REST };
}

/*
 * The clips. Keys are deltas from the context's base pose (a missing field is 0, or 1 for the
 * scales and the eye), so every beat starts and ends exactly on its base.
 */
const LOOK_STACK = { fx: 6, fy: 3, gx: 2.5, gy: 2.2, lean: 1.2 };
const LOOK_SLIDE = { fx: 7, fy: -1, gx: 3, gy: -0.4, lean: 1 };

export const CLIPS: Record<string, Clip> = {
  // Bubble, working (1.6 s, loops): the riffle. The hand dips (anticipation), the top card lifts
  // and is carried over the top, tucks down behind with a two-frame contact hold, then the stack
  // shuffles up one place and the body settles with a hair of overshoot. Eyes follow the card.
  riffle: {
    duration: 1600,
    loop: true,
    keys: [
      { t: 0, ...LOOK_STACK },
      { t: 220, ...LOOK_STACK, ry: 6, sy: 0.975, sx: 1.015, ease: "inout" },
      { t: 540, ...LOOK_STACK, ry: -8, gy: 0.4, sy: 1.025, sx: 0.99, card: 0.5, ease: "out" },
      { t: 640, ...LOOK_STACK, ry: -9, gy: 0.2, sy: 1.02, sx: 0.992, card: 0.56, ease: "inout" },
      { t: 960, ...LOOK_STACK, ry: 5, sy: 0.968, sx: 1.02, card: 1, ease: "in" },
      { t: 1040, ...LOOK_STACK, ry: 5, sy: 0.97, sx: 1.019, card: 1, ease: "hold" },
      { t: 1320, ...LOOK_STACK, sy: 1.008, sx: 0.997, card: 1, shift: 1, ease: "out" },
      { t: 1600, ...LOOK_STACK, card: 1, shift: 1, ease: "inout" },
    ],
  },
  // Pane, working (2.4 s, loops): touch-up. Three strokes: the pencil hand pulls back
  // (anticipation), sweeps right as the line redraws, lifts at the end of the line; then a short
  // look over the slide with a small nod to itself.
  touchUp: {
    duration: 2400,
    loop: true,
    keys: [
      { t: 0, ...LOOK_SLIDE },
      ...[0, 700, 1400].flatMap((s): Key[] => [
        { t: s + 120, ...LOOK_SLIDE, rx: -7, ry: 4, sy: 0.985, sx: 1.008, ease: "out" },
        { t: s + 560, ...LOOK_SLIDE, rx: 12, ry: 3, gx: 3.4, lean: 2.4, sy: 1.012, ease: "inout" },
        { t: s + 630, ...LOOK_SLIDE, rx: 13, ry: -6, lean: 2, sy: 1.006, ease: "out" },
        { t: s + 700, ...LOOK_SLIDE, ease: "inout" },
      ]),
      { t: 2160, ...LOOK_SLIDE, fy: 3, gy: 1, sy: 0.99, smile: 0.4, ease: "inout" },
      { t: 2400, ...LOOK_SLIDE, ease: "inout" },
    ],
  },
  // Done (0.9 s): a crouch with a squint (anticipation), a nod down held two frames, back up
  // past rest (Slides may overshoot), settle.
  nod: {
    duration: 900,
    keys: [
      { t: 0 },
      { t: 120, sy: 0.96, sx: 1.025, eye: 0.45, smile: 0.8, ease: "out" },
      { t: 300, fy: 7, gy: 2, sy: 0.975, sx: 1.018, smile: 1, eye: 0.25, ease: "inout" },
      { t: 383, fy: 7, gy: 2, sy: 0.975, sx: 1.018, smile: 1, eye: 0.25, ease: "hold" },
      { t: 560, fy: -2, gy: -0.5, sy: 1.03, sx: 0.985, smile: 1, eye: 1, ease: "out" },
      { t: 760, sy: 0.996, sx: 1.002, smile: 0.6, ease: "inout" },
      { t: 900, ease: "inout" },
    ],
  },
  // Failed or stopped (0.9 s, ends on a held pose): a small "oh" lift, then a sheepish settle:
  // a hand to the back of its head, eyes down to the side, mouth flat, one slow blink.
  // Not sad, never anxious.
  sorry: {
    duration: 900,
    keys: [
      { t: 0 },
      { t: 140, sy: 1.02, sx: 0.99, gy: -1, ease: "out" },
      { t: 420, ...sorryPose(), sy: 0.99, sx: 1.006, ease: "inout" },
      { t: 560, ...sorryPose(), eye: 0.15, ease: "inout" },
      { t: 720, ...sorryPose(), ly: -48, ease: "inout" },
      { t: 900, ...sorryPose(), ease: "inout" },
    ],
  },
  // Hover on the bubble (0.52 s): a crouch, a little pop, a squash landing held two frames, and a
  // settle that overshoots once. Reacts at once, every time.
  perk: {
    duration: 520,
    keys: [
      { t: 0 },
      { t: 70, sy: 0.94, sx: 1.04, ease: "out" },
      { t: 210, jump: -12, sy: 1.05, sx: 0.97, smile: 0.6, ease: "out" },
      { t: 320, sy: 0.95, sx: 1.035, smile: 0.6, ease: "in" },
      { t: 403, sy: 0.95, sx: 1.035, smile: 0.6, ease: "hold" },
      { t: 520, ease: "back" },
    ],
  },
};

function sorryPose(): Partial<Pose> {
  // The left hand comes up beside its head (outside the card edge, so it reads); the mouth goes flat.
  return {
    fx: -5,
    fy: 4,
    gx: -2.5,
    gy: 3,
    smile: -1.5,
    lean: -1.5,
    lx: 16,
    ly: -44,
    lb: -14,
    ry: 8,
  };
}

export const CONTEXTS = {
  // Ambient: a 44 px character in a 56 px bubble. Breath and blinks while idle, for a while only.
  bubble: {
    size: 44,
    breath: true,
    breathScale: 0.8,
    idleFor: 24_000,
    hover: "perk",
    working: "riffle",
  },
  // The open pane: 112 px, beside the miniature of the slide being edited. Blinks only at rest.
  pane: {
    size: 112,
    breath: false,
    breathScale: 0,
    idleFor: 16_000,
    hover: null,
    working: "touchUp",
  },
} as const;

/** Breath (ANIMATION-PROCESS §6): 3800 ms; 1100 in, 1500 out, 1200 held. Drawn deformation. */
export const BREATH = { period: 3800, inhale: 1100, exhale: 1500, depth: 0.03, lift: 1.6 };
export const BLINK = { gap: [3000, 5000] as const, ms: 180 };

const EASE: Record<Ease, (u: number) => number> = {
  lin: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  inout: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
  back: (u) => {
    const c = 1.4;
    return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
  },
  hold: () => 0,
};

const ONE = new Set(["sx", "sy", "eye"]);
const field = (k: Partial<Pose>, f: keyof Pose) => k[f] ?? (ONE.has(f) ? 1 : 0);

/** The pose of a clip at `t` ms, on top of `from` (the base pose). Loops wrap. */
export function poseAt(clip: Clip, t: number, from: Pose): Pose {
  const keys = clip.keys;
  const time = clip.loop ? ((t % clip.duration) + clip.duration) % clip.duration : t;
  const clamped = Math.min(Math.max(time, 0), clip.duration);
  let i = 0;
  while (i < keys.length - 2 && (keys[i + 1] as Key).t <= clamped) i++;
  const a = keys[i] as Key;
  const b = keys[i + 1] ?? a;
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (clamped - a.t) / span)) : 1;
  const e = EASE[b.ease ?? "inout"](u);
  const out = { ...from };
  for (const f of Object.keys(REST) as (keyof Pose)[]) {
    const va = field(a, f);
    const vb = field(b, f);
    const d = va + (vb - va) * e;
    out[f] = ONE.has(f) ? from[f] * d : from[f] + d;
  }
  return out;
}

/** The end pose of a one-shot clip (the held pose a still state shows, and reduced motion's). */
export const endOf = (name: string, from: Pose): Pose => {
  const clip = CLIPS[name] as Clip;
  return poseAt(clip, clip.duration, from);
};

export type Plan =
  | { kind: "loop"; clip: string }
  | { kind: "beat"; clip: string }
  | { kind: "idle" }
  | { kind: "still" };

/**
 * What a state change plays. A beat plays only on the change it marks (working to done, working
 * to failed); arriving in done or failed any other way (reopening the pane later) shows the still
 * pose. Under reduced motion nothing plays: every state is its still pose.
 */
export function planFor(
  context: CastContext,
  prev: CastState | undefined,
  next: CastState,
  reduced: boolean,
): Plan {
  if (reduced) return { kind: "still" };
  if (next === "working") return { kind: "loop", clip: CONTEXTS[context].working };
  if (next === "done")
    return prev === "working" ? { kind: "beat", clip: "nod" } : { kind: "still" };
  if (next === "failed")
    return prev === "working" ? { kind: "beat", clip: "sorry" } : { kind: "still" };
  return { kind: "idle" };
}

/** The still pose for a state (where a beat ends, and everything under reduced motion). */
export function stillPose(context: CastContext, state: CastState): Pose {
  const b = base(context);
  if (state === "failed") return endOf("sorry", b);
  if (state === "working") return poseAt(CLIPS[CONTEXTS[context].working] as Clip, 0, b);
  return b;
}

const sine01 = (u: number) => 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, u))) / 2;
/** The breath at `t` ms (0..1 amount), its cycle randomised by the runtime, never in step. */
export function breathAt(t: number, period = BREATH.period): number {
  const k = period / BREATH.period;
  const p = ((t % period) + period) % period;
  const inhale = BREATH.inhale * k;
  const exhale = BREATH.exhale * k;
  if (p < inhale) return sine01(p / inhale);
  if (p < inhale + exhale) return 1 - sine01((p - inhale) / exhale);
  return 0;
}

/** A 180 ms blink triangle: the eye amount at `ms` into the blink. */
export const blinkAt = (ms: number) =>
  ms <= 0 || ms >= BLINK.ms ? 1 : 1 - 0.94 * (1 - Math.abs(ms / (BLINK.ms / 2) - 1));

/*
 * The props. Bubble: three slide cards in slots stepping up and to the right behind the front
 * one. `stackAt` places each card (by its place in the stack at the start of the loop) and says
 * which draws behind the others: the travelling card swaps to the back only at the top of its arc,
 * where it overlaps nothing, so the swap is never seen.
 */
export const CARD = { x: 196, y: 152, w: 84, h: 60, step: [7, -7] as const };
export function stackAt(card: number, shift: number) {
  const slot = (s: number) => [CARD.step[0] * s, CARD.step[1] * s] as const;
  const up = Math.min(1, card / 0.5);
  const over = Math.max(0, (card - 0.5) / 0.5);
  const [bx, by] = slot(2);
  const top =
    card <= 0.5
      ? { x: -10 * Math.sin(up * Math.PI * 0.5), y: -80 * up, rot: -7 * up }
      : { x: -10 + (bx + 10) * over, y: -80 + (by + 80) * over, rot: -7 * (1 - over) };
  const places = [0, 1, 2].map((i) => {
    if (i === 0) return { ...top, behind: card > 0.5 };
    const [x0, y0] = slot(i);
    const [x1, y1] = slot(i - 1);
    return { x: x0 + (x1 - x0) * shift, y: y0 + (y1 - y0) * shift, rot: 0, behind: false };
  });
  return places;
}

/**
 * Pane: which line of the miniature is being redrawn, and how far. The line is covered as the
 * pencil pulls back (`cover` 0..1, the first 120 ms of a stroke), then uncovered left to right
 * as the pencil sweeps (`wipe` 0..1). The fourth part of the loop is the look, no line.
 */
export function inkAt(t: number) {
  const clip = CLIPS.touchUp as Clip;
  const loop = Math.floor(t / clip.duration);
  const local = t - loop * clip.duration;
  const stroke = Math.floor(local / 700);
  if (stroke > 2) return { pass: loop * 3 + 2, cover: 0, wipe: 1 };
  const s = local - stroke * 700;
  const cover = Math.min(1, s / 120);
  const wipe = s <= 120 ? 0 : s >= 560 ? 1 : EASE.inout((s - 120) / 440);
  return { pass: loop * 3 + stroke, cover, wipe };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** The drawing for a pose: the transforms and paths the runtime writes into its fixed nodes. */
export function geometry(s: Pose, breath = 0, eyeR = 3) {
  const B = ART.base;
  const sy = s.sy * (1 + BREATH.depth * breath);
  const sx = s.sx * (1 + BREATH.depth * 0.35 * breath);
  const lift = s.rise + s.jump;
  const rad = (s.lean * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  const body = `translate(0 ${r2(lift)}) rotate(${r2(s.lean)} 150 235) translate(150 ${B}) scale(${r2(sx * 1000) / 1000} ${r2(sy * 1000) / 1000}) translate(-150 ${-B})`;
  const legs = ART.feet
    .map(([hx0, hy0, ax, ay, tx, ty]) => {
      const hx = 150 + (hx0 - 150) * sx;
      const hy = B + (hy0 - B) * sy;
      const x = 150 + (hx - 150) * c - (hy - 235) * sn;
      const y = 235 + lift + (hx - 150) * sn + (hy - 235) * c;
      const ankle = ay + s.jump;
      return `M${r2(x)} ${r2(y)} Q${r2((x + ax) / 2)} ${r2((y + ankle) / 2)} ${ax} ${r2(ankle)} L${tx} ${r2(ty + s.jump)}`;
    })
    .join(" ");
  const arms = ART.arms.map((d, side) => {
    const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const dx = side ? s.rx : s.lx;
    const dy = side ? s.ry : s.ly;
    const bend = side ? s.rb : s.lb;
    const m = n.slice();
    m[4] = (m[4] as number) + dx;
    m[5] = (m[5] as number) + dy;
    const vx = (m[4] as number) - (m[0] as number);
    const vy = (m[5] as number) - (m[1] as number);
    const len = Math.hypot(vx, vy) || 1;
    m[2] = (m[2] as number) + dx * 0.5 + (-vy / len) * bend;
    m[3] = (m[3] as number) + dy * 0.5 + (vx / len) * bend;
    const p = m.map(r2);
    const rot = (side ? s.ra : s.la) + (side ? -1 : 1) * BREATH.lift * breath;
    const [px, py] = ART.pivots[side] as readonly [number, number];
    return {
      d: `M${p[0]} ${p[1]}Q${p[2]} ${p[3]} ${p[4]} ${p[5]}`,
      transform: `rotate(${r2(rot)} ${px} ${py})`,
    };
  });
  const [x, y, cx, cy, ex, ey] = ART.mouth;
  const m = s.smile;
  const mouth = `M${r2(x - 2 * m)} ${r2(y - m)}Q${cx} ${r2(cy + 6 * m)} ${r2(ex + 2 * m)} ${r2(ey - m)}`;
  const eyes = ART.eyes.map(([ex0, ey0]) => ({
    cx: r2(ex0 + s.gx),
    cy: r2(ey0 + s.gy),
    ry: r2(Math.max(0.2, eyeR * s.eye)),
  }));
  return {
    body,
    legs,
    arms,
    face: `translate(${r2(s.fx)} ${r2(s.fy)})`,
    mouth,
    eyes,
    hand: `translate(${r2(s.rx)} ${r2(s.ry)})`,
  };
}
