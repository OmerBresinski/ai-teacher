import { useEffect, useRef } from "react";
import {
  ART,
  BLINK,
  blinkAt,
  breathAt,
  CARD,
  type CastContext,
  type CastState,
  CLIPS,
  type Clip,
  CONTEXTS,
  geometry,
  type Plan,
  type Pose,
  planFor,
  poseAt,
  stackAt,
  stillPose,
} from "./slides";

/*
 * The runtime for Slides' cast module in the editor (TEACH-97). It draws the homepage artwork into
 * a fixed set of SVG nodes and writes attributes every display frame while a beat or loop plays
 * (ANIMATION-PROCESS §5, §8). It pauses in a hidden tab (the clock resumes where it was), stays
 * still under reduced motion (a `change` listener keeps a flag; switching mid-beat shows the
 * state's still pose), and stops its resting life after `idleFor`, so nothing loops forever while
 * idle. At rest it sleeps on timers: breath repaints at 10 fps, never a rAF poll.
 */

export type FrameInfo = { clip: string | null; t: number };

const BLEND = 240;
const reduceQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

export function SlidesActor({
  context,
  state,
  className,
  onFrame,
}: {
  context: CastContext;
  state: CastState;
  className?: string;
  /** Called on every painted frame with the playing clip and its time (the pane's miniature). */
  onFrame?: (f: FrameInfo) => void;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const frame = useRef(onFrame);
  frame.current = onFrame;

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const r = new Runtime(el, context, (f) => frame.current?.(f));
    runtime.current = r;
    return () => r.dispose();
  }, [context]);

  useEffect(() => {
    runtime.current?.setState(state);
  }, [state]);

  const size = CONTEXTS[context].size;
  const stroke = Math.max(2.4, (300 / size) * 0.95);
  const eyeR = Math.max(3, (300 / size) * 0.8);
  const g = geometry(stillPose(context, state), 0, eyeR);
  const stack = stackAt(0, 0);
  return (
    <svg
      ref={svg}
      viewBox={ART.viewBox}
      aria-hidden="true"
      data-cast="slides"
      data-cast-context={context}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      style={{ overflow: "visible" }}
    >
      <path data-part="legs" d={g.legs} />
      <g data-part="body" transform={g.body}>
        <path data-part="arm-left" d={g.arms[0]?.d} transform={g.arms[0]?.transform} />
        <path data-part="arm-right" d={g.arms[1]?.d} transform={g.arms[1]?.transform} />
        <path d="m44 68 200-9 8 164-200 7Z" fill="#faf5df" />
        <path d="m52 62 201-8 7 164-200 7Z" fill="#f5c054" />
        <path d="m57 64 199-7 5 160-199 8Z" />
        <path d="m83 88 147-6" />
        <path d="m89 186 27-25 24 15 30-32 54 39Z" fill="#e88f52" />
        <circle cx="207" cy="113" r="14" fill="#fff3cb" />
        <g data-part="face" transform={g.face}>
          {g.eyes.map((e, i) => (
            <ellipse
              key={ART.eyes[i]?.[0]}
              data-part="eye"
              cx={e.cx}
              cy={e.cy}
              rx={eyeR}
              ry={e.ry}
              fill="currentColor"
              stroke="none"
            />
          ))}
          <path data-part="mouth" d={g.mouth} />
        </g>
      </g>
      {context === "bubble" ? (
        <g data-part="stack" transform={g.hand}>
          {[2, 1, 0].map((i) => {
            const p = stack[i] as { x: number; y: number; rot: number };
            return (
              <g
                key={i}
                data-card={i}
                transform={`translate(${p.x} ${p.y}) rotate(${p.rot} ${CARD.x + CARD.w / 2} ${CARD.y + CARD.h})`}
              >
                <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx={7} fill="#fffdf4" />
                <path d={`M${CARD.x + 14} ${CARD.y + 18}h40`} />
                <path
                  d={`M${CARD.x + 14} ${CARD.y + 38}h22v10h-22Z`}
                  fill="#f5c054"
                  strokeWidth={stroke * 0.6}
                />
              </g>
            );
          })}
        </g>
      ) : (
        <g data-part="pencil" transform={g.hand}>
          <g transform={`rotate(-38 ${ART.hand[0]} ${ART.hand[1]})`}>
            <path d="M264 88h46v13h-46Z" fill="#f5c054" />
            <path d="M310 88l15 6.5-15 6.5Z" fill="#fff3cb" />
            <path d="M321 92.5l4 2-4 2Z" fill="currentColor" stroke="none" />
            <path d="M256 88h8v13h-8Z" fill="#e88f52" />
          </g>
        </g>
      )}
    </svg>
  );
}

type Nodes = {
  legs: SVGPathElement;
  body: SVGGElement;
  arms: SVGPathElement[];
  face: SVGGElement;
  eyes: SVGEllipseElement[];
  mouth: SVGPathElement;
  hand: SVGGElement | null;
  cards: SVGGElement[];
  stack: SVGGElement | null;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Runtime {
  private nodes: Nodes;
  private state: CastState | undefined;
  private plan: Plan = { kind: "still" };
  private clip: { name: string; start: number } | null = null;
  private from: { pose: Pose; until: number } | null = null;
  private pose: Pose;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private reduced: boolean;
  private hidden = false;
  private paused = 0; // ms of clock held while hidden
  private hiddenAt = 0;
  private idleSince = 0;
  private breathStart = 0;
  private breathPeriod = 3800;
  private blinkAt = 0;
  private hover: Element | null = null;
  private eyeR: number;
  private mq = reduceQuery();
  constructor(
    private svg: SVGSVGElement,
    private context: CastContext,
    private onFrame: (f: { clip: string | null; t: number }) => void,
  ) {
    const q = <T extends Element>(s: string) => svg.querySelector(s) as T;
    this.nodes = {
      legs: q("[data-part=legs]"),
      body: q("[data-part=body]"),
      arms: [q("[data-part=arm-left]"), q("[data-part=arm-right]")],
      face: q("[data-part=face]"),
      eyes: [...svg.querySelectorAll<SVGEllipseElement>("[data-part=eye]")],
      mouth: q("[data-part=mouth]"),
      hand: svg.querySelector("[data-part=stack]") ?? svg.querySelector("[data-part=pencil]"),
      stack: svg.querySelector("[data-part=stack]"),
      cards: [0, 1, 2].map((i) => q<SVGGElement>(`[data-card="${i}"]`)).filter(Boolean),
    };
    this.eyeR = Math.max(3, (300 / CONTEXTS[context].size) * 0.8);
    this.reduced = this.mq?.matches ?? false;
    this.pose = stillPose(context, "idle");
    this.mq?.addEventListener?.("change", this.onReduce);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.hidden = document.hidden;
    if (CONTEXTS[context].hover) {
      this.hover = svg.closest("button");
      this.hover?.addEventListener("pointerenter", this.onHover);
    }
  }
  private now = () => performance.now() - this.paused;
  private onReduce = (e: MediaQueryListEvent) => {
    this.reduced = e.matches;
    this.apply(this.state ?? "idle", this.state);
  };
  private onVisibility = () => {
    this.hidden = document.hidden;
    if (this.hidden) {
      this.hiddenAt = performance.now();
      this.halt();
    } else {
      this.paused += performance.now() - this.hiddenAt;
      this.kick();
    }
  };
  private onHover = () => {
    if (this.reduced || this.hidden) return;
    const name = CONTEXTS[this.context].hover;
    // Hovers react at once, every time; a working loop keeps working (it is already alive).
    if (!name || this.plan.kind === "loop") return;
    this.startClip(name);
    this.idleSince = this.now();
  };
  setState(next: CastState) {
    const prev = this.state;
    this.state = next;
    this.svg.dataset.castState = next;
    this.apply(next, prev);
  }
  private apply(next: CastState, prev: CastState | undefined) {
    this.plan = planFor(this.context, prev, next, this.reduced);
    this.svg.dataset.castReduced = this.reduced ? "true" : "false";
    this.halt();
    if (this.plan.kind === "still") {
      this.clip = null;
      this.from = null;
      this.pose = stillPose(this.context, next);
      this.paint(this.pose, 0);
      this.svg.dataset.castBeat = "still";
      return;
    }
    if (this.plan.kind === "idle") {
      this.clip = null;
      this.blendTo();
      this.idleSince = this.now();
      this.breathStart = this.now() + rand(200, 1200);
      this.breathPeriod = rand(3610, 3990);
      this.blinkAt = this.now() + rand(1500, 3000);
      this.svg.dataset.castBeat = "idle";
    } else {
      this.startClip(this.plan.clip);
    }
    this.kick();
  }
  private blendTo() {
    this.from = { pose: { ...this.pose }, until: this.now() + BLEND };
  }
  private startClip(name: string) {
    this.blendTo();
    this.clip = { name, start: this.now() };
    this.svg.dataset.castBeat = name;
    this.halt();
    this.kick();
  }
  private halt() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.timer) clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }
  private kick() {
    if (this.hidden || this.reduced || this.raf || this.timer) return;
    this.tick();
  }
  private tick = () => {
    this.raf = 0;
    this.timer = 0;
    if (this.hidden || this.reduced) return;
    const t = this.now();
    const base = stillPose(this.context, this.state ?? "idle");
    let pose: Pose;
    let breath = 0;
    let fast = false;
    if (this.clip) {
      const clip = CLIPS[this.clip.name] as Clip;
      const local = t - this.clip.start;
      // A hover plays over the resting pose; a state's beat or loop plays over the context's base.
      const from = this.clip.name === "perk" ? base : stillPose(this.context, "idle");
      pose = poseAt(clip, local, from);
      fast = true;
      this.onFrame({ clip: this.clip.name, t: local });
      if (!clip.loop && local >= clip.duration) {
        pose = poseAt(clip, clip.duration, from);
        this.clip = null;
        if (this.plan.kind === "beat") this.svg.dataset.castBeat = "still";
        if (this.plan.kind === "idle") {
          this.svg.dataset.castBeat = "idle";
          this.idleSince = t;
        }
        fast = false;
      }
    } else {
      pose = { ...base };
      this.onFrame({ clip: null, t: 0 });
    }
    if (this.from) {
      const u = Math.min(1, 1 - (this.from.until - t) / BLEND);
      const w = 1 - (1 - u) ** 2;
      const mixed = { ...pose };
      for (const k of Object.keys(pose) as (keyof Pose)[]) {
        if (k === "card" || k === "shift") continue;
        mixed[k] = this.from.pose[k] + (pose[k] - this.from.pose[k]) * w;
      }
      pose = mixed;
      if (u >= 1) this.from = null;
      else fast = true;
    }
    // Resting life: breath (bubble) and blinks, only for `idleFor` after the last thing happened.
    const life =
      this.plan.kind === "idle" &&
      !this.clip &&
      t - this.idleSince < CONTEXTS[this.context].idleFor;
    if (this.plan.kind === "idle" && !this.clip) {
      if (CONTEXTS[this.context].breath && t >= this.breathStart) {
        breath =
          breathAt(t - this.breathStart, this.breathPeriod) * CONTEXTS[this.context].breathScale;
      }
    }
    if (this.plan.kind === "idle" && !this.clip) {
      const b = t - this.blinkAt;
      if (b >= 0) {
        pose = { ...pose, eye: pose.eye * blinkAt(b) };
        if (b >= BLINK.ms) this.blinkAt = t + rand(BLINK.gap[0], BLINK.gap[1]);
        else fast = true;
      }
    }
    this.pose = pose;
    this.paint(pose, breath);
    if (fast) this.raf = requestAnimationFrame(this.tick);
    else if (life || (this.plan.kind === "idle" && breath > 0)) {
      // At rest: sleep on a timer. Breath repaints at 10 fps; between breaths, until the blink.
      const wait = CONTEXTS[this.context].breath ? 100 : Math.max(16, this.blinkAt - t);
      this.timer = setTimeout(this.tick, wait);
    } else if (this.plan.kind === "idle") {
      // The resting life is over: settle on the rest pose and stop.
      this.paint(base, 0);
      this.svg.dataset.castBeat = "rest";
    }
  };
  private paint(s: Pose, breath: number) {
    const g = geometry(s, breath, this.eyeR);
    const n = this.nodes;
    set(n.legs, "d", g.legs);
    set(n.body, "transform", g.body);
    g.arms.forEach((a, i) => {
      const el = n.arms[i];
      if (!el) return;
      set(el, "d", a.d);
      set(el, "transform", a.transform);
    });
    set(n.face, "transform", g.face);
    g.eyes.forEach((e, i) => {
      const el = n.eyes[i];
      if (!el) return;
      set(el, "cx", e.cx);
      set(el, "cy", e.cy);
      set(el, "ry", e.ry);
    });
    set(n.mouth, "d", g.mouth);
    if (n.hand) set(n.hand, "transform", g.hand);
    if (n.stack && n.cards.length === 3) {
      // Cards are named by their place at the start of each loop; the stack turns one place a loop.
      const loops =
        this.clip?.name === "riffle" ? Math.floor((this.now() - this.clip.start) / 1600) : 0;
      const places = stackAt(s.card, s.shift);
      const order: SVGGElement[] = [];
      places.forEach((p, slot) => {
        const el = n.cards[(slot + loops) % 3] as SVGGElement;
        set(
          el,
          "transform",
          `translate(${round(p.x)} ${round(p.y)}) rotate(${round(p.rot)} ${CARD.x + CARD.w / 2} ${CARD.y + CARD.h})`,
        );
        order[slot] = el;
      });
      // Draw order, back to front: the travelling card goes behind only once over the top.
      const back = places[0]?.behind
        ? [order[0], order[2], order[1]]
        : [order[2], order[1], order[0]];
      if (back.some((el, i) => n.stack?.children[i] !== el))
        for (const el of back) if (el) n.stack.append(el);
    }
  }
  dispose() {
    this.halt();
    this.mq?.removeEventListener?.("change", this.onReduce);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.hover?.removeEventListener("pointerenter", this.onHover);
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
function set(el: Element, name: string, value: string | number) {
  const v = String(value);
  if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}
