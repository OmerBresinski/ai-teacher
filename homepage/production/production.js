(() => {
  const names = ["Plan", "Slides", "Worksheet", "Answers"],
    keys = ["support", "slides", "activity", "answers"];
  const beats = [
    ["Unfold the idea", 0, "Plan opens the lesson into a short, readable outline."],
    ["Read, then fold", 0, "Read across the brief, then fold it ready to pass on."],
    ["Over to Slides", 0, "Slides takes the brief before Plan lets go."],
    ["A little magic", 1, "A sweep of the hands brings the slides into being."],
    ["Fan. Check. Square.", 1, "The original centred fan, inspection and squaring action."],
    ["Over to Worksheet", 1, "The squared deck passes into Worksheet’s hands."],
    ["Write the questions", 2, "Pull out a worksheet and write the questions."],
    ["Unfold room to think", 2, "Pull open the answer spaces, then gather the page with the deck."],
    ["Over to Answers", 2, "The slides and worksheets travel together."],
    ["Compare the pair", 3, "Look between the question and its answer, then bring them together."],
    ["A little seal", 3, "One final stamp. The whole lesson is ready."],
  ];
  const $ = (s) => document.querySelector(s),
    pref = matchMedia("(prefers-reduced-motion: reduce)");
  let current = 0,
    paused = false,
    loop = false,
    complete = false,
    tl,
    fanMode = false,
    stageClock = null,
    waiting = false,
    pace = "normal",
    reducedTimer = null;
  const gates = [0, 3, 6, 9],
    ready = [false, false, false, false],
    durations = { normal: [5, 7, 6, 6], long: [20, 26, 24, 18] };
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
    const d = new DOMParser().parseFromString(window.characters[k], "image/svg+xml");
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
  $("#cast").innerHTML = names
    .map(
      (n, i) =>
        `<button data-person="${i}" aria-current="${i === 0}">${window.characters[keys[i]]}<span><strong>${n}</strong><small>Waiting</small></span></button>`,
    )
    .join("");
  $("#beats").innerHTML = beats
    .map(
      (b, i) =>
        `<button data-beat="${i}" aria-current="${i === 0}">${String(i + 1).padStart(2, "0")} · ${b[0]}</button>`,
    )
    .join("");
  const paper = (fill) =>
    `<rect x="-37.2" y="-26.4" width="74.4" height="52.8" rx="2.4" fill="${fill}"/>`;
  $("#scene").innerHTML =
    `<svg class="production-scene" viewBox="0 0 640 360" aria-hidden="true"><path d="M50 303H590" stroke="#becbb8"/><g id="people">${keys.map((k, i) => (i === 1 ? `<g class="person" data-actor="1">${window.GatherFanRig.markup()}</g>` : `<g class="person" data-actor="${i}"><g class="figure">${parsed[k]}</g></g>`)).join("")}</g><g id="package"><defs><clipPath id="stack-occlusion"><rect x="-200" y="-200" width="400" height="226.4"/></clipPath><clipPath id="magic-reveal"><rect class="magic-window" x="-37.2" y="-26.4" width="0" height="52.8"/></clipPath></defs><g class="reserve">${paper("#faf5df")}</g><g class="brief"></g><g class="deck" stroke-width="2.4"><g class="leaf back-a">${paper("#d6e2bd")}</g><g class="leaf back-b">${paper("#f5c054")}</g><g class="leaf front">${paper("#faf5df")}<path class="slide-ink" d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52"/><circle class="slide-sun" cx="19.2" cy="-12" r="4.8" fill="#f5c054"/></g></g><g class="worksheet"></g><g class="pending-slide" stroke-width="2.4">${paper("#faf5df")}<g clip-path="url(#magic-reveal)"><path d="M-24 12-9.6-3.6 3.6 7.2 16.8-9.6 27.6 12Z" fill="#e88f52" stroke-width="2.4"/><circle cx="19.2" cy="-12" r="4.8" fill="#f5c054" stroke-width="2.4"/></g></g><g class="approved"><circle r="16" fill="#faf5df"/><path d="m-8 0 5 5 11-13"/></g></g><g id="comparison">${[0, 1].map((i) => `<g class="compare-page" data-page="${i}">${paper("#faf5df")}<path d="M-23-14H20M-23-4H12M-23 9H19"/><path d="${i ? "m5 16 4 4 8-10" : "M-21 18H-4"}" stroke="#9b704b"/></g>`).join("")}</g><g id="limbs">${actors.map((_, i) => `<g data-limbs="${i}"><path class="arm-l"/><path class="arm-r"/></g>`).join("")}</g><g id="fingers">${actors.map((_, i) => `<g data-fingers="${i}"><path class="finger-l"/><path class="finger-r"/></g>`).join("")}</g><g id="tool"><g class="pencil"><path d="M0 0 4-20 10-17Z" fill="#e88f52"/></g><g class="stamp"><path d="M-12 0H12V-7H-12ZM-4-7v-17h8v17" fill="#e88f52"/></g></g><g id="spark"><path d="M0-7V7M-7 0H7M-4-4 4 4M4-4-4 4" stroke="#ba8d3a"/></g></svg>`;
  const scene = $(".production-scene"),
    fanSVG = scene.querySelector('[data-actor="1"] svg');
  fanSVG.setAttribute("width", "504");
  fanSVG.setAttribute("height", "360");
  const fan = window.GatherFanRig.mount(fanSVG);
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
  rearLimbs.id = "rear-limbs";
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
      el.setAttribute("clip-path", "url(#stack-occlusion)");
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
  window.addEventListener("pagehide", () => gsap.ticker.remove(ambientTick));
  function point(x, y) {
    const r = (p.r * Math.PI) / 180;
    return {
      x: p.x + x * Math.cos(r) - y * Math.sin(r),
      y: p.y + x * Math.sin(r) + y * Math.cos(r),
    };
  }
  function draw() {
    paintAmbient();
    actors.forEach((a, i) => {
      const owner = beats[current][1],
        passing = [2, 5, 8].includes(current);
      const target = passing ? (i === owner ? actors[owner + 1].x : actors[owner].x) : p.x;
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
      if (i === 1) figures[i].setAttribute("transform", `translate(${a.x - 240} 0)`);
      else
        figures[i]
          .querySelector(".figure")
          .setAttribute("transform", `translate(${a.x - 127.5} 65) scale(.85)`);
    });
    fanHands.forEach((e) => {
      e.style.display = fanMode ? "" : "none";
    });
    $("#package").style.opacity = fanMode ? 0 : 1;
    $("#package").setAttribute(
      "transform",
      `translate(${p.x} ${p.y + 28 * p.compare}) rotate(${p.r})`,
    );
    const width = 74 + 90 * p.fold,
      h = 26.5,
      seg = width / 3;
    scene.querySelector(".brief").innerHTML =
      `<path d="M${-width / 2} ${-h}l${seg} ${-7 * p.fold} ${seg} ${7 * p.fold} ${seg} ${-7 * p.fold}v53l${-seg} ${7 * p.fold} ${-seg} ${-7 * p.fold} ${-seg} ${7 * p.fold}Z" fill="#d6e2bd"/><path d="M${-seg / 2} ${-h - 7 * p.fold}v53M${seg / 2} ${-h}v53" opacity="${p.fold}"/><path d="M${-width * 0.38} -10h${width * 0.22}M${-width * 0.38} 2h${width * 0.2}M${width * 0.08} -9h${width * 0.24}M${width * 0.08} 4h${width * 0.2}"/>`;
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
    $("#comparison").style.visibility = current >= 9 ? "visible" : "hidden";
    scene.querySelectorAll(".compare-page").forEach((e, i) => {
      e.setAttribute(
        "transform",
        `translate(${p.x + (i ? 95 : -95) * p.compare} ${p.y - 26 * p.compare}) rotate(${(i ? 5 : -5) * p.compare})`,
      );
    });
    const owner = beats[current][1],
      transfer = [2, 5, 8].includes(current),
      receiver = owner + 1;
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
  function build(n, reset = false) {
    reducedTimer?.kill();
    tl?.kill();
    waiting = false;
    current = n;
    complete = false;
    if (reset) canonical(n);
    p.gesture = 0;
    p.tool = 0;
    p.toolAlpha = 0;
    p.offer = 0;
    p.grip = 0;
    p.outerRelease = 0;
    p.spark = 0;
    fanMode = false;
    fan.t.pause(0);
    $("#title").textContent = beats[n][0];
    $("#step").textContent =
      `${[2, 5, 8].includes(n) ? "Hand to hand" : names[beats[n][1]]} · ${String(n + 1).padStart(2, "0")} / 11`;
    $("#description").textContent = beats[n][2];
    document.querySelectorAll("[data-beat]").forEach((b) => {
      b.setAttribute("aria-current", String(+b.dataset.beat === n));
    });
    document.querySelectorAll("[data-person]").forEach((b, i) => {
      const who = beats[n][1],
        incoming = [2, 5, 8].includes(n) && i === who + 1;
      b.setAttribute("aria-current", String(i === who || incoming));
      b.classList.toggle("done", i < who);
      b.querySelector("small").textContent =
        i < who ? "Ready" : i === who ? "Working" : incoming ? "Receiving" : "Waiting";
    });
    if (gates.includes(n) && reset) ready[beats[n][1]] = false;
    if (gates.includes(n)) startClock(beats[n][1]);
    tl = gsap.timeline({
      paused: true,
      onUpdate: draw,
      onComplete() {
        finishBeat(n);
      },
    });
    const go = (v, t, d = 0.6, e = "sine.inOut") => tl.to(p, { ...v, duration: d, ease: e }, t);
    if (n === 0) {
      go({ fold: 1 }, 0.2, 1.05);
      go({ y: 244 }, 1.55, 0.6);
      go({ y: 251 }, 2.75, 0.7);
      tl.to({}, { duration: 0.45 }, 3.45);
    }
    if (n === 1) {
      go({ y: 242 }, 0, 0.7);
      go({ look: -2 }, 0.65, 0.5);
      go({ r: 1, look: 2 }, 1.2, 0.6);
      go({ r: 0, look: 0 }, 1.9, 0.4);
      go({ fold: 0, y: 251 }, 2.35, 0.95);
      tl.to({}, { duration: 0.3 }, 3.3);
    }
    if ([2, 5, 8].includes(n)) {
      const from = beats[n][1],
        to = from + 1;
      actors[to].x = 570;
      actors[to].alpha = 0;
      tl.to(actors[from], { x: 230, duration: 0.75, ease: "sine.inOut" }, 0);
      tl.to(actors[to], { x: 435, alpha: 1, duration: 0.75, ease: "sine.inOut" }, 0);
      go({ x: 321, y: 245, gazeMix: 1, outerRelease: 1 }, 0, 0.75);
      go({ grip: 1 }, 0.48, 0.62);
      go({ y: 242 }, 1.1, 0.22);
      go({ offer: 1 }, 1.38, 0.4); // A visible shared grip precedes release.
      tl.to(actors[from], { x: 85, alpha: 0, duration: 0.85, ease: "sine.inOut" }, 1.78);
      tl.to(actors[to], { x: 320, duration: 0.85, ease: "sine.inOut" }, 1.78);
      go({ x: 320, y: 251, gazeMix: 0 }, 1.78, 0.85);
      tl.to({}, { duration: 0.3 }, 2.63);
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
      go({ magic: 1, spark: 1 }, 2.35, 0.95);
      go({ spark: 0 }, 3.3, 0.2);
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
          fanMode = true;
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
          fanMode = false;
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
      go({ extractGrip: 1 }, 0, 0.2);
      go({ sx: 48, sy: -18, sr: -6 }, 0.2, 0.65);
      go({ sx: 84, sy: -10, sr: -4 }, 0.85, 0.45);
      tl.set(p, { sheetFront: 1 }, 1.3);
      go({ sx: 0, sy: 0, sr: 0, y: 249, sheetGrip: 1 }, 1.3, 0.7);
      tl.set(p, { tool: 1, stroke: -1, penX: -21, penY: -33 }, 2);
      go({ gesture: 1, toolAlpha: 1 }, 2, 0.4);
      go({ penY: -27 }, 2.4, 0.16);
      let at = 2.56;
      for (let i = 0; i < 3; i++) {
        tl.set(p, { stroke: i, contact: 1 }, at);
        go({ [`q${i}`]: 1 }, at, 0.72, "none");
        at += 0.72;
        const end = questionNodes[i].getPointAtLength(questionLengths[i]);
        tl.set(p, { contact: 0, penX: end.x, penY: end.y }, at);
        go({ penY: end.y - 6 }, at, 0.14);
        at += 0.14;
        if (i < 2) {
          go({ penX: -21, penY: -33 + (i + 1) * 12 }, at, 0.3);
          at += 0.3;
          go({ penY: -27 + (i + 1) * 12 }, at, 0.14);
          at += 0.14;
        }
      }
      tl.set(p, { questions: 1, stroke: -1 }, at);
      go({ penX: 31, penY: -42 }, at, 0.35);
      go({ toolAlpha: 0 }, at + 0.35, 0.25);
      go({ gesture: 0, extractGrip: 0, y: 245 }, at + 0.6, 0.5);
    }
    if (n === 7) {
      go({ gesture: 1, rx: 351, ry: 267 }, 0, 0.4);
      go({ extend: 1, ry: 293, y: 241 }, 0.45, 1.1);
      go({ r: -1 }, 1.7, 0.55);
      go({ r: 0 }, 2.35, 0.45);
      go({ extend: 0, gesture: 0, sheetGrip: 0, y: 251 }, 3.05, 0.85);
    }
    if (n === 9) {
      go({ compare: 1, y: 249 }, 0, 0.85);
      go({ r: -1, look: -3 }, 1.2, 0.55);
      go({ r: 1, look: 3 }, 2, 0.55);
      go({ r: 0, look: 0 }, 2.8, 0.5);
      go({ compare: 0, y: 251 }, 3.5, 0.85);
    }
    if (n === 10) {
      go({ gesture: 1, rx: 369, ry: 234 }, 0, 0.65);
      tl.set(p, { tool: 2 }, 0.4);
      go({ toolAlpha: 1 }, 0.4, 0.3);
      go({ rx: 320, ry: 236 }, 0.8, 0.6);
      go({ ry: 251 }, 1.45, 0.17, "power2.in");
      tl.set(p, { seal: 1 }, 1.62);
      go({ rx: 365, ry: 226 }, 1.8, 0.4, "power2.out");
      go({ toolAlpha: 0 }, 2.25, 0.25);
      go({ gesture: 0, y: 239 }, 2.5, 0.7);
      tl.to({}, { duration: 1.1 }, 3.2);
    }
    draw();
    sync();
  }
  function finishBeat(n) {
    if (gates.includes(n) && !ready[beats[n][1]]) {
      holdWork(n);
      return;
    }
    if (loop) {
      if ([2, 5, 8, 10].includes(n)) {
        updateReadiness();
        return;
      }
      holdWork(n);
      return;
    }
    if (n < 10) {
      build(n + 1);
      return;
    }
    complete = true;
    $("#title").textContent = "All together. All yours.";
    $("#status").textContent = "Lesson ready";
    document.querySelectorAll("[data-person]").forEach((b) => {
      b.classList.add("done");
      b.setAttribute("aria-current", "false");
      b.querySelector("small").textContent = "Ready";
    });
    updateReadiness();
  }
  function startClock(stage) {
    stageClock?.kill();
    stageClock = null;
    if (pace === "manual" || ready[stage]) return;
    const clock = { elapsed: 0 };
    stageClock = gsap.to(clock, {
      elapsed: 1,
      duration: durations[pace][stage],
      paused: true,
      ease: "none",
      onComplete() {
        markReady(stage);
      },
    });
  }
  function markReady(stage = beats[current][1]) {
    ready[stage] = true;
    updateReadiness();
    if (pref.matches) {
      if (gates.includes(current)) tl.progress(1);
      else if (!complete) tl.progress(1);
    }
  }
  function updateReadiness() {
    const stage = beats[current][1],
      canReady = gates.includes(current) && !complete;
    $("#ready").disabled =
      complete || (!canReady && !pref.matches) || (ready[stage] && !pref.matches);
    $("#ready").textContent =
      pref.matches && !canReady
        ? "Next beat"
        : ready[stage]
          ? "Ready signal queued"
          : "Mark stage ready";
    $("#readiness-note").textContent = complete
      ? "The seal runs once. The finished lesson stays ready."
      : ready[stage]
        ? loop
          ? "Ready received. Uncheck “Loop this beat” to continue."
          : "Ready received. Finishing this gesture before moving on."
        : canReady
          ? `${names[stage]} is still working. The animation can wait here without repeating a handoff.`
          : "This finishing gesture or handoff plays once before the next job starts.";
  }
  function holdWork(n) {
    tl?.kill();
    waiting = true;
    fanMode = false;
    const base = { x: p.x, y: p.y, r: p.r, fold: p.fold, compare: p.compare };
    tl = gsap.timeline({
      paused: true,
      onUpdate: draw,
      onComplete() {
        waiting = false;
        if (gates.includes(n) && ready[beats[n][1]] && !loop) build(n + 1);
        else if (!loop && !gates.includes(n)) build(n + 1);
        else holdWork(n);
      },
    });
    const go = (v, t, d = 0.65) => tl.to(p, { ...v, duration: d, ease: "sine.inOut" }, t);
    if (n === 0 || n === 1) {
      go({ look: -2, y: base.y - 2 }, 0);
      go({ look: 2 }, 0.9, 0.8);
      go({ look: 0, y: base.y }, 1.95, 0.65);
    } else if (n === 3) {
      p.pending = 1;
      p.paperFront = 0;
      p.px = 0;
      p.py = 4;
      p.pr = 0;
      p.magic = 0;
      p.sweep = 0;
      p.contact = 0;
      go({ gesture: 1, px: 80, py: -14, pr: -4 }, 0, 0.8);
      tl.set(p, { paperFront: 1 }, 0.8);
      go({ px: 0, py: -18, pr: 0 }, 0.8, 0.65);
      go({ sweep: 1 }, 1.45, 0.3);
      go({ magic: 1, spark: 0.8 }, 1.75, 0.85);
      go({ spark: 0 }, 2.6, 0.2);
      go({ sweep: 0 }, 2.8, 0.2);
      go({ py: 0 }, 3, 0.6);
      tl.set(p, { pending: 0 }, 3.6);
      go({ gesture: 0 }, 3.6, 0.4);
    } else if (n === 4) {
      go({ ambientGate: 0 }, 0, 0.2);
      go({ x: 326, y: 253.2, r: 3, stackGap: 0 }, 0, 0.3);
      tl.call(
        () => {
          fanMode = true;
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
          fanMode = false;
        },
        [],
        end,
      );
      go({ x: base.x, y: base.y, r: base.r, stackGap: 0, ambientGate: 1 }, end, 0.4);
    } else if (n === 6 || n === 7) {
      go({ look: -2, r: -0.6, y: base.y - 2 }, 0, 0.7);
      go({ look: 2, r: 0.6 }, 0.9, 0.8);
      go({ look: 0, r: base.r, y: base.y }, 1.95, 0.65);
    } else {
      go({ compare: 0.85, look: -3 }, 0, 0.7);
      go({ look: 3 }, 0.9, 0.7);
      go({ compare: 0, look: 0 }, 1.9, 0.8);
    }
    tl.to({}, { duration: 0.3 }, Math.max(2.7, tl.duration()));
    draw();
    sync();
  }
  function sync() {
    reducedTimer?.kill();
    if (pref.matches) draw();
    const stop = paused || document.hidden || pref.matches;
    [tl, stageClock, ...faces].forEach((t) => {
      if (!t) return;
      if (pref.matches) t.pause();
      else if (stop) t.pause();
      else t.play();
    });
    if (pref.matches && !paused && !document.hidden && !complete) {
      stageClock?.play();
      if (!gates.includes(current) || ready[beats[current][1]])
        reducedTimer = gsap.delayedCall(0.8, () => tl.progress(1));
    }
    $("#pause").textContent = paused ? "Resume" : "Pause";
    $("#pause").setAttribute("aria-pressed", String(paused));
    if (!complete)
      $("#status").textContent = pref.matches
        ? "Reduced motion"
        : waiting
          ? "Working · waiting for readiness"
          : loop
            ? "Inspecting this beat"
            : "Sequence demo";
    updateReadiness();
  }
  $("#pause").addEventListener("click", () => {
    paused = !paused;
    sync();
  });
  $("#restart").addEventListener("click", () => {
    loop = false;
    paused = false;
    $("#loop").checked = false;
    ready.fill(false);
    stageClock?.kill();
    build(0, true);
  });
  $("#loop").addEventListener("change", (e) => {
    loop = e.target.checked;
    if (!loop && tl.progress() === 1 && !complete) finishBeat(current);
    sync();
  });
  function inspect(n) {
    stageClock?.kill();
    stageClock = null;
    loop = true;
    $("#loop").checked = true;
    build(n, true);
  }
  $("#beats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-beat]");
    if (b) inspect(+b.dataset.beat);
  });
  $("#cast").addEventListener("click", (e) => {
    const b = e.target.closest("[data-person]");
    if (b) inspect([0, 3, 6, 9][+b.dataset.person]);
  });
  $("#pace").addEventListener("change", (e) => {
    pace = e.target.value;
    ready.fill(false);
    if (gates.includes(current)) startClock(beats[current][1]);
    sync();
  });
  $("#ready").addEventListener("click", () => markReady());
  pref.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", () =>
    [tl, stageClock, fan.t, ...faces].forEach((t) => {
      t?.kill();
    }),
  );
  window.GatherProduction = {
    inspect,
    markReady,
    setAmbient(values) {
      for (const k of Object.keys(motionTarget)) {
        const v = Number(values[k]);
        if (Number.isFinite(v))
          motionTarget[k] = Math.max(k === "tempo" ? 0.4 : 0, Math.min(k === "tempo" ? 1.8 : 2, v));
      }
    },
    get ambient() {
      return { ...motionTarget };
    },
    setPace(value) {
      pace = value;
      ready.fill(false);
      if (gates.includes(current)) startClock(beats[current][1]);
      sync();
    },
    seek(t) {
      tl.pause().time(t);
      draw();
    },
    auditStart(n) {
      paused = true;
      loop = false;
      ready.fill(true);
      stageClock?.kill();
      build(n, true);
      ready.fill(true);
      tl.pause();
      faces.forEach((f, i) => {
        f.pause().time(i * 1.37);
      });
      return tl.duration();
    },
    auditFrame(t) {
      tl.pause().time(t, false);
      faces.forEach((f, i) => {
        f.pause().totalTime(t + i * 1.37);
      });
      draw();
      return current;
    },
    get state() {
      return {
        beat: current,
        prop: Object.fromEntries(Object.entries(p).filter(([k]) => k !== "_gsap")),
        actors: actors.map((a) => ({ x: a.x, alpha: a.alpha })),
        fanMode,
        complete,
        waiting,
        ready: [...ready],
        duration: tl.duration(),
      };
    },
  };
  build(0, true);
})();
