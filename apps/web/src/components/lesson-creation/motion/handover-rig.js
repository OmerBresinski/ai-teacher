import { artwork } from "./artwork.js";
import { drawnBody, restBody, restingLife } from "./body-draw.js";
import { CAST_CLIPS } from "./cast-clips.js";
import { fanRig } from "./fan-rig.js";
import { buildBeat, buildReaction } from "./work-beats.js";

const zeroBody = () => {
  const z = restBody();
  for (const k of Object.keys(z)) z[k] = 0;
  return z;
};
const BODY = Object.keys(restBody());
// Pose values that switch rather than move: never blended.
const DISCRETE = new Set([
  "tool",
  "stroke",
  "pending",
  "sheet",
  "paperFront",
  "sheetFront",
  "carryFront",
  "contact",
  "questions",
]);

// Original production rig: scoped geometry/contacts only. No demo UI, readiness, or global controller.
let serial = 0;
export function createHandoverRig(root, gsap) {
  const prefix = `intake-rig-${serial++}-`;
  const found = new Map();
  const $ = (selector) => {
    let el = found.get(selector);
    if (!el) {
      el = root.querySelector(selector.replace(/#([\w-]+)/g, (_, id) => `#${prefix}${id}`));
      if (el) found.set(selector, el);
    }
    return el;
  };
  const pref = matchMedia("(prefers-reduced-motion: reduce)");
  // Kept by the change listener; never read `.matches` per frame (Chromium can drop the event).
  let reduced = pref.matches,
    onScreen = true;
  let current = 0,
    paused = false,
    fanMode = false,
    worksheetSource = false,
    tl = null,
    reaction = null,
    handoff = null;
  const names = ["Plan", "Slides", "Worksheet", "Check"],
    keys = ["support", "slides", "activity", "answers"];
  // 12: Slides' own entrance when it is the first character making anything (slides only).
  // 13-17: Plan reads the teacher's brief on the planning stage: picks it up, reads a line, turns
  // the page (its check-through), looks up with a nod, lowers it.
  const beats = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 2, 1, 0, 0, 0, 0, 0].map((owner) => ["", owner]);
  const ownerOf = () => handoff?.from ?? beats[current][1];
  const receiverOf = () => handoff?.to ?? ownerOf() + 1;
  // `b` is the beat's pose; `r` is a reaction layered on top (deltas from rest), so a nod or a
  // leap never fights the beat for the same values.
  const actors = names.map((_, i) => ({
    x: i === 0 ? 320 : 760,
    alpha: i === 0 ? 1 : 0,
    b: restBody(),
    r: zeroBody(),
    // The cast layer: a clip baked from the character's own cast module (deltas from rest).
    c: zeroBody(),
  }));
  const castFx = names.map(() => ({
    look: 0,
    hlx: 0,
    hly: 0,
    hrx: 0,
    hry: 0,
    penRot: 0,
    penToss: 0,
    lift: 0,
    riffle: 0,
    lookY: 0,
    reach: 0,
  }));
  // Persona blink spacing: Plan slow, Slides quick, Worksheet sometimes doubles, Check considered.
  const lives = [
    restingLife({ gaps: [5, 7], depth: 0.9 }),
    restingLife({ gaps: [3, 4.5], depth: 1.2 }),
    restingLife({ gaps: [3, 5], double: 0.35 }),
    restingLife({ gaps: [3.5, 6.5], depth: 0.8 }),
  ];
  const p = {
    x: 320,
    y: 251,
    r: 0,
    fold: 0,
    deck: 0,
    sheet: 0,
    extend: 0,
    ink: 0,
    questions: 0,
    spread: 0,
    compare: 0,
    seal: 0,
    tool: 0,
    rx: 357,
    ry: 251,
    gesture: 0,
    spark: 0,
    offer: 0,
    grip: 0,
    look: 0,
    toolAlpha: 0,
    pending: 0,
    pendingY: -25,
    stackGap: 1,
    px: 0,
    py: 4,
    pr: 0,
    paperFront: 0,
    magic: 0,
    sx: 0,
    sy: 18,
    sr: 0,
    sheetFront: 0,
    q0: 0,
    q1: 0,
    q2: 0,
    stroke: -1,
    penX: -21,
    penY: -27,
    contact: 0,
    sweep: 0,
    sheetGrip: 0,
    extractGrip: 0,
    gazeMix: 0,
    gripShape: 0,
    ambientGate: 1,
    outerRelease: 0,
    carryFront: 0,
    hold: 1,
    lie: 0,
    gazeY: 0,
  };
  const parsed = {};
  for (const k of keys) {
    const d = new DOMParser().parseFromString(artwork[k], "image/svg+xml");
    d.querySelectorAll(".arm-left,.arm-right,.happy-mouth").forEach((e) => {
      e.remove();
    });
    if (k === "activity") d.querySelector(".mouth").setAttribute("d", "M136 121q10 9 20-2");
    const gaze = d.createElementNS("http://www.w3.org/2000/svg", "g");
    gaze.setAttribute("class", "gaze");
    d.querySelectorAll(".eye").forEach((e) => {
      gaze.append(e);
    });
    d.querySelector(".body").append(gaze);
    parsed[k] = d.documentElement.innerHTML;
  }
  const paper = (fill) =>
    `<rect x="-37.2" y="-26.4" width="74.4" height="52.8" rx="2.4" fill="${fill}"/>`;
  root.innerHTML = `<svg class="production-scene" viewBox="80 45 480 280" aria-hidden="true"><g class="ground-shadows">${actors.map((_, i) => `<ellipse data-shadow="${i}" cx="320" cy="305" rx="67" ry="5" fill="#293b32" opacity=".12" stroke="none"/>`).join("")}</g><g id="dust" stroke="#9aa590" stroke-width="1.6" fill="none">${[0, 1, 2, 3].map(() => "<ellipse/>").join("")}</g><g id="people">${keys.map((k, i) => (i === 1 ? `<g class="person" data-actor="1">${fanRig.markup()}</g>` : `<g class="person" data-actor="${i}"><g class="figure">${parsed[k]}</g></g>`)).join("")}</g><g id="package"><defs><clipPath id="stack-occlusion"><rect x="-200" y="-200" width="400" height="226.4"/></clipPath><clipPath id="magic-reveal"><rect class="magic-window" x="-37.2" y="-26.4" width="0" height="52.8"/></clipPath></defs><g class="reserve">${paper("#faf5df")}</g><g class="brief"></g><g class="deck" stroke-width="2.4"><g class="leaf back-a">${paper("#d6e2bd")}</g><g class="leaf back-b">${paper("#f5c054")}</g><g class="leaf front">${paper("#faf5df")}<path class="slide-ink" d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52"/><circle class="slide-sun" cx="19.2" cy="-12" r="4.8" fill="#f5c054"/></g></g><g class="worksheet"></g><g class="pending-slide" stroke-width="2.4">${paper("#faf5df")}<g clip-path="url(#magic-reveal)"><path d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52" stroke-width="2.4"/><circle cx="19.2" cy="-12" r="4.8" fill="#f5c054" stroke-width="2.4"/></g></g><g class="approved"><circle r="16" fill="#faf5df"/><path d="m-8 0 5 5 11-13"/></g></g><g id="comparison">${[0, 1].map((i) => `<g class="compare-page" data-page="${i}">${paper("#faf5df")}<path d="M-23-14H20M-23-4H12M-23 9H19"/><path d="${i ? "m5 16 4 4 8-10" : "M-21 18H-4"}" stroke="#9b704b"/></g>`).join("")}</g><g id="limbs">${actors.map((_, i) => `<g data-limbs="${i}"><path class="arm-l"/><path class="arm-r"/></g>`).join("")}</g><g id="fingers">${actors.map((_, i) => `<g data-fingers="${i}"><path class="finger-l"/><path class="finger-r"/></g>`).join("")}</g><g id="tool"><g class="pencil"><path d="M0 0 4-20 10-17Z" fill="#e88f52"/></g><g class="stamp"><path d="M-12 0H12V-7H-12ZM-4-7v-17h8v17" fill="#e88f52"/></g></g><g id="spark"><path d="M0-7V7M-7 0H7M-4-4 4 4M4-4-4 4" stroke="#ba8d3a"/></g><g id="accent" stroke="#e88f52" stroke-width="2.2" stroke-linecap="round" fill="none">${[0, 1, 2, 3, 4].map(() => "<path/>").join("")}</g></svg>`;
  root.innerHTML = root.innerHTML
    .replace(/id="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`);
  const scene = $(".production-scene"),
    fanSVG = scene.querySelector('[data-actor="1"] svg');
  fanSVG.setAttribute("width", "504");
  fanSVG.setAttribute("height", "360");
  const fan = fanRig.mount(fanSVG, gsap);
  fanSVG.querySelectorAll(":scope > path,:scope > ellipse").forEach((e) => {
    if (!e.classList.contains("legs")) e.style.display = "none";
  });
  const fanHands = [...fanSVG.querySelectorAll(".arm,.fingers,.held")];
  // Shoulder offsets at rest (relative to the actor's x), so hands can hang from drawn shoulders.
  const restShoulders = [
    [
      [57, 143],
      [237, 144],
    ],
    [-1, 1].map((side) => {
      const at = fanSVG.querySelector(side < 0 ? ".arm.left" : ".arm.right").getPointAtLength(0);
      return [at.x * 1.2 - 240, at.y * 1.2];
    }),
    [
      [70, 140],
      [222, 118],
    ],
    [
      [84, 150],
      [220, 151],
    ],
  ].map((pts, i) =>
    pts.map(([x, y]) => (i === 1 ? { x, y } : { x: x * 0.85 - 127.5, y: 65 + y * 0.85 })),
  );
  const figures = actors.map((_, i) => scene.querySelector(`[data-actor="${i}"]`));
  const sh = {
    support: [
      [57, 143],
      [237, 144],
    ],
    activity: [
      [70, 140],
      [222, 118],
    ],
    answers: [
      [84, 150],
      [220, 151],
    ],
  };
  const faces = [];
  const bodies = figures.map((figure, i) =>
    i === 1 ? null : drawnBody(figure.querySelector(".body"), keys[i]),
  );
  keys.forEach((k, i) => {
    if (i !== 1) return;
    if (i === 1) {
      // The fan rig's fixed face loop is retired: blinks come from the resting life.
      return;
    }
    const root = figures[i],
      m = root.querySelector(".mouth"),
      eyes = [...root.querySelectorAll(".eye")],
      base = m.getAttribute("d");
    const purse = {
      support: "M136 160q6 2 12 0",
      activity: "M141 126q4 2 8 0",
      answers: "M147 154q4 2 8 0",
    }[k];
    const f = gsap
      .timeline({ paused: true, repeat: -1, defaults: { ease: "sine.inOut" } })
      .to(m, { attr: { d: purse }, duration: 1.1 }, 1.2)
      .to(m, { attr: { d: base }, duration: 1.2 }, 3.4)
      .to({}, { duration: 1 }, 5);
    eyes.forEach((e) => {
      gsap.set(e, { svgOrigin: `${e.getAttribute("cx")} ${e.getAttribute("cy")}` });
      f.to(e, { scaleY: 0.1, duration: 0.12 }, 2.3).to(e, { scaleY: 1, duration: 0.2 }, 2.42);
    });
    f.time(i * 1.37);
    faces.push(f);
  });
  const packageEl = $("#package"),
    deckEl = scene.querySelector(".deck"),
    briefEl = scene.querySelector(".brief"),
    sheetEl = scene.querySelector(".worksheet"),
    pendingEl = scene.querySelector(".pending-slide");
  for (const el of [sheetEl, pendingEl]) {
    const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.before(holder);
    holder.append(el);
  }
  const questionPaths = ["M-21-27H20", "M-21-15H14", "M-21-3H18"];
  sheetEl.innerHTML = `<path class="sheet-outline" fill="#faf5df"/>${questionPaths.map((d, i) => `<path class="question-line" data-line="${i}" d="${d}"/>`).join("")}<path class="answer-lines"/><path class="creases" d="M-31 9l4 5-4 5M31 9l-4 5 4 5"/>`;
  const questionNodes = [...sheetEl.querySelectorAll(".question-line")],
    questionLengths = questionNodes.map((e) => e.getTotalLength());
  questionNodes.forEach((e, i) => {
    e.style.strokeDasharray = questionLengths[i];
  });
  scene.insertBefore($("#comparison"), packageEl);
  scene.insertBefore($("#limbs"), $("#comparison"));
  const rearLimbs = document.createElementNS("http://www.w3.org/2000/svg", "g");
  rearLimbs.id = `${prefix}rear-limbs`;
  scene.insertBefore(rearLimbs, $("#people"));
  scene.insertBefore($("#fingers"), $("#spark"));
  const armPaths = actors.map((_, i) => [...scene.querySelectorAll(`[data-limbs="${i}"] path`)]);
  const rearPaths = armPaths.map((paths) =>
    paths.map((path) => {
      const copy = path.cloneNode();
      copy.style.visibility = "hidden";
      rearLimbs.append(copy);
      return copy;
    }),
  );
  function materialPoint(x, y, kind) {
    const sx = kind === "sheet" ? p.sx : p.px,
      sy = kind === "sheet" ? p.sy : p.py,
      angle = ((kind === "sheet" ? p.sr : p.pr) * Math.PI) / 180;
    return point(
      sx + x * Math.cos(angle) - y * Math.sin(angle),
      sy + x * Math.sin(angle) + y * Math.cos(angle),
    );
  }
  function layer(child, front) {
    const el = child.parentElement;
    if (el.dataset.front === String(front)) return;
    el.dataset.front = String(front);
    el.removeAttribute("clip-path");
    if (front) {
      if (el.previousElementSibling !== deckEl) packageEl.insertBefore(el, deckEl.nextSibling);
    } else {
      el.setAttribute("clip-path", `url(#${prefix}stack-occlusion)`);
      if (el.nextElementSibling !== briefEl) packageEl.insertBefore(el, briefEl);
    }
  }
  const slideInk = scene.querySelector(".slide-ink"),
    slideLength = slideInk.getTotalLength();
  slideInk.style.strokeDasharray = slideLength;
  // Resting life is drawn: a breath that swells each body from its planted base and random
  // blinks. No whole-body bob or sway, and no screen shake (that is Slides' landing only).
  let calm = 1,
    calmTarget = 1,
    clock = 0;
  const lifeNow = actors.map(() => ({ breath: 0, lag: 0, blink: 0 }));
  const dust = [...scene.querySelectorAll(`#${prefix}dust ellipse`)];
  const dustState = { at: -9, x: 320, size: 1 };
  function puff(x, size = 1) {
    Object.assign(dustState, { at: clock, x, size });
  }
  // Anime accent: short strokes fanned up and out from a contact (never down across the copy).
  const accentLines = [...scene.querySelectorAll(`#${prefix}accent path`)];
  const accentState = { at: -9, x: 0, y: 0, size: 1, ground: false };
  // A ground burst fans out to both sides of the feet, clear of the body; a point burst fans up.
  const GROUND = [-172, -152, -28, -8];
  function accent(x, y, size = 1, ground = false) {
    Object.assign(accentState, { at: clock, x, y, size, ground });
  }
  function paintAccent() {
    const u = (clock - accentState.at) / 0.24;
    accentLines.forEach((e, i) => {
      if (u < 0 || u >= 1 || (accentState.ground && i >= GROUND.length)) {
        if (e.style.visibility !== "hidden") e.style.visibility = "hidden";
        return;
      }
      e.style.visibility = "";
      const g = accentState.ground,
        ang = ((g ? GROUND[i] : -160 + i * 35) * Math.PI) / 180,
        k = accentState.size,
        grow = 1 - (1 - u) ** 3,
        r0 = (g ? 52 + 18 * grow : 9 + 16 * grow) * k,
        r1 = r0 + (9 * (1 - u) + 2) * k;
      const { x, y } = accentState;
      e.setAttribute(
        "d",
        `M${(x + Math.cos(ang) * r0).toFixed(1)} ${(y + Math.sin(ang) * r0).toFixed(1)}L${(x + Math.cos(ang) * r1).toFixed(1)} ${(y + Math.sin(ang) * r1).toFixed(1)}`,
      );
    });
  }
  function paintFx() {
    paintAccent();
    const u = (clock - dustState.at) / 0.5;
    dust.forEach((e, i) => {
      if (u < 0 || u >= 1) {
        if (e.style.visibility !== "hidden") e.style.visibility = "hidden";
        return;
      }
      const side = i % 2 ? 1 : -1,
        far = i > 1 ? 1.6 : 1;
      e.style.visibility = "";
      const ease = 1 - (1 - u) ** 2;
      e.setAttribute("cx", String(dustState.x + side * (38 + 30 * far * ease) * dustState.size));
      e.setAttribute("cy", String(303 - 7 * ease * far));
      e.setAttribute("rx", String((4 + 7 * ease) * dustState.size));
      e.setAttribute("ry", String((2 + 3.5 * ease) * dustState.size));
      e.style.opacity = String(0.9 * (1 - u));
    });
  }
  function ambientTick(_time, delta) {
    if (paused || document.hidden || reduced || !onScreen) return;
    const dt = Math.min(delta / 1000, 0.05);
    calm += (calmTarget - calm) * (1 - Math.exp(-dt * 2));
    clock += dt;
    actors.forEach((a, i) => {
      const gate = i === 1 ? p.ambientGate : 1;
      lifeNow[i] = a.alpha > 0.5 ? lives[i].step(dt, gate) : lifeNow[i];
    });
    // Only the breath and blinks are changing: 20 paints a second is smooth for a 4 s breath.
    const acting =
      tl?.isActive() ||
      reaction?.isActive() ||
      blend ||
      settling ||
      fan.t.isActive() ||
      castRunning() ||
      clock - accentState.at < 0.3 ||
      clock - dustState.at < 0.5;
    if (!acting && clock - lastPaint < 0.05) return;
    lastPaint = clock;
    const t0 = performance.now();
    draw();
    const spent = performance.now() - t0;
    cost.n++;
    cost.total += spent;
    cost.max = Math.max(cost.max, spent);
  }
  let lastPaint = -1;
  const cost = { n: 0, total: 0, max: 0 };
  gsap.ticker.add(ambientTick);
  // Read-only view for the filmstrip and trace tooling.
  root.__cast = {
    /** The time every timeline runs on (gsap's ticker, lag-smoothed), for the trace tooling. */
    get time() {
      return gsap.ticker.time;
    },
    get tool() {
      return { toolAt, tipAt, toolHand, contact: p.contact, stroke: p.stroke };
    },
    actors,
    p,
    lifeNow,
    cost,
    get drawn() {
      return drawn;
    },
    get clock() {
      return clock;
    },
  };

  function point(x, y) {
    const r = (p.r * Math.PI) / 180;
    return {
      x: p.x + x * Math.cos(r) - y * Math.sin(r),
      y: p.y + x * Math.sin(r) + y * Math.cos(r),
    };
  }
  // Draw runs every frame: its nodes are looked up once.
  const qCache = new Map();
  const q = (selector, within = scene) => {
    let byRoot = qCache.get(within);
    if (!byRoot) {
      byRoot = new Map();
      qCache.set(within, byRoot);
    }
    let el = byRoot.get(selector);
    if (!el) {
      el = within.querySelector(selector);
      byRoot.set(selector, el);
    }
    return el;
  };
  let lastBrief = "";
  const handLag = actors.map(() => [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
  let lagClock = 0;
  // Blending (ANIMATION-PROCESS §5, §7): a new beat, a settle or a reset never cuts. The pose on
  // screen when it starts is kept as an offset from the new beat's opening pose, and the offset
  // eases to nothing (a cosine, so it starts and ends at rest). Chained changes blend from what is
  // on screen, blend included.
  const BLEND_P = Object.keys(p).filter((k) => !DISCRETE.has(k));
  let blend = null;
  const composed = actors.map(() => restBody());
  const blendWeight = () => {
    if (!blend || blend.at === null) return 0;
    const u = Math.min(1, (clock - blend.at) / blend.dur);
    return 0.5 * (1 + Math.cos(Math.PI * u));
  };
  /** The pose as it is drawn now: model, reaction layer and any blend offset. */
  function drawnPose() {
    const w = blendWeight(),
      off = blend?.offsets;
    const state = { p: {}, actors: [] };
    for (const k of BLEND_P) state.p[k] = p[k] + (off?.p[k] ?? 0) * w;
    actors.forEach((a, i) => {
      const o = off?.actors[i];
      const b = {};
      for (const k of BODY) b[k] = a.b[k] + a.r[k] + (o?.b[k] ?? 0) * w;
      state.actors.push({ shown: a.alpha > 0.5, x: a.x + (o?.x ?? 0) * w, b });
    });
    return state;
  }
  function beginBlend(dur = 0.32) {
    if (reduced) {
      blend = null;
      return;
    }
    // A change before the last one has drawn keeps the pose that is really on screen.
    if (blend && blend.at === null) blend.dur = dur;
    else blend = { old: drawnPose(), dur, at: null, offsets: null };
  }
  function startBlend() {
    const old = blend.old;
    blend.offsets = null;
    const now = drawnPose();
    const offsets = { p: {}, actors: [] };
    for (const k of BLEND_P) {
      const d = old.p[k] - now.p[k];
      if (Math.abs(d) > 1e-6) offsets.p[k] = d;
    }
    now.actors.forEach((a, i) => {
      const was = old.actors[i];
      const o = { x: 0, b: {} };
      if (a.shown && was.shown) {
        o.x = was.x - a.x;
        for (const k of BODY) o.b[k] = was.b[k] - a.b[k];
      }
      offsets.actors.push(o);
    });
    blend.offsets = offsets;
    blend.hands = null;
    blend.at = clock;
  }
  // The smooth base: every drawn value follows the choreography through a critically damped
  // spring (about 80 ms behind), so a cut, a kink or a change of hold never reaches the screen as a
  // jump. It advances only with the clock, and it is bypassed under reduced motion.
  const OMEGA = 24;
  const springs = new Map();
  let springClock = 0,
    springDt = 0,
    settling = false;
  function follow(key, target, fresh) {
    let s = springs.get(key);
    if (!s || fresh || reduced) {
      s = { y: target, v: 0 };
      springs.set(key, s);
      return target;
    }
    if (springDt > 0) {
      const x = s.y - target,
        e = Math.exp(-OMEGA * springDt),
        k = (s.v + OMEGA * x) * springDt;
      s.y = target + (x + k) * e;
      s.v = (s.v - OMEGA * k) * e;
    }
    if (Math.abs(s.v) > 1e-3 || Math.abs(s.y - target) > 1e-3) settling = true;
    return s.y;
  }
  const lastHands = actors.map(() => [null, null]);
  function smoothHand(i, j, target, vis) {
    const fresh = !vis || !lastHands[i][j];
    // A hand whose owner or grip changed with the beat blends from where it was drawn.
    if (blend?.at != null && !fresh) {
      blend.hands ??= {};
      const key = `${i}${j}`;
      if (!(key in blend.hands))
        blend.hands[key] = { x: lastHands[i][j].x - target.x, y: lastHands[i][j].y - target.y };
      const o = blend.hands[key],
        w = blendWeight();
      target = { x: target.x + o.x * w, y: target.y + o.y * w };
    }
    const out = {
      x: follow(`h${i}${j}x`, target.x, fresh),
      y: follow(`h${i}${j}y`, target.y, fresh),
    };
    lastHands[i][j] = vis ? out : null;
    return out;
  }
  const wasShown = actors.map((a) => a.alpha > 0.5);
  // What was last put on screen, for the trace tooling.
  const drawn = { actors: [], p: {} };
  // The pen and its strokes keep their own eased clocks: a spring would lag the pen off the page.
  const STROKE_CLOCKS = new Set(["q0", "q1", "q2", "penX", "penY"]);
  let lastContact = 0;
  function draw() {
    springDt = Math.max(0, Math.min(0.05, clock - springClock));
    springClock = clock;
    if (springDt > 0) settling = false;
    if (blend && blend.at === null) {
      // Hold the last drawing until the new beat has rendered its opening frame.
      if (tl && !reduced && !tl.paused() && tl.totalTime() === 0) return;
      startBlend();
    }
    const w = blendWeight(),
      off = blend?.offsets;
    if (blend && w === 0) blend = null;
    const savedP = {};
    if (off && w)
      for (const k in off.p) {
        savedP[k] = p[k];
        p[k] += off.p[k] * w;
      }
    const beats = actors.map((a, i) => {
      const o = off && w ? off.actors[i] : null;
      const c = composed[i];
      for (const k of BODY) c[k] = a.b[k] + a.r[k] + a.c[k] + (o?.b[k] ?? 0) * w;
      c.shut = Math.min(1, Math.max(0, c.shut));
      const x = a.x;
      if (o) a.x += o.x * w;
      const b = a.b;
      a.b = c;
      return { b, x };
    });
    // The pen is on the page while it draws: the stroke is its own clock (linear), so it is never
    // smoothed, and the pen's hover springs restart from the stroke on every touch and lift.
    if (p.contact !== lastContact) {
      lastContact = p.contact;
      springs.delete("p.penX");
      springs.delete("p.penY");
    }
    for (const k of BLEND_P) {
      if (!(k in savedP)) savedP[k] = p[k];
      // The deck rides in with Slides' entrance at Slides' own (unsprung) pace.
      if (STROKE_CLOCKS.has(k) || (current === 12 && k === "x")) continue;
      p[k] = follow(`p.${k}`, p[k], false);
    }
    // Plan's check-through, drawn on the plan it holds: lifted and tipped toward its eyes to read,
    // the pages riffled (the fold flutters), then set back down. (Restored with the rest of p.)
    if (ownerOf() === 0) {
      const cf = castFx[0];
      if (cf.lift || cf.riffle) {
        for (const k of ["y", "r", "fold"]) if (!(k in savedP)) savedP[k] = p[k];
        p.y -= 22 * cf.lift;
        p.r -= 9 * cf.lift;
        p.fold = Math.max(0, p.fold - 0.4 * Math.abs(cf.riffle));
      }
    }
    actors.forEach((a, i) => {
      const shown = a.alpha > 0.5,
        fresh = !shown || !wasShown[i];
      wasShown[i] = shown;
      // Travel is choreographed accel-limited (work-beats.js), so x is drawn as timed: a spring
      // here would start from rest behind a character entering at speed and kink its arrival.
      void fresh;
      const c = a.b;
      for (const k of BODY) c[k] = follow(`b${i}${k}`, c[k], fresh);
      drawn.actors[i] = {
        x: a.x,
        lean: c.lean,
        th: c.th,
        ty: c.ty,
        sy: c.sy,
        sx: c.sx,
        shown: a.alpha > 0.5,
      };
    });
    drawn.p = { x: p.x, y: p.y };
    try {
      paint();
    } finally {
      actors.forEach((a, i) => {
        a.b = beats[i].b;
        a.x = beats[i].x;
      });
      for (const k in savedP) p[k] = savedP[k];
    }
  }
  let toolHand = null;
  const toolAt = { x: 0, y: 0 },
    tipAt = { x: 0, y: 0 };
  function paint() {
    toolHand = null;
    root.dataset.beat = String(current);
    root.dataset.holder = names[ownerOf()];

    paintFx();
    actors.forEach((a, i) => {
      const shown = a.alpha > 0.5;
      if (shown) {
        const life = lifeNow[i];
        const breath = { breath: life.breath * calm, lag: life.lag * calm, blink: life.blink };
        if (i === 1) {
          fan.b = a.b;
          fan.life = breath;
          fan.paint();
        } else bodies[i].paint(a.b, breath);
      }
      const owner = ownerOf(),
        passing = [2, 5, 8].includes(current);
      const target = passing ? (i === owner ? actors[receiverOf()].x : actors[owner].x) : p.x;
      const gazeX = passing
        ? Math.max(-3, Math.min(3, (target - a.x) * 0.024)) * p.gazeMix
        : p.look + castFx[i].look;
      const gazeY =
        (passing ? 1 + 0.7 * p.gazeMix : 1) +
        castFx[i].lookY * 0.7 +
        (i === ownerOf() ? p.gazeY : 0);
      if (i !== 1) q(".gaze", figures[i]).setAttribute("transform", `translate(${gazeX} ${gazeY})`);
      else if (!fanMode)
        q(".face", fanSVG).setAttribute("transform", `translate(${gazeX + 0.125} ${gazeY - 1})`);
      // Characters are never faded: they walk in and out through the stage's soft edge and are
      // hidden only while off stage. One shadow each, shrinking and fading with height.
      const vis = shown ? "" : "hidden";
      if (figures[i].style.visibility !== vis) figures[i].style.visibility = vis;
      const shadow = q(`[data-shadow="${i}"]`);
      const height = Math.min(1, Math.max(0, -a.b.ty * (i === 1 ? 1.2 : 0.85)) / 110);
      shadow.setAttribute("cx", a.x);
      shadow.setAttribute("rx", String(67 * (1 - 0.55 * height) * (0.9 + 0.1 * a.b.sx)));
      shadow.style.opacity = String(0.12 * (1 - 0.6 * height));
      shadow.style.visibility = vis;
      if (i === 1) figures[i].setAttribute("transform", `translate(${a.x - 240} 0)`);
      else
        q(".figure", figures[i]).setAttribute(
          "transform",
          `translate(${a.x - 127.5} 65) scale(.85)`,
        );
    });
    fanHands.forEach((e) => {
      e.style.display = fanMode ? "" : "none";
    });
    $("#package").style.opacity = fanMode || current === 11 ? 0 : 1;
    $("#package").setAttribute(
      "transform",
      `translate(${p.x} ${p.y + 28 * p.compare}) rotate(${p.r})`,
    );
    const width = 74 + 90 * p.fold,
      h = 26.5,
      seg = width / 3;
    const briefMarkup = `<path d="M${-width / 2} ${-h}l${seg} ${-7 * p.fold} ${seg} ${7 * p.fold} ${seg} ${-7 * p.fold}v53l${-seg} ${7 * p.fold} ${-seg} ${-7 * p.fold} ${-seg} ${7 * p.fold}Z" fill="${worksheetSource ? "#faf5df" : "#d6e2bd"}"/><path d="M${-seg / 2} ${-h - 7 * p.fold}v53M${seg / 2} ${-h}v53" opacity="${p.fold}"/><path d="M${-width * 0.38} -10h${width * 0.22}M${-width * 0.38} 2h${width * 0.2}M${width * 0.08} -9h${width * 0.24}M${width * 0.08} 4h${width * 0.2}"/>`;
    // Rewriting markup is costly: only when the brief's shape changed.
    // Lying on the floor (Plan's brief before it is picked up): the sheet projected flat about its
    // foot, a prop view, never the characters.
    const lie = Math.max(0, Math.min(1, p.lie));
    const lieT = lie
      ? `matrix(1 0 ${(-0.45 * lie).toFixed(3)} ${(1 - 0.84 * lie).toFixed(3)} ${(12 * lie).toFixed(2)} ${(26.5 * 0.84 * lie).toFixed(2)})`
      : "";
    if ((briefEl.getAttribute("transform") ?? "") !== lieT) {
      if (lieT) briefEl.setAttribute("transform", lieT);
      else briefEl.removeAttribute("transform");
    }
    if (briefMarkup !== lastBrief) {
      lastBrief = briefMarkup;
      briefEl.innerHTML = briefMarkup;
    }
    q(".brief").style.opacity = 1 - p.deck + p.deck * p.stackGap;
    q(".slide-sun").style.opacity = p.ink;
    slideInk.style.fillOpacity = p.ink;
    q(".deck").style.opacity = p.deck;
    scene
      .querySelector(".back-a")
      .setAttribute(
        "transform",
        `translate(${-2 * p.stackGap} ${4 * p.stackGap}) rotate(${-p.spread} 0 23)`,
      );
    scene
      .querySelector(".back-b")
      .setAttribute(
        "transform",
        `translate(${2 * p.stackGap} ${2 * p.stackGap}) rotate(${p.spread} 0 23)`,
      );
    slideInk.style.strokeDashoffset = slideLength * (1 - Math.min(1, p.ink));
    const eh = 30 * p.extend;
    layer(sheetEl, p.sheetFront > 0.5);
    layer(pendingEl, p.paperFront > 0.5);
    sheetEl.style.visibility = p.sheet ? "visible" : "hidden";
    sheetEl.style.opacity = 1;
    sheetEl.setAttribute("transform", `translate(${p.sx} ${p.sy}) rotate(${p.sr})`);
    sheetEl.querySelector(".sheet-outline").setAttribute("d", `M-31-38h62v${60 + eh}h-62Z`);
    questionNodes.forEach((e, i) => {
      e.style.strokeDashoffset = questionLengths[i] * (1 - p[`q${i}`]);
    });
    sheetEl
      .querySelector(".answer-lines")
      .setAttribute("d", `M-25 9H25M-25 ${16 + eh * 0.5}H25M-25 ${21 + eh}H25`);
    sheetEl.querySelector(".answer-lines").style.opacity = p.extend;
    sheetEl.querySelector(".creases").style.opacity = p.extend;
    pendingEl.style.visibility = p.pending ? "visible" : "hidden";
    pendingEl.style.opacity = 1;
    pendingEl.setAttribute("transform", `translate(${p.px} ${p.py}) rotate(${p.pr})`);
    q(".magic-window").setAttribute("width", 74.4 * p.magic);
    q(".reserve").setAttribute("transform", "translate(-2 5)");
    // Planning: Plan reads the brief alone; the spare slide paper belongs to Slides' work.
    const readingNow = current >= 13 && current <= 17;
    if (q(".reserve").style.visibility !== (readingNow ? "hidden" : ""))
      q(".reserve").style.visibility = readingNow ? "hidden" : "";
    if (p.tool === 1) {
      let tip = { x: p.penX, y: p.penY };
      if (p.contact && p.stroke >= 0)
        tip = questionNodes[p.stroke].getPointAtLength(
          questionLengths[p.stroke] * p[`q${p.stroke}`],
        );
      const world = materialPoint(tip.x, tip.y, "sheet");
      p.rx = world.x;
      p.ry = world.y;
      tipAt.x = world.x;
      tipAt.y = world.y;
    }
    if (p.gesture && p.pending) {
      const hand = materialPoint(
        33 + (-37.2 + 74.4 * p.magic - 33) * p.sweep,
        12 * (1 - p.sweep),
        "slide",
      );
      p.rx = hand.x;
      p.ry = hand.y;
    }
    q(".approved").style.opacity = p.seal;
    $("#comparison").style.opacity = 1;
    $("#comparison").style.visibility = [9, 10].includes(current) ? "visible" : "hidden";
    scene.querySelectorAll(".compare-page").forEach((e, i) => {
      e.setAttribute(
        "transform",
        `translate(${p.x + (i ? 95 : -95) * p.compare} ${p.y - 26 * p.compare}) rotate(${(i ? 5 : -5) * p.compare})`,
      );
    });
    const owner = ownerOf(),
      transfer = [2, 5, 8].includes(current),
      receiver = receiverOf();
    // The hands' lag advances only when the clock does (draw can run twice in one frame).
    const lagDt = clock - lagClock;
    lagClock = clock;
    const lagK = 1 - Math.exp(-Math.max(0, lagDt) / 0.07);
    actors.forEach((a, i) => {
      const limbs = q(`[data-limbs="${i}"]`),
        fingers = q(`[data-fingers="${i}"]`),
        vis = a.alpha > 0.5 && !(i === 1 && fanMode) ? 1 : 0;
      limbs.style.visibility = vis ? "" : "hidden";
      fingers.style.visibility = vis ? "" : "hidden";
      const shoulders =
        i === 1
          ? [-1, 1].map((side) => {
              const path = q(side < 0 ? ".arm.left" : ".arm.right", fanSVG);
              const at = path.getPointAtLength(0);
              return { x: a.x - 240 + at.x * 1.2, y: at.y * 1.2 };
            })
          : sh[keys[i]].map(([x0, y0]) => {
              const [x, y] = bodies[i].map(x0, y0);
              return { x: a.x - 127.5 + x * 0.85, y: 65 + y * 0.85 };
            });
      // Rest hands hang from the drawn shoulders, so they ride every hop, squash and lean, and
      // trail the shoulders by about 70 ms (follow-through); they land exactly on rest.
      const rest0 = restShoulders[i];
      const hang = (j) => {
        const tx = rest0 ? shoulders[j].x - a.x - rest0[j].x : 0,
          ty = rest0 ? shoulders[j].y - rest0[j].y : 0,
          s = handLag[i][j];
        if (reduced || lagDt > 0.2 || !vis) Object.assign(s, { x: tx, y: ty });
        else if (lagDt > 0) {
          s.x += (tx - s.x) * lagK;
          s.y += (ty - s.y) * lagK;
          if (Math.abs(tx - s.x) < 0.05 && Math.abs(ty - s.y) < 0.05)
            Object.assign(s, { x: tx, y: ty });
        }
        return { x: s.x, y: s.y };
      };
      const dl = hang(0),
        dr = hang(1);
      let left = { x: a.x - 84 + dl.x, y: 255 + dl.y },
        right = { x: a.x + 86 + dr.x, y: 253 + dr.y };
      const deckGrip = p.gripShape,
        hx = width / 2 + (33.6 - width / 2) * deckGrip,
        hy = 15 - 9 * deckGrip;
      if (i === owner) {
        left = point(-hx, hy);
        right = point(hx, 12 - 6 * deckGrip);
        if (i === 0 && p.hold < 1) {
          // Plan's hands are free until it picks up the brief: where the artwork has them (arm
          // ends (17, 151) and (281, 148) at 0.85), so the hand-over from its entrance does not
          // move them.
          const free = [
            { x: a.x - 113 + dl.x, y: 193.4 + dl.y },
            { x: a.x + 111.4 + dr.x, y: 190.8 + dr.y },
          ];
          const h = Math.max(0, p.hold);
          left = {
            x: free[0].x + (left.x - free[0].x) * h,
            y: free[0].y + (left.y - free[0].y) * h,
          };
          right = {
            x: free[1].x + (right.x - free[1].x) * h,
            y: free[1].y + (right.y - free[1].y) * h,
          };
        }
        if (p.compare > 0) {
          const contact = (side) => {
            const a = (side * 5 * p.compare * Math.PI) / 180;
            return {
              x: p.x + side * 95 * p.compare + side * 33.6 * Math.cos(a) - 6 * Math.sin(a),
              y: p.y - 26 * p.compare + side * 33.6 * Math.sin(a) + 6 * Math.cos(a),
            };
          };
          const l = contact(-1),
            r = contact(1);
          left = l;
          right = r;
        }
        if (p.sheet && i === 2 && ![8].includes(current)) {
          const anchor = materialPoint(-31, 12, "sheet"),
            edge = materialPoint(29, -25, "sheet");
          left = {
            x: left.x + (anchor.x - left.x) * p.sheetGrip,
            y: left.y + (anchor.y - left.y) * p.sheetGrip,
          };
          right = {
            x: right.x + (edge.x - right.x) * p.extractGrip,
            y: right.y + (edge.y - right.y) * p.extractGrip,
          };
        }
        if (p.gesture > 0.001) {
          const handX = p.rx + (p.tool === 1 ? 5 : 0),
            handY = p.ry - (p.tool === 1 ? 11 : p.tool === 2 ? 17 * p.toolAlpha : 0);
          right = {
            x: right.x + (handX - right.x) * p.gesture,
            y: right.y + (handY - right.y) * p.gesture,
          };
        }

        if (transfer) {
          const resting = { x: a.x + 86 + dr.x, y: 253 + dr.y },
            outerRelease = Math.max(p.outerRelease, p.offer);
          left = {
            x: left.x + (a.x - 84 + dl.x - left.x) * outerRelease,
            y: left.y + (255 + dl.y - left.y) * outerRelease,
          };
          right = {
            x: right.x + (resting.x - right.x) * p.offer,
            y: right.y + (resting.y - right.y) * p.offer,
          };
        }
      }
      if (transfer && i === receiver) {
        const spacing = 7 * (1 - p.offer);
        const target = point(-hx + spacing, hy + spacing * 0.3),
          other = point(hx - spacing, 12 - 6 * deckGrip + spacing * 0.3);
        left = {
          x: left.x + (target.x - left.x) * p.grip,
          y: left.y + (target.y - left.y) * p.grip,
        };
        right = {
          x: right.x + (other.x - right.x) * p.grip * p.offer,
          y: right.y + (other.y - right.y) * p.grip * p.offer,
        };
      }
      if (current === 11) {
        left = { x: a.x - 84 + dl.x, y: 255 + dl.y };
        right = { x: a.x + 86 + dr.x, y: 253 + dr.y - (i === owner ? 36 * p.gesture : 0) };
      }
      // The cast clip's hands ride on whatever the beat has them doing.
      const cf = castFx[i];
      left = { x: left.x + cf.hlx, y: left.y + cf.hly };
      right = { x: right.x + cf.hrx, y: right.y + cf.hry };
      if (i === 3 && cf.reach > 0) {
        // Check's push: the hand really arrives on the bridge of its glasses (wherever they have
        // slipped to), a fingertip's width under it, and rides them back up.
        const [bx, by] = bodies[3].map(146.5, 130.5 + a.b.slip + 9);
        const bridge = { x: a.x - 127.5 + bx * 0.85, y: 65 + by * 0.85 };
        right = {
          x: right.x + (bridge.x - right.x) * cf.reach,
          y: right.y + (bridge.y - right.y) * cf.reach,
        };
      }
      // A hand driving a tool or the reveal is locked to it: no spring between the hand, the tool
      // and the stroke it is drawing (0 px drift). The lock fades in with the gesture.
      const lock = i === owner && (p.tool || p.pending) ? Math.max(0, Math.min(1, p.gesture)) : 0;
      for (const [j, target] of [
        [0, left],
        [1, right],
      ]) {
        const h = smoothHand(i, j, target, vis);
        if (j === 1 && lock > 0) {
          h.x += (target.x - h.x) * lock;
          h.y += (target.y - h.y) * lock;
        }
        if (j === 1 && i === owner) toolHand = vis ? { x: h.x, y: h.y } : null;
        const sh = shoulders[j],
          arm = armPaths[i][j],
          depth = transfer
            ? i === owner && j === 0
              ? p.outerRelease
              : i === receiver && j === 1
                ? // The taker's far arm reaches round behind its body until the carry's stop,
                  // so it never draws across the page; it comes in front on that contact cut.
                  1 - p.carryFront
                : 0
            : 0;
        // Front or behind the body: a layer switch, never a cross-fade.
        const behind = depth > 0.5;
        arm.style.visibility = vis && !behind ? "" : "hidden";
        rearPaths[i][j].style.visibility = vis && behind ? "" : "hidden";
        arm.setAttribute(
          "d",
          `M${sh.x} ${sh.y}Q${(sh.x + h.x) / 2 + (j ? 1 : -1) * (i === 1 ? 21.6 : 10)} ${Math.max(sh.y, h.y) + (i === 1 ? 30 : 20)} ${h.x} ${h.y}`,
        );
        rearPaths[i][j].setAttribute("d", arm.getAttribute("d"));
        const finger = q(j ? ".finger-r" : ".finger-l", fingers);
        // A hand reaching round behind the body is hidden with its arm.
        // Free hands (before Plan takes the brief) are the artwork's plain arm ends: no fingers.
        finger.style.visibility = behind || (i === owner && p.hold < 0.5) ? "hidden" : "";
        finger.setAttribute(
          "d",
          i === 1
            ? `M${h.x + (j ? 3.6 : -3.6)} ${h.y - 4.8}q${j ? -8.4 : 8.4} -2.4 ${j ? -7.2 : 7.2} 4.8q0 6 ${j ? 6 : -6} 4.8`
            : `M${h.x} ${h.y - 3}q${j ? -5 : 5} -1 ${j ? -5 : 5} 3q0 4 ${j ? 4 : -4} 3`,
        );
      }
    });
    $("#tool").style.opacity = p.tool ? p.toolAlpha : 0;
    // The tool is drawn from the hand that holds it, so the two can never separate. A cast clip may
    // toss it (twirl-and-catch): it spins about the grip and is caught back on the same point.
    const cfo = castFx[ownerOf()];
    const tx = toolHand ? toolHand.x - (p.tool === 1 ? 5 : 0) : p.rx,
      ty = toolHand ? toolHand.y + (p.tool === 1 ? 11 : p.tool === 2 ? 17 * p.toolAlpha : 0) : p.ry;
    toolAt.x = tx;
    toolAt.y = ty + cfo.penToss;
    $("#tool").setAttribute(
      "transform",
      `translate(${tx.toFixed(2)} ${(ty + cfo.penToss).toFixed(2)}) rotate(${cfo.penRot.toFixed(1)} 5 -11)`,
    );
    q(".pencil").style.display = p.tool === 1 ? "" : "none";
    q(".stamp").style.display = p.tool === 2 ? "" : "none";
    $("#spark").style.opacity = p.spark;
    $("#spark").setAttribute("transform", `translate(${p.rx} ${p.ry}) scale(${p.spark})`);
  }
  function canonical(beat) {
    // Slides' entrance starts from beat 3's work state, with Slides and its deck still off stage.
    const entering = beat === 12,
      reading = beat >= 13 && beat <= 17,
      n = entering ? 3 : reading ? 0 : beat;
    fanMode = false;
    Object.assign(p, {
      x: 320,
      y: 251,
      r: 0,
      fold: 0,
      deck: n >= 3 ? 1 : 0,
      sheet: n >= 6 ? 1 : 0,
      extend: 0,
      ink: 1,
      questions: n >= 7 ? 1 : 0,
      spread: 0,
      compare: 0,
      seal: 0,
      tool: 0,
      rx: 357,
      ry: 251,
      gesture: 0,
      spark: 0,
      offer: 0,
      grip: 0,
      look: 0,
      toolAlpha: 0,
      pending: 0,
      pendingY: -25,
      stackGap: 1,
      px: 0,
      py: 4,
      pr: 0,
      paperFront: 0,
      magic: 0,
      sx: 0,
      sy: 18,
      sr: 0,
      sheetFront: 0,
      q0: 0,
      q1: 0,
      q2: 0,
      stroke: -1,
      penX: -21,
      penY: -27,
      contact: 0,
      sweep: 0,
      sheetGrip: 0,
      extractGrip: 0,
      gazeMix: 0,
      gripShape: 0,
      ambientGate: 1,
      outerRelease: 0,
      carryFront: 0,
    });
    actors.forEach((a, i) => {
      Object.assign(a, {
        x: i === beats[n][1] ? 320 : 760,
        alpha: i === beats[n][1] ? 1 : 0,
      });
      // In place: a reaction running beside the beat keeps drawing on the same pose.
      Object.assign(a.b, restBody());
    });
    if (entering) {
      Object.assign(actors[1], { x: 760, alpha: 0 });
      p.x = 760;
    }
    if (n >= 3) {
      p.stackGap = 0;
      p.gripShape = n === 3 ? 0 : 1;
    }
    if (n === 1) p.fold = 1;
    if (n === 3) {
      p.deck = 0;
      p.ink = 0;
    }
    if (n === 6) {
      p.sheet = 0;
      p.ink = 1;
      p.questions = 0;
    }
    if (n >= 7) {
      p.ink = 1;
      p.sheetFront = 1;
      p.sheetGrip = 1;
      p.sy = 0;
      p.q0 = p.q1 = p.q2 = 1;
    }
    if (n === 6) {
      p.sheet = 0;
      p.sy = 18;
    }
    Object.assign(p, { hold: 1, lie: 0, gazeY: 0 });
    // Reading: the brief as a small sheet at reading height; before the pick-up it lies at Plan's feet.
    if (reading) Object.assign(p, { fold: 0.3, y: 238 });
    if (beat === 13) Object.assign(p, { x: 404, y: 290, r: 0, hold: 0, lie: 1 });
    fan.t.pause(0);
  }

  // Cast clips (baked from new/_shared/cast/*.js, context "creation"): each character's own
  // persona beat, laid on its cast layer so it never fights the work beat underneath.
  const castRuns = new Map();
  const castRunning = () => [...castRuns.values()].some((t) => t.isActive());
  const CAST_BODY = new Set(BODY);
  function clearCast(i) {
    castRuns.get(i)?.kill();
    castRuns.delete(i);
    Object.assign(actors[i].c, zeroBody());
    Object.assign(castFx[i], {
      look: 0,
      hlx: 0,
      hly: 0,
      hrx: 0,
      hry: 0,
      penRot: 0,
      penToss: 0,
      lift: 0,
      riffle: 0,
      lookY: 0,
      reach: 0,
    });
  }
  function playCast(i, id, { hands = 1, onCatch, onRelease, onDone } = {}) {
    const clip = CAST_CLIPS[id];
    if (!clip || reduced) {
      onDone?.();
      return;
    }
    clearCast(i);
    const a = actors[i],
      fx = castFx[i],
      last = Object.values(clip.f)[0].length - 1;
    const time = { t: 0 };
    let airborne = false,
      reached = false;
    const apply = () => {
      const x = Math.min(last, (time.t / 1000) * clip.hz),
        i0 = Math.floor(x),
        u = x - i0,
        i1 = Math.min(last, i0 + 1);
      for (const [k, s] of Object.entries(clip.f)) {
        const v = s[i0] + (s[i1] - s[i0]) * u;
        if (CAST_BODY.has(k)) a.c[k] = v;
        else fx[k] = k.startsWith("h") ? v * hands : v;
      }
      // A reach that has arrived and starts back: the contact's release (Check's push-up).
      if (fx.reach > 0.9) reached = true;
      else if (reached && fx.reach < 0.6) {
        reached = false;
        onRelease?.();
      }
      if (fx.penToss < -4) airborne = true;
      else if (airborne && fx.penToss > -0.5) {
        airborne = false;
        onCatch?.();
      }
    };
    const run = gsap.to(time, {
      t: clip.ms,
      duration: clip.ms / 1000,
      ease: "none",
      onUpdate: () => {
        apply();
        draw();
      },
      onComplete: () => {
        clearCast(i);
        draw();
        onDone?.();
      },
    });
    if (paused) run.pause();
    castRuns.set(i, run);
  }
  /** An entrance from off stage has nothing on screen to blend from (or spring from). */
  function fresh(n) {
    if (n !== 12) return;
    blend = null;
    springs.clear();
  }
  function play(n, options = {}) {
    beginBlend();
    fresh(n);
    tl?.kill();
    handoff = options.handoff ?? null;
    current = n;
    worksheetSource = n === 3 && options.withWorksheet === true;
    if (options.reset !== false) canonical(n);
    if (options.withWorksheet === false) p.sheet = 0;
    if (handoff) {
      actors.forEach((actor, i) => {
        Object.assign(actor, {
          x: i === handoff.from ? 320 : 760,
          alpha: i === handoff.from ? 1 : 0,
        });
        Object.assign(actor.b, restBody());
      });
    }
    p.gesture = 0;
    p.tool = 0;
    p.toolAlpha = 0;
    p.offer = 0;
    p.grip = 0;
    p.outerRelease = 0;
    p.carryFront = 0;
    p.spark = 0;
    fanMode = false;
    fan.t.pause(0);
    loops[n] = (loops[n] ?? -1) + 1;
    tl = buildBeat(
      {
        p,
        actors,
        fan,
        questionNodes,
        questionLengths,
        draw,
        from: ownerOf(),
        to: receiverOf(),
        setFanMode(value) {
          fanMode = value;
        },
        puff,
        clipMs: (id) => CAST_CLIPS[id]?.ms,
        cast: playCast,
        /** An accent at a point of the prop, in its own coordinates. */
        accentAt(kind, x, y, size) {
          const at =
            kind === "hand"
              ? { ...toolAt }
              : kind === "glasses"
                ? (() => {
                    const [gx, gy] = bodies[3].map(168, 118 + actors[3].b.slip);
                    return { x: actors[3].x - 127.5 + gx * 0.85, y: 65 + gy * 0.85 };
                  })()
                : kind === "scene" || kind === "ground"
                  ? { x, y }
                  : materialPoint(x, y, kind);
          accent(at.x, at.y, size, kind === "ground");
        },
        loops: loops[n],
        onComplete: options.onComplete,
      },
      n,
      gsap,
    );
    // Handovers are charted in real time; gestures take the persona's tempo.
    // A hurried sign-off (the lesson is already ready) runs the pass a little quicker.
    tl.timeScale(
      // Handovers always run at charted time: their travel is accel-limited at 1x.
      [2, 5, 8, 11].includes(n) ? 1 : (options.speed ?? 1.2),
    );
    if (reduced) {
      tl.pause();
      canonical(n);
      draw();
    } else {
      tl.play();
      faces.forEach((face) => {
        face.play();
      });
    }
    draw();
  }
  const queued = [];
  const loops = {};
  draw();
  function pause(value) {
    paused = value;
    [tl, ...faces, ...castRuns.values()].forEach((t) => {
      if (value) t?.pause();
      else t?.play();
    });
  }
  function settle(n) {
    if (reduced) springs.clear();
    beginBlend();
    fresh(n);
    tl?.kill();
    reaction?.kill();
    reaction = null;
    queued.length = 0;
    for (const a of actors) Object.assign(a.r, zeroBody());
    actors.forEach((_, i) => {
      clearCast(i);
    });
    handoff = null;
    current = n;
    canonical(n);
    draw();
  }
  const visibility = () => pause(document.hidden || reduced);
  document.addEventListener("visibilitychange", visibility);
  // Reduced motion switched on mid-animation: stop the beat and show the exact rest pose now.
  const onReduce = () => {
    reduced = pref.matches;
    if (reduced) {
      blend = null;
      tl?.pause();
      dustState.at = -9;
      // Mid-entrance, Slides is already the one at work: settle it on its mark (beat 3).
      settle(handoff ? ([0, 3, 7, 9][handoff.to] ?? current) : current === 12 ? 3 : current);
    }
  };
  pref.addEventListener("change", onReduce);
  // Off screen, nothing paints.
  const seen = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting) || entries[entries.length - 1].isIntersecting;
  });
  seen.observe(root);
  return {
    play,
    snapshot(active) {
      // A teacher can move on before the preceding handover finishes. Carry only
      // the current screen's character, never its outgoing predecessor.
      const state = { ...p };
      let beat = current;
      if (handoff) {
        beat = [0, 3, 7, 9][active];
        Object.assign(state, {
          x: actors[active].x,
          fold: 0,
          offer: 0,
          grip: 0,
          outerRelease: 0,
          gesture: 0,
          tool: 0,
          toolAlpha: 0,
          compare: 0,
          deck: active === 1 ? 1 : 0,
          sheet: active === 2 ? 1 : 0,
          sx: 0,
          sy: 0,
          sheetGrip: 1,
        });
      }
      const offsetX = actors[active].x - 320;
      const drawn = drawnPose();
      state.x -= offsetX;
      return {
        beat,
        offsetX,
        state,
        actors: actors.map((actor, index) => ({
          ...actor,
          b: drawn.actors[index].b,
          r: undefined,
          x: index === active ? 320 : actor.x,
          alpha: index === active ? 1 : 0,
        })),
      };
    },
    restore(pose) {
      tl?.kill();
      blend = null;
      springs.clear();
      current = pose.beat;
      handoff = null;
      Object.assign(p, pose.state);
      actors.forEach((actor, i) => {
        Object.assign(actor, pose.actors[i], {
          b: { ...(pose.actors[i].b ?? restBody()) },
          r: zeroBody(),
        });
      });
      draw();
    },
    settle,
    pause,
    /**
     * Where a character's rest artwork sits on the page (px), so an entrance drawn by the cast's own
     * engine (entrances/) can play exactly there and hand over to the rig without a jump.
     */
    restBox() {
      const m = scene.getScreenCTM();
      if (!m) return null;
      // The figures' artwork at 0.85 from (x - 127.5, 65), in scene units; the rig's own ground
      // shadow (cx 320, cy 305, rx 67, ry 5, 12 %), so the entrance layer's matches it.
      const [x, y, w] = [320 - 127.5, 65, 255];
      const shadow = {
        left: m.e + 253 * m.a,
        top: m.f + 300 * m.d,
        width: 134 * m.a,
        height: 10 * m.d,
      };
      return { left: m.e + x * m.a, top: m.f + y * m.d, width: w * m.a, height: w * m.d, shadow };
    },
    /** Hide or show a character (its entrance is being drawn elsewhere). Never faded. */
    present(i, shown) {
      actors[i].alpha = shown ? 1 : 0;
      if (shown) actors[i].x = 320;
      draw();
    },
    /** Resting between gestures: ease the sway down to a breath. */
    calm(value) {
      calmTarget = value ? 0.45 : 1;
    },
    get reduced() {
      return reduced;
    },
    /** A persona reaction on the current holder: "nod", "leap" (flight), "leave" (exit). */
    react(name, options = {}) {
      if (reduced) {
        options.onComplete?.();
        return;
      }
      // Gestures queue: a reaction never cuts into one that is still playing.
      if (reaction?.isActive()) {
        queued.push(() => this.react(name, options));
        return;
      }
      // Reactions run beside the current gesture (they move only the body), except the exit.
      if (name === "leave") {
        tl?.kill();
        handoff = null;
      }
      reaction = buildReaction(
        {
          p,
          actors,
          draw,
          puff,
          // Mid-pass, the reaction belongs to the character taking over.
          owner: handoff ? handoff.to : ownerOf(),
          onComplete: () => {
            options.onComplete?.();
            queued.shift()?.();
          },
        },
        name,
        options,
        gsap,
      );
      reaction.play();
    },
    dispose() {
      tl?.kill();
      for (const t of castRuns.values()) t.kill();
      reaction?.kill();
      faces.forEach((face) => {
        face.kill();
      });
      fan.t.kill();
      fan.face.kill();
      gsap.ticker.remove(ambientTick);
      document.removeEventListener("visibilitychange", visibility);
      pref.removeEventListener("change", onReduce);
      seen.disconnect();
      root.replaceChildren();
    },
  };
}
