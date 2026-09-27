import type { loadGsap } from "@/lib/gsap";

/*
 * The DayBack cast's life on /sign-in (TEACH-252). A port of the homepage hero's rig
 * (homepage/assets/hero-motion.js: the sway, bob, blink and arm swing of the approved hero poses,
 * and each character's hover gesture), plus the gaze, smile and hop from homepage/motion/cast.js,
 * so the four characters can react to the form. Framework-free: `sign-in-cast.tsx` renders the
 * SVGs and hands them over with GSAP, or with `null` when motion is off (ADR 0028: reduced motion
 * means no motion, so the static cast only changes expression).
 */

type Gsap = Awaited<ReturnType<typeof loadGsap>>;
type Timeline = ReturnType<Gsap["timeline"]>;

export type CastKind = "slides" | "activity" | "support" | "answers";

/** What the page is doing, which is what the cast reacts to. */
export type CastMood = "idle" | "typing" | "sending" | "sent" | "error" | "leaving";

type Point = readonly [number, number];
/** Hip, ankle and toe of one leg, in the 300 x 300 artwork space. */
type Foot = readonly [number, number, number, number, number, number];
type Pose = {
  /** The body's resting tilt in degrees. */
  angle: number;
  /** Mouth start, control and end at rest (`M x y Q cx cy ex ey`). */
  face: readonly [number, number, number, number, number, number];
  /** Left and right shoulder pivots. */
  pivots: readonly [Point, Point];
  feet: readonly [Foot, Foot];
};

/** Copied from homepage/src/hero-artwork.mjs `poses`, which the hero artwork is drawn from. */
export const POSES: Record<CastKind, Pose> = {
  support: {
    angle: -9,
    face: [130, 153, 144, 164, 158, 152],
    pivots: [
      [49, 162],
      [238, 158],
    ],
    feet: [
      [91, 229, 80, 277, 59, 282],
      [198, 228, 199, 266, 222, 270],
    ],
  },
  slides: {
    angle: 0,
    face: [123, 136, 134, 146, 146, 135],
    pivots: [
      [48, 132],
      [248, 135],
    ],
    feet: [
      [82, 211, 73, 251, 55, 256],
      [213, 205, 217, 239, 234, 242],
    ],
  },
  activity: {
    angle: 0,
    face: [133, 130, 144, 143, 155, 130],
    pivots: [
      [66, 143],
      [235, 143],
    ],
    feet: [
      [99, 229, 92, 267, 74, 271],
      [190, 235, 195, 270, 213, 274],
    ],
  },
  answers: {
    angle: 7,
    face: [141, 149, 151, 157, 160, 148],
    pivots: [
      [77, 151],
      [217, 151],
    ],
    feet: [
      [115, 232, 120, 269, 101, 273],
      [180, 232, 192, 279, 209, 283],
    ],
  },
};

/** The homepage hero's order, which sets each character's sway period and phase. */
const ORDER: readonly CastKind[] = ["slides", "activity", "support", "answers"];
const PERIODS = [4.7, 5.4, 6.1, 6.8];

/**
 * The legs for a body tilted by `angle` and lifted by `lift`: hips follow the paper, ankles stay on
 * the floor unless the whole character hops. At rest this is exactly the artwork's `hero-legs`.
 */
export function legsPath(pose: Pose, angle: number, lift: number, hop = 0): string {
  const rad = (angle * Math.PI) / 180;
  return pose.feet
    .map(([hx, hy, ax, ay, tx, ty]) => {
      const x = 150 + (hx - 150) * Math.cos(rad) - (hy - 235) * Math.sin(rad);
      const y = 235 + lift + hop + (hx - 150) * Math.sin(rad) + (hy - 235) * Math.cos(rad);
      const ankle = ay + hop;
      return `M${x} ${y} Q${(x + ax) / 2} ${(y + ankle) / 2} ${ax} ${ankle} L${tx} ${ty + hop}`;
    })
    .join(" ");
}

/** The mouth for a smile from -1 (worried) through 0 (the artwork's) to 1 (delighted). */
export function mouthPath(face: Pose["face"], smile: number): string {
  const [x, y, cx, cy, ex, ey] = face;
  return `M${x - 2 * smile} ${y - smile} Q${cx} ${cy + 8 * smile} ${ex + 2 * smile} ${ey - smile}`;
}

/** Everything a scene can move. Zero is the artwork's pose. */
type Motion = {
  rise: number;
  lean: number;
  gesture: number;
  leftGesture: number;
  rightGesture: number;
  glassesLift: number;
  smile: number;
  gx: number;
  gy: number;
  hop: number;
};

/** Back to the artwork's pose, eyes left where they are (the pointer or a scene owns the gaze). */
const POSE: Omit<Motion, "gx" | "gy"> = {
  rise: 0,
  lean: 0,
  gesture: 0,
  leftGesture: 0,
  rightGesture: 0,
  glassesLift: 0,
  smile: 0,
  hop: 0,
};

const REST: Motion = { ...POSE, gx: 0, gy: 0 };

/** The expression a still cast keeps for each mood when motion is off. */
const STILL_SMILE: Record<CastMood, number> = {
  idle: 0,
  typing: 0,
  sending: 0,
  sent: 0.8,
  error: -0.35,
  leaving: 0,
};

type Eye = { el: SVGEllipseElement; x: number; y: number; r: number };

type Actor = {
  kind: CastKind;
  index: number;
  host: HTMLElement;
  pose: Pose;
  body: SVGGElement;
  legs: SVGPathElement;
  ground: SVGGElement | null;
  left: SVGGElement;
  right: SVGGElement;
  glasses: SVGGElement | null;
  mouth: SVGPathElement;
  eyes: Eye[];
  m: Motion;
  visible: boolean;
};

function part<T extends Element>(host: HTMLElement, selector: string): T {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`cast: ${host.dataset.cast} has no ${selector}`);
  return found;
}

function actorFor(host: HTMLElement): Actor {
  const kind = host.dataset.cast as CastKind;
  return {
    kind,
    index: ORDER.indexOf(kind),
    host,
    pose: POSES[kind],
    body: part(host, ".body"),
    legs: part(host, ".hero-legs"),
    ground: host.querySelector(".ground"),
    left: part(host, ".arm-left"),
    right: part(host, ".arm-right"),
    glasses: host.querySelector(".glasses"),
    mouth: part(host, ".mouth"),
    eyes: [...host.querySelectorAll<SVGEllipseElement>(".eye")].map((el) => ({
      el,
      x: Number(el.getAttribute("cx")),
      y: Number(el.getAttribute("cy")),
      r: Number(el.getAttribute("rx")),
    })),
    m: { ...REST },
    visible: false,
  };
}

/** Eyes close for 0.18 s once per cycle, staggered by character (hero-motion.js). */
function blinkAt(elapsed: number, index: number): number {
  const at = (elapsed + index * 1.3) % (5.2 + index * 0.8);
  return at > 0.18 ? 1 : Math.abs(at - 0.09) / 0.09;
}

/** `living` adds the ambient sway and blink on top of the scene's motion. */
function paint(a: Actor, elapsed: number, living: boolean) {
  const { pose, index, m } = a;
  const phase = (elapsed * Math.PI * 2) / (PERIODS[index] ?? 5) + index * 1.7;
  const lift = (living ? Math.sin(phase * 1.17) * 1.25 : 0) + m.rise;
  const angle = pose.angle + (living ? Math.sin(phase) * 0.85 : 0) + m.lean;
  const arm = (living ? Math.sin(phase * 0.7) * 0.65 : 0) + m.gesture;
  a.body.setAttribute(
    "transform",
    `translate(0 ${lift + m.hop}) translate(150 235) rotate(${angle}) translate(-150 -235)`,
  );
  a.legs.setAttribute("d", legsPath(pose, angle, lift, m.hop));
  a.left.setAttribute(
    "transform",
    `rotate(${arm * 0.5 + m.leftGesture} ${pose.pivots[0].join(" ")})`,
  );
  a.right.setAttribute("transform", `rotate(${-arm + m.rightGesture} ${pose.pivots[1].join(" ")})`);
  a.glasses?.setAttribute("transform", `translate(0 ${m.glassesLift})`);
  const blink = living ? blinkAt(elapsed, index) : 1;
  for (const eye of a.eyes) {
    eye.el.setAttribute("cx", String(eye.x + m.gx));
    eye.el.setAttribute("cy", String(eye.y + m.gy));
    eye.el.setAttribute("ry", String(Math.max(0.2, eye.r * blink)));
  }
  a.mouth.setAttribute("d", mouthPath(pose.face, m.smile));
  // The ground shadow thins as the feet leave it.
  if (a.ground) a.ground.style.opacity = String(Math.max(0.35, 1 + m.hop * 0.03));
}

/** Where a character's eyes point to look at a spot on screen, in artwork units. */
function gazeAt(a: Actor, x: number, y: number, reach: number): Pick<Motion, "gx" | "gy"> {
  const box = a.host.getBoundingClientRect();
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return {
    gx: clamp((x - (box.left + box.width * 0.49)) / 120, 3 * reach),
    gy: clamp((y - (box.top + box.height * 0.44)) / 160, 1.6 * reach),
  };
}

function centreOf(target: Element): [number, number] {
  const box = target.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
}

let measure: CanvasRenderingContext2D | null = null;

/** The end of what has been typed in a field, on screen, so the cast can read along. */
function caretOf(input: HTMLInputElement): [number, number] {
  const box = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  measure ??= document.createElement("canvas").getContext("2d");
  let width = 0;
  if (measure) {
    measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    width = measure.measureText(input.value).width;
  }
  const start = box.left + Number.parseFloat(style.paddingLeft);
  const end = box.right - Number.parseFloat(style.paddingRight);
  return [Math.min(start + width - input.scrollLeft, end), box.top + box.height / 2];
}

export type Cast = {
  /** React to the page. `target` is what the cast should look at, when there is one. */
  setMood(mood: CastMood, target: Element | null): void;
  /**
   * The arrival: Slides and Worksheet climb up from behind the card, Plan and Check step in, then
   * each says hello with its gesture. The stage starts `data-cast-stage="waiting"`, which keeps
   * them out of sight until this takes over.
   */
  enter(stage: HTMLElement, greet: boolean): void;
  destroy(): void;
};

/**
 * Brings the rendered cast to life. `hosts` are the character wrappers (`data-cast="<kind>"`).
 * With `gsap` null the cast stays still and only its expression follows the mood.
 */
export function createCast(hosts: HTMLElement[], gsap: Gsap | null): Cast {
  const actors = hosts.map(actorFor);
  return gsap ? livingCast(actors, gsap) : stillCast(actors);
}

function livingCast(actors: Actor[], gsap: Gsap): Cast {
  let elapsed = 0;
  let mood: CastMood = "idle";
  let scene: Timeline | null = null;

  const tick = (_time: number, deltaMs: number) => {
    if (document.hidden) return;
    elapsed += Math.min(deltaMs / 1000, 0.05);
    for (const a of actors) if (a.visible) paint(a, elapsed, true);
  };
  gsap.ticker.add(tick);

  // Offscreen or display:none characters (Plan and Check below `lg`) stop painting.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const a = actors.find((item) => item.host === entry.target);
        if (a) a.visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      }
    },
    { threshold: [0, 0.25] },
  );
  for (const a of actors) observer.observe(a.host);

  /** Each character's hover gesture from the homepage hero, starting at `at`. */
  function gesture(t: Timeline, a: Actor, at: number) {
    const to = (values: Partial<Motion>, offset: number, duration: number) =>
      t.to(a.m, { ...values, duration, ease: "sine.inOut" }, at + offset);
    if (a.kind === "slides") {
      to({ lean: -3, rise: -1.5, rightGesture: -22, leftGesture: 4 }, 0, 0.45);
      to({ rightGesture: -8 }, 0.45, 0.18);
      to({ rightGesture: -20 }, 0.63, 0.2);
      to({ rightGesture: -12 }, 0.83, 0.2);
    } else if (a.kind === "activity") {
      to({ rise: 2, lean: -1 }, 0, 0.14);
      to({ rise: -3, lean: 2, rightGesture: 20, leftGesture: 6 }, 0.14, 0.42);
      to({ rightGesture: 15 }, 0.56, 0.35);
    } else if (a.kind === "support") {
      to({ rise: 1.5, lean: -1 }, 0, 0.27);
      to({ rise: -1, leftGesture: 18, rightGesture: -18 }, 0.27, 0.65);
    } else {
      to({ lean: 2.8, rise: 1 }, 0, 0.4);
      to({ glassesLift: -3.2, rightGesture: -9 }, 0.25, 0.4);
      to({ rise: 2.5, lean: 1.8 }, 0.7, 0.22);
    }
    to({ leftGesture: 0, rightGesture: 0, lean: 0, rise: 0, glassesLift: 0 }, 1.05, 0.8);
  }

  function lookAll(target: Element | [number, number] | null, reach = 1.2) {
    if (!target) return;
    const [x, y] = Array.isArray(target) ? target : centreOf(target);
    for (const a of actors) {
      gsap.to(a.m, {
        ...gazeAt(a, x, y, reach),
        duration: 0.45,
        ease: "power2.out",
        overwrite: "auto",
      });
    }
  }

  function play(build: (t: Timeline) => void) {
    scene?.kill();
    const t = gsap.timeline();
    // Every scene starts by easing the last one's pose away.
    t.to(
      actors.map((a) => a.m),
      { ...POSE, duration: 0.35, ease: "sine.out" },
      0,
    );
    build(t);
    scene = t;
  }

  const byKind = (kind: CastKind) => actors.find((a) => a.kind === kind);
  const tween = (
    t: Timeline,
    a: Actor | undefined,
    values: Partial<Motion>,
    at: number,
    d: number,
    ease = "sine.inOut",
  ) => {
    if (a) t.to(a.m, { ...values, duration: d, ease }, at);
  };

  // While typing, the eyes follow the end of the address and Check nods along.
  let reading: (() => void) | null = null;
  function readAlong(input: HTMLInputElement) {
    const follow = () => {
      const [x, y] = caretOf(input);
      for (const a of actors) {
        const box = a.host.getBoundingClientRect();
        // Eyes and head both turn to the caret, so the reading shows at this size.
        const lean = Math.max(-2.4, Math.min(2.4, (x - (box.left + box.width / 2)) / 160));
        gsap.to(a.m, {
          ...gazeAt(a, x, y, 1.6),
          lean,
          duration: 0.3,
          ease: "power2.out",
          overwrite: "auto",
        });
      }
    };
    const onInput = () => {
      follow();
      const check = byKind("answers");
      if (check)
        gsap
          .timeline()
          .to(check.m, { rise: 1.2, duration: 0.1, ease: "sine.out" })
          .to(check.m, { rise: 0, duration: 0.25, ease: "sine.inOut" });
    };
    input.addEventListener("input", onInput);
    follow();
    reading = () => input.removeEventListener("input", onInput);
  }

  function setMood(next: CastMood, target: Element | null) {
    mood = next;
    reading?.();
    reading = null;
    if (next === "idle") {
      play(() => {});
      return;
    }
    if (next === "typing" && target instanceof HTMLInputElement) readAlong(target);
    else lookAll(target);
    play((t) => {
      const everyone = (values: Partial<Motion>, at: number, d: number, ease?: string) => {
        for (const a of actors) tween(t, a, values, at, d, ease);
      };
      if (next === "typing") {
        // Interested: a small smile while `readAlong` turns eyes and heads to the caret.
        everyone({ smile: 0.25 }, 0, 0.5);
      } else if (next === "sending") {
        // Attentive: everyone lifts a little; Worksheet readies the pencil.
        everyone({ rise: -1.5, smile: 0.4 }, 0, 0.4);
        tween(t, byKind("activity"), { rightGesture: 14 }, 0.05, 0.4);
      } else if (next === "sent") {
        // The link is on its way: a hop each, a gesture each, one after another.
        for (const a of actors) {
          const at = a.index * 0.1;
          tween(t, a, { smile: 1 }, at, 0.3);
          tween(t, a, { hop: -26 }, at, 0.3, "power2.out");
          tween(t, a, { hop: 0 }, at + 0.3, 0.6, "bounce.out");
          gesture(t, a, at + 0.05);
          tween(t, a, { smile: 0.7 }, at + 2, 0.6);
        }
      } else if (next === "error") {
        // Worried faces; Check lifts its glasses to read what went wrong.
        everyone({ smile: -0.35, rise: 0.8 }, 0, 0.45);
        tween(t, byKind("answers"), { lean: 2.8, glassesLift: -3.2 }, 0.1, 0.5);
      } else if (next === "leaving") {
        // Off to Google: Slides waves goodbye.
        everyone({ smile: 0.5 }, 0, 0.4);
        const slides = byKind("slides");
        if (slides) gesture(t, slides, 0);
      }
    });
  }

  // In the idle mood the eyes follow the pointer, as Check's do on the homepage.
  const onPointerMove = (event: PointerEvent) => {
    if (mood !== "idle" || event.pointerType === "touch") return;
    for (const a of actors) {
      if (!a.visible) continue;
      gsap.to(a.m, {
        ...gazeAt(a, event.clientX, event.clientY, 1),
        duration: 0.38,
        ease: "power2.out",
        overwrite: "auto",
      });
    }
  };
  const onPointerLeave = () => {
    if (mood === "idle")
      gsap.to(
        actors.map((a) => a.m),
        { gx: 0, gy: 0, duration: 0.4, overwrite: "auto" },
      );
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave);

  // Hovering a character plays its gesture, as on the homepage, while nothing else is going on.
  const hovers = actors.map((a) => {
    const onEnter = (event: PointerEvent) => {
      if (mood !== "idle" || event.pointerType === "touch" || !a.visible) return;
      const t = gsap.timeline();
      gesture(t, a, 0);
    };
    a.host.addEventListener("pointerenter", onEnter);
    return () => a.host.removeEventListener("pointerenter", onEnter);
  });

  return {
    setMood,
    enter(stage, greet) {
      const peekers = actors.filter((a) => a.kind === "slides" || a.kind === "activity");
      const sides = actors.filter((a) => a.kind === "support" || a.kind === "answers");
      gsap.set(
        peekers.map((a) => a.host),
        { yPercent: 100 },
      );
      gsap.set(
        sides.map((a) => a.host),
        { opacity: 0, y: 18 },
      );
      stage.dataset.castStage = "live";
      const t = gsap.timeline({ delay: 0.15 });
      t.to(
        peekers.map((a) => a.host),
        {
          yPercent: 0,
          duration: 0.75,
          ease: "back.out(1.7)",
          stagger: 0.16,
          clearProps: "transform",
        },
        0,
      );
      t.to(
        sides.map((a) => a.host),
        { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", stagger: 0.16, clearProps: "all" },
        0.12,
      );
      if (!greet) return;
      play((scene) => {
        for (const a of actors) {
          const at = 0.75 + a.index * 0.18;
          gesture(scene, a, at);
          tween(scene, a, { smile: 0.6 }, at, 0.4);
          tween(scene, a, { smile: 0 }, at + 1.4, 0.6);
        }
      });
    },
    destroy() {
      scene?.kill();
      reading?.();
      gsap.ticker.remove(tick);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      for (const off of hovers) off();
      for (const a of actors) {
        gsap.killTweensOf(a.m);
        a.m = { ...REST };
        paint(a, 0, false);
      }
    },
  };
}

/** Motion off: the pose never changes, only the face follows the mood. */
function stillCast(actors: Actor[]): Cast {
  const show = (mood: CastMood) => {
    for (const a of actors) {
      a.m = { ...REST, smile: STILL_SMILE[mood] };
      paint(a, 0, false);
    }
  };
  return {
    setMood: (mood) => show(mood),
    enter(stage) {
      stage.dataset.castStage = "still";
    },
    destroy: () => show("idle"),
  };
}
