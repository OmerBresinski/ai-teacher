import { artwork } from "./artwork.js";
import { drawnBody, restBody, restingLife } from "./body-draw.js";
import { fanRig } from "./fan-rig.js";
import { buildBeat, buildReaction } from "./work-beats.js";

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
  const beats = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 2].map((owner) => ["", owner]);
  const ownerOf = () => handoff?.from ?? beats[current][1];
  const receiverOf = () => handoff?.to ?? ownerOf() + 1;
  const actors = names.map((_, i) => ({
    x: i === 0 ? 320 : 760,
    alpha: i === 0 ? 1 : 0,
    b: restBody(),
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
  root.innerHTML = `<svg class="production-scene" viewBox="80 45 480 280" aria-hidden="true"><g class="ground-shadows">${actors.map((_, i) => `<ellipse data-shadow="${i}" cx="320" cy="305" rx="67" ry="5" fill="#293b32" opacity=".12" stroke="none"/>`).join("")}</g><g id="dust" stroke="#9aa590" stroke-width="1.6" fill="none">${[0, 1, 2, 3].map(() => "<ellipse/>").join("")}</g><g id="people">${keys.map((k, i) => (i === 1 ? `<g class="person" data-actor="1">${fanRig.markup()}</g>` : `<g class="person" data-actor="${i}"><g class="figure">${parsed[k]}</g></g>`)).join("")}</g><g id="package"><defs><clipPath id="stack-occlusion"><rect x="-200" y="-200" width="400" height="226.4"/></clipPath><clipPath id="magic-reveal"><rect class="magic-window" x="-37.2" y="-26.4" width="0" height="52.8"/></clipPath></defs><g class="reserve">${paper("#faf5df")}</g><g class="brief"></g><g class="deck" stroke-width="2.4"><g class="leaf back-a">${paper("#d6e2bd")}</g><g class="leaf back-b">${paper("#f5c054")}</g><g class="leaf front">${paper("#faf5df")}<path class="slide-ink" d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52"/><circle class="slide-sun" cx="19.2" cy="-12" r="4.8" fill="#f5c054"/></g></g><g class="worksheet"></g><g class="pending-slide" stroke-width="2.4">${paper("#faf5df")}<g clip-path="url(#magic-reveal)"><path d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52" stroke-width="2.4"/><circle cx="19.2" cy="-12" r="4.8" fill="#f5c054" stroke-width="2.4"/></g></g><g class="approved"><circle r="16" fill="#faf5df"/><path d="m-8 0 5 5 11-13"/></g></g><g id="comparison">${[0, 1].map((i) => `<g class="compare-page" data-page="${i}">${paper("#faf5df")}<path d="M-23-14H20M-23-4H12M-23 9H19"/><path d="${i ? "m5 16 4 4 8-10" : "M-21 18H-4"}" stroke="#9b704b"/></g>`).join("")}</g><g id="limbs">${actors.map((_, i) => `<g data-limbs="${i}"><path class="arm-l"/><path class="arm-r"/></g>`).join("")}</g><g id="fingers">${actors.map((_, i) => `<g data-fingers="${i}"><path class="finger-l"/><path class="finger-r"/></g>`).join("")}</g><g id="tool"><g class="pencil"><path d="M0 0 4-20 10-17Z" fill="#e88f52"/></g><g class="stamp"><path d="M-12 0H12V-7H-12ZM-4-7v-17h8v17" fill="#e88f52"/></g></g><g id="spark"><path d="M0-7V7M-7 0H7M-4-4 4 4M4-4-4 4" stroke="#ba8d3a"/></g></svg>`;
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
  // blinks. No whole-body bob or sway. The shake moves the stage, only from a contact.
  let calm = 1,
    calmTarget = 1,
    clock = 0;
  const lifeNow = actors.map(() => ({ breath: 0, lag: 0, blink: 0 }));
  const shakes = [];
  function shake(amp, dur) {
    shakes.push({ at: clock, amp, dur });
  }
  const dust = [...scene.querySelectorAll(`#${prefix}dust ellipse`)];
  const dustState = { at: -9, x: 320, size: 1 };
  function puff(x, size = 1) {
    Object.assign(dustState, { at: clock, x, size });
  }
  function paintFx() {
    let dx = 0,
      dy = 0;
    for (let i = shakes.length - 1; i >= 0; i--) {
      const s = shakes[i],
        u = (clock - s.at) / s.dur;
      if (u >= 1) {
        shakes.splice(i, 1);
        continue;
      }
      // Steps at 30 Hz, decaying linearly.
      const step = Math.floor((clock - s.at) * 30);
      const amp = s.amp * (1 - u) * 0.7;
      dx += (step % 2 ? -1 : 1) * amp * 0.8;
      dy += (step % 3 === 1 ? -1 : 1) * amp * 0.5;
    }
    const shift = dx || dy ? `translate(${dx.toFixed(1)} ${dy.toFixed(1)})` : "";
    if (scene.getAttribute("data-shift") !== shift) {
      scene.setAttribute("data-shift", shift);
      $("#people").setAttribute("transform", shift);
    }
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
      tl?.isActive() || reaction?.isActive() || shakes.length || clock - dustState.at < 0.5;
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
  root.__cast = { actors, p, lifeNow, cost };

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
  function draw() {
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
        : p.look;
      const gazeY = passing ? 1 + 0.7 * p.gazeMix : 1;
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
    if (p.tool === 1) {
      let tip = { x: p.penX, y: p.penY };
      if (p.contact && p.stroke >= 0)
        tip = questionNodes[p.stroke].getPointAtLength(
          questionLengths[p.stroke] * p[`q${p.stroke}`],
        );
      const world = materialPoint(tip.x, tip.y, "sheet");
      p.rx = world.x;
      p.ry = world.y;
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
      for (const [j, h] of [
        [0, left],
        [1, right],
      ]) {
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
        finger.style.visibility = behind ? "hidden" : "";
        finger.setAttribute(
          "d",
          i === 1
            ? `M${h.x + (j ? 3.6 : -3.6)} ${h.y - 4.8}q${j ? -8.4 : 8.4} -2.4 ${j ? -7.2 : 7.2} 4.8q0 6 ${j ? 6 : -6} 4.8`
            : `M${h.x} ${h.y - 3}q${j ? -5 : 5} -1 ${j ? -5 : 5} 3q0 4 ${j ? 4 : -4} 3`,
        );
      }
    });
    $("#tool").style.opacity = p.tool ? p.toolAlpha : 0;
    $("#tool").setAttribute("transform", `translate(${p.rx} ${p.ry})`);
    q(".pencil").style.display = p.tool === 1 ? "" : "none";
    q(".stamp").style.display = p.tool === 2 ? "" : "none";
    $("#spark").style.opacity = p.spark;
    $("#spark").setAttribute("transform", `translate(${p.rx} ${p.ry}) scale(${p.spark})`);
  }
  function canonical(n) {
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
    fan.t.pause(0);
  }

  function play(n, options = {}) {
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
        shake,
        puff,
        onComplete: options.onComplete,
      },
      n,
      gsap,
    );
    // Handovers are charted in real time; gestures take the persona's tempo.
    // A hurried sign-off (the lesson is already ready) runs the pass a little quicker.
    tl.timeScale(
      [2, 5, 8, 11].includes(n) ? ((options.speed ?? 1) >= 1.6 ? 1.3 : 1) : (options.speed ?? 1.2),
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
  function pause(value) {
    paused = value;
    [tl, ...faces].forEach((t) => {
      if (value) t?.pause();
      else t?.play();
    });
  }
  function settle(n) {
    tl?.kill();
    reaction?.kill();
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
      tl?.pause();
      shakes.length = 0;
      dustState.at = -9;
      settle(handoff ? ([0, 3, 7, 9][handoff.to] ?? current) : current);
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
      state.x -= offsetX;
      return {
        beat,
        offsetX,
        state,
        actors: actors.map((actor, index) => ({
          ...actor,
          b: { ...actor.b },
          x: index === active ? 320 : actor.x,
          alpha: index === active ? 1 : 0,
        })),
      };
    },
    restore(pose) {
      tl?.kill();
      current = pose.beat;
      handoff = null;
      Object.assign(p, pose.state);
      actors.forEach((actor, i) => {
        Object.assign(actor, pose.actors[i], { b: { ...(pose.actors[i].b ?? restBody()) } });
      });
      draw();
    },
    settle,
    pause,
    /** Resting between gestures: ease the sway down to a breath. */
    calm(value) {
      calmTarget = value ? 0.45 : 1;
    },
    get reduced() {
      return reduced;
    },
    /** A persona reaction on the current holder: "nod", "leap" (flight), "leave" (exit). */
    react(name, options = {}) {
      reaction?.kill();
      if (reduced) {
        options.onComplete?.();
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
          shake,
          puff,
          // Mid-pass, the reaction belongs to the character taking over.
          owner: handoff ? handoff.to : ownerOf(),
          onComplete: options.onComplete,
        },
        name,
        options,
        gsap,
      );
      reaction.play();
    },
    dispose() {
      tl?.kill();
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
