import { gsap } from "gsap";
import { artwork } from "./artwork.js";
import { fanRig } from "./fan-rig.js";
import { buildBeat } from "./work-beats.js";

// Original production rig: scoped geometry/contacts only. No demo UI, readiness, or global controller.
let serial = 0;
export function createHandoverRig(root) {
  const prefix = `intake-rig-${serial++}-`;
  const $ = (selector) =>
    root.querySelector(selector.replace(/#([\w-]+)/g, (_, id) => `#${prefix}${id}`));
  const pref = matchMedia("(prefers-reduced-motion: reduce)");
  let current = 0,
    paused = false,
    complete = false,
    fanMode = false,
    worksheetSource = false,
    tl = null,
    handoff = null;
  const names = ["Plan", "Slides", "Worksheet", "Check"],
    keys = ["support", "slides", "activity", "answers"];
  const beats = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 2].map((owner) => ["", owner]);
  const ownerOf = () => handoff?.from ?? beats[current][1];
  const receiverOf = () => handoff?.to ?? ownerOf() + 1;
  const actors = names.map((_, i) => ({ x: i === 0 ? 320 : 760, alpha: i === 0 ? 1 : 0 }));
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
  root.innerHTML = `<svg class="production-scene" viewBox="80 45 480 280" aria-hidden="true"><g class="ground-shadows">${actors.map((_, i) => `<ellipse data-shadow="${i}" cx="320" cy="305" rx="67" ry="5" fill="#293b32" opacity=".12" stroke="none"/>`).join("")}</g><g id="people">${keys.map((k, i) => (i === 1 ? `<g class="person" data-actor="1">${fanRig.markup()}</g>` : `<g class="person" data-actor="${i}"><g class="figure">${parsed[k]}</g></g>`)).join("")}</g><g id="package"><defs><clipPath id="stack-occlusion"><rect x="-200" y="-200" width="400" height="226.4"/></clipPath><clipPath id="magic-reveal"><rect class="magic-window" x="-37.2" y="-26.4" width="0" height="52.8"/></clipPath></defs><g class="reserve">${paper("#faf5df")}</g><g class="brief"></g><g class="deck" stroke-width="2.4"><g class="leaf back-a">${paper("#d6e2bd")}</g><g class="leaf back-b">${paper("#f5c054")}</g><g class="leaf front">${paper("#faf5df")}<path class="slide-ink" d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52"/><circle class="slide-sun" cx="19.2" cy="-12" r="4.8" fill="#f5c054"/></g></g><g class="worksheet"></g><g class="pending-slide" stroke-width="2.4">${paper("#faf5df")}<g clip-path="url(#magic-reveal)"><path d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52" stroke-width="2.4"/><circle cx="19.2" cy="-12" r="4.8" fill="#f5c054" stroke-width="2.4"/></g></g><g class="approved"><circle r="16" fill="#faf5df"/><path d="m-8 0 5 5 11-13"/></g></g><g id="comparison">${[0, 1].map((i) => `<g class="compare-page" data-page="${i}">${paper("#faf5df")}<path d="M-23-14H20M-23-4H12M-23 9H19"/><path d="${i ? "m5 16 4 4 8-10" : "M-21 18H-4"}" stroke="#9b704b"/></g>`).join("")}</g><g id="limbs">${actors.map((_, i) => `<g data-limbs="${i}"><path class="arm-l"/><path class="arm-r"/></g>`).join("")}</g><g id="fingers">${actors.map((_, i) => `<g data-fingers="${i}"><path class="finger-l"/><path class="finger-r"/></g>`).join("")}</g><g id="tool"><g class="pencil"><path d="M0 0 4-20 10-17Z" fill="#e88f52"/></g><g class="stamp"><path d="M-12 0H12V-7H-12ZM-4-7v-17h8v17" fill="#e88f52"/></g></g><g id="spark"><path d="M0-7V7M-7 0H7M-4-4 4 4M4-4-4 4" stroke="#ba8d3a"/></g></svg>`;
  root.innerHTML = root.innerHTML
    .replace(/id="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`);
  const scene = $(".production-scene"),
    fanSVG = scene.querySelector('[data-actor="1"] svg');
  fanSVG.setAttribute("width", "504");
  fanSVG.setAttribute("height", "360");
  const fan = fanRig.mount(fanSVG);
  fanSVG.querySelectorAll(":scope > path,:scope > ellipse").forEach((e) => {
    if (!e.classList.contains("legs")) e.style.display = "none";
  });
  const fanHands = [...fanSVG.querySelectorAll(".arm,.fingers,.held")];
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
  keys.forEach((k, i) => {
    if (i === 1) {
      faces.push(fan.face);
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
      copy.style.opacity = 0;
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
  // Ambient motion changes the torso/shoulders, not the paper contact points.
  // Feet remain planted; the arm curves absorb small shifts while working.
  const motion = { intensity: 1.65, breathing: 1.2, sway: 1.25, tempo: 1.25 },
    motionTarget = { ...motion };
  let ambientTime = 0,
    ambientFocus = 1;
  const ambientPose = actors.map(() => ({ r: 0, y: 0 }));
  const torsoWrappers = figures.map((figure, _i) => {
    const body = figure.querySelector(".body"),
      g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "ambient-torso");
    body.before(g);
    g.append(body);
    return g;
  });
  const rhythms = [
    { period: 5.9, phase: 0.4, weight: 0.7 },
    { period: 4.2, phase: 2.1, weight: 1 },
    { period: 5.1, phase: 4.2, weight: 0.65 },
    { period: 6.7, phase: 1.3, weight: 0.8 },
  ];
  function paintAmbient() {
    actors.forEach((_a, i) => {
      const rhythm = rhythms[i],
        phase = (ambientTime * 2 * Math.PI) / rhythm.period + rhythm.phase;
      const amount = pref.matches ? 0 : motion.intensity * ambientFocus * p.ambientGate;
      // Two unequal waves avoid an obvious left/right metronome.
      const r =
        amount *
        motion.sway *
        rhythm.weight *
        (0.62 * Math.sin(phase) + 0.18 * Math.sin(phase * 0.61 + 1.4));
      const y = amount * motion.breathing * 1.3 * Math.sin(phase * 1.17 + 0.6);
      ambientPose[i] = { r, y };
      const scale = i === 1 ? 1.2 : 0.85,
        cx = i === 1 ? 200 : 150,
        cy = i === 1 ? 237.5 : (285 - 65) / 0.85;
      torsoWrappers[i].setAttribute(
        "transform",
        `translate(${cx} ${cy}) rotate(${r}) translate(${-cx} ${-cy + y / scale})`,
      );
    });
  }
  function ambientJoint(pt, i) {
    const a = ambientPose[i],
      r = (a.r * Math.PI) / 180,
      x = pt.x - actors[i].x,
      y = pt.y + a.y - 285;
    return {
      x: actors[i].x + x * Math.cos(r) - y * Math.sin(r),
      y: 285 + x * Math.sin(r) + y * Math.cos(r),
    };
  }
  function ambientTick(_time, delta) {
    if (paused || document.hidden || pref.matches) return;
    const dt = Math.min(delta / 1000, 0.05),
      blend = 1 - Math.exp(-dt * 7);
    Object.keys(motion).forEach((k) => {
      motion[k] += (motionTarget[k] - motion[k]) * blend;
    });
    // Keep both personalities alive during a pass; only soften the shared hold.
    const sharedHold = [2, 5, 8].includes(current) ? p.grip * (1 - p.offer) : 0;
    const focus = complete
      ? 0.28
      : [2, 5, 8].includes(current)
        ? 1 - 0.18 * sharedHold
        : p.contact || p.tool === 2
          ? 0.32
          : 1;
    ambientFocus += (focus - ambientFocus) * blend;
    ambientTime += dt * motion.tempo;
    draw();
  }
  gsap.ticker.add(ambientTick);

  function point(x, y) {
    const r = (p.r * Math.PI) / 180;
    return {
      x: p.x + x * Math.cos(r) - y * Math.sin(r),
      y: p.y + x * Math.sin(r) + y * Math.cos(r),
    };
  }
  function draw() {
    root.dataset.beat = String(current);
    root.dataset.holder = names[ownerOf()];

    paintAmbient();
    actors.forEach((a, i) => {
      const owner = ownerOf(),
        passing = [2, 5, 8].includes(current);
      const target = passing ? (i === owner ? actors[receiverOf()].x : actors[owner].x) : p.x;
      const gazeX = passing
        ? Math.max(-3, Math.min(3, (target - a.x) * 0.024)) * p.gazeMix
        : p.look;
      const gazeY = passing ? 1 + 0.7 * p.gazeMix : 1;
      if (i !== 1)
        figures[i].querySelector(".gaze").setAttribute("transform", `translate(${gazeX} ${gazeY})`);
      else if (!fanMode)
        fanSVG
          .querySelector(".face")
          .setAttribute("transform", `translate(${gazeX + 0.125} ${gazeY - 1})`);
      figures[i].style.opacity = a.alpha;
      const shadow = scene.querySelector(`[data-shadow="${i}"]`);
      shadow.setAttribute("cx", a.x);
      shadow.style.opacity = a.alpha * 0.12;
      if (i === 1) figures[i].setAttribute("transform", `translate(${a.x - 240} 0)`);
      else
        figures[i]
          .querySelector(".figure")
          .setAttribute("transform", `translate(${a.x - 127.5} 65) scale(.85)`);
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
    scene.querySelector(".brief").innerHTML =
      `<path d="M${-width / 2} ${-h}l${seg} ${-7 * p.fold} ${seg} ${7 * p.fold} ${seg} ${-7 * p.fold}v53l${-seg} ${7 * p.fold} ${-seg} ${-7 * p.fold} ${-seg} ${7 * p.fold}Z" fill="${worksheetSource ? "#faf5df" : "#d6e2bd"}"/><path d="M${-seg / 2} ${-h - 7 * p.fold}v53M${seg / 2} ${-h}v53" opacity="${p.fold}"/><path d="M${-width * 0.38} -10h${width * 0.22}M${-width * 0.38} 2h${width * 0.2}M${width * 0.08} -9h${width * 0.24}M${width * 0.08} 4h${width * 0.2}"/>`;
    scene.querySelector(".brief").style.opacity = 1 - p.deck + p.deck * p.stackGap;
    scene.querySelector(".slide-sun").style.opacity = p.ink;
    slideInk.style.fillOpacity = p.ink;
    scene.querySelector(".deck").style.opacity = p.deck;
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
    scene.querySelector(".magic-window").setAttribute("width", 74.4 * p.magic);
    scene.querySelector(".reserve").setAttribute("transform", "translate(-2 5)");
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
    scene.querySelector(".approved").style.opacity = p.seal;
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
    actors.forEach((a, i) => {
      const limbs = scene.querySelector(`[data-limbs="${i}"]`),
        fingers = scene.querySelector(`[data-fingers="${i}"]`),
        vis = a.alpha * (i === 1 && fanMode ? 0 : 1);
      limbs.style.opacity = 1;
      fingers.style.opacity = vis;
      const shoulders =
        i === 1
          ? [-1, 1].map((side) => {
              const path = fanSVG.querySelector(side < 0 ? ".arm.left" : ".arm.right");
              const at = path.getPointAtLength(0);
              return { x: a.x - 240 + at.x * 1.2, y: at.y * 1.2 };
            })
          : sh[keys[i]].map(([x, y]) => ({ x: a.x - 127.5 + x * 0.85, y: 65 + y * 0.85 }));
      shoulders.forEach((pt, j) => {
        shoulders[j] = ambientJoint(pt, i);
      });
      let left = { x: a.x - 84, y: 255 },
        right = { x: a.x + 86, y: 253 };
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
          const resting = { x: a.x + 86, y: 253 },
            outerRelease = Math.max(p.outerRelease, p.offer);
          left = {
            x: left.x + (a.x - 84 - left.x) * outerRelease,
            y: left.y + (255 - left.y) * outerRelease,
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
        left = { x: a.x - 84, y: 255 };
        right = { x: a.x + 86, y: 253 - (i === owner ? 36 * p.gesture : 0) };
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
                ? 1 - p.offer
                : 0
            : 0;
        arm.style.opacity = vis * (1 - depth);
        rearPaths[i][j].style.opacity = vis * depth;
        arm.setAttribute(
          "d",
          `M${sh.x} ${sh.y}Q${(sh.x + h.x) / 2 + (j ? 1 : -1) * (i === 1 ? 21.6 : 10)} ${Math.max(sh.y, h.y) + (i === 1 ? 30 : 20)} ${h.x} ${h.y}`,
        );
        rearPaths[i][j].setAttribute("d", arm.getAttribute("d"));
        fingers
          .querySelector(j ? ".finger-r" : ".finger-l")
          .setAttribute(
            "d",
            i === 1
              ? `M${h.x + (j ? 3.6 : -3.6)} ${h.y - 4.8}q${j ? -8.4 : 8.4} -2.4 ${j ? -7.2 : 7.2} 4.8q0 6 ${j ? 6 : -6} 4.8`
              : `M${h.x} ${h.y - 3}q${j ? -5 : 5} -1 ${j ? -5 : 5} 3q0 4 ${j ? 4 : -4} 3`,
          );
      }
    });
    $("#tool").style.opacity = p.tool ? p.toolAlpha : 0;
    $("#tool").setAttribute("transform", `translate(${p.rx} ${p.ry})`);
    scene.querySelector(".pencil").style.display = p.tool === 1 ? "" : "none";
    scene.querySelector(".stamp").style.display = p.tool === 2 ? "" : "none";
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
    });
    actors.forEach((a, i) => {
      Object.assign(a, { x: i === beats[n][1] ? 320 : 760, alpha: i === beats[n][1] ? 1 : 0 });
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
      });
    }
    p.gesture = 0;
    p.tool = 0;
    p.toolAlpha = 0;
    p.offer = 0;
    p.grip = 0;
    p.outerRelease = 0;
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
        onComplete: options.onComplete,
      },
      n,
    );
    tl.timeScale(options.speed ?? 1.2);
    if (pref.matches) {
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
    handoff = null;
    current = n;
    canonical(n);
    if (pref.matches)
      faces.forEach((face) => {
        face.pause();
      });
    draw();
  }
  const visibility = () => pause(document.hidden || pref.matches);
  document.addEventListener("visibilitychange", visibility);
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
        Object.assign(actor, pose.actors[i]);
      });
      draw();
    },
    settle,
    pause,
    get reduced() {
      return pref.matches;
    },
    dispose() {
      tl?.kill();
      faces.forEach((face) => {
        face.kill();
      });
      fan.t.kill();
      fan.face.kill();
      gsap.ticker.remove(ambientTick);
      document.removeEventListener("visibilitychange", visibility);
      root.replaceChildren();
    },
  };
}
