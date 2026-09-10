(() => {
  const pref = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = false,
    speed = 1;
  const rigs = [];
  const cards = [
    [
      "Fan. Check. Square.",
      "Open the deck, check the slides, then bring every edge neatly back together.",
    ],
    ["One slide at a time.", "Pick up, turn, guide into the slot. The feeder takes it from there."],
  ];
  const card = (fill = "#faf4df") =>
    `<rect x="-31" y="-22" width="62" height="44" rx="2" fill="${fill}"/><path class="detail" d="M-20 10 -8-3 3 6 14-8 23 10Z" fill="#e88f52"/><circle class="detail" cx="16" cy="-10" r="4" fill="#f5c054"/>`;
  const pile = (x, y, fill) =>
    `<g transform="translate(${x} ${y})"><path d="M-36 5 29-1 40 9-27 16Z" fill="${fill}"/><path d="M-36 0 29-6 40 4-27 11Z" fill="${fill}"/><path d="M-36-5 29-11 40-1-27 6Z" fill="${fill}"/></g>`;
  let serial = 0;
  function svg(i) {
    const id = `slot-${serial++}`;
    return `<svg class="scene" viewBox="0 0 420 300" aria-hidden="true"><defs><clipPath id="${id}"><rect x="0" y="0" width="326" height="300"/></clipPath></defs><path d="M34 252H389" stroke="#bec9b9"/><ellipse cx="205" cy="251" rx="76" ry="5" fill="#293b32" opacity=".07" stroke="none"/>${i === 2 ? `<g class="receiver"><path d="M319 182 343 173 392 182v61l-24 8-49-8Z" fill="#cbdcb5"/><path d="m319 182 49 9 24-9M368 191v60"/><path d="M319 194v33" stroke-width="5"/><g class="display"><path d="M339 197 359 201v24l-20-4Z" fill="#faf4df"/><path d="m342 215 5-8 5 7 4-3" stroke-width="1.5"/></g><circle class="indicator" cx="351" cy="236" r="2" fill="#81976a"/></g>` : ""}${i === 2 ? pile(76, 238, "#faf4df") : ""}<path class="legs"/><g class="body"><path class="side" d="M-65-70-53-78 65-67 54-59v128l-119-9Z" fill="#dfab43"/><path d="M-64-66 55-56V70L-64 60Z" fill="#faf4df"/><path d="M-59-70 64-58V66L-59 54Z" fill="#f5c054"/><path class="detail" d="M-41-47 44-39"/><path d="M-38 30-17 9-1 23 19 1 48 37Z" fill="#e88f52"/><circle cx="38" cy="-22" r="9" fill="#fff3cb"/><g class="face"><g class="eyes"><path class="eye-left" fill="#293b32" stroke="none" d="M-25 -13C-25 -17 -19 -17 -19 -13C-19 -9 -25 -9 -25 -13Z"/><path class="eye-right" fill="#293b32" stroke="none" d="M-1 -11C-1 -15 5 -15 5 -11C5 -7 -1 -7 -1 -11Z"/></g><path class="mouth" d="M-15-1q7 9 16 1"/></g></g><path class="arm left"/><path class="arm right"/><g ${i === 2 ? `clip-path="url(#${id})"` : ""}><g class="held"><g class="fan-a">${card()}</g><g class="fan-b">${card("#e4edcf")}</g><g class="fan-c">${card("#faf4df")}</g></g></g><path class="fingers left"/><path class="fingers right"/></svg>`;
  }
  // Scene coordinates are explicit so a carried slide and its gripping hands cannot drift apart.
  function setup(el, i) {
    const b = el.querySelector(".body"),
      held = el.querySelector(".held"),
      left = el.querySelector(".arm.left"),
      right = el.querySelector(".arm.right"),
      legs = el.querySelector(".legs"),
      fingers = [...el.querySelectorAll(".fingers")];
    const p = {
      x: 200,
      y: 159,
      turn: -0.18,
      lean: -1,
      cx: 78,
      cy: 220,
      cr: -8,
      spread: 0,
      lag: 0,
      grip: 0,
    };
    const state = { el, visible: false, t: null };
    rigs.push(state);
    function paint() {
      const sx = 1 - Math.abs(p.turn) * 0.08,
        skew = p.turn * 1.5;
      const edge = 5 + Math.abs(p.turn) * 2;
      el.querySelector(".side").setAttribute(
        "d",
        `M-59-70l${-edge} -5V${54 - edge * 0.25}L-59 54ZM-59-70l${-edge} -5L${64 - edge} -63 64-58Z`,
      );
      b.setAttribute(
        "transform",
        `translate(${p.x} ${p.y}) rotate(${p.lean}) skewY(${skew}) scale(${sx} 1)`,
      );
      // Match SVG's complete body transform, keeping shoulders and hips attached.
      const angle = (p.lean * Math.PI) / 180;
      const joint = (x, y) => {
        x *= sx;
        y += x * Math.tan((skew * Math.PI) / 180);
        return {
          x: p.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: p.y + x * Math.sin(angle) + y * Math.cos(angle),
        };
      };
      const hipL = joint(-35, 57),
        hipR = joint(35, 64);
      legs.setAttribute(
        "d",
        `M${hipL.x} ${hipL.y}Q${p.x - 43} 239 164 249l-12 2M${hipR.x} ${hipR.y}Q${p.x + 38} 241 231 249l14 1`,
      );
      const shL = joint(-59, 0),
        shR = joint(64, 5);
      const rad = (p.cr * Math.PI) / 180,
        cs = Math.cos(rad),
        sn = Math.sin(rad);
      const fanAngle = (p.spread * Math.PI) / 180;
      const lx = -28 * Math.cos(fanAngle) - 18 * Math.sin(fanAngle),
        ly = 23 + 28 * Math.sin(fanAngle) - 18 * Math.cos(fanAngle);
      const rightAngle = ((p.spread + p.lag) * Math.PI) / 180;
      const rx = 28 * Math.cos(rightAngle) + 18 * Math.sin(rightAngle),
        ry = 23 + 28 * Math.sin(rightAngle) - 18 * Math.cos(rightAngle);
      const a = { x: p.cx + lx * cs - ly * sn, y: p.cy + lx * sn + ly * cs },
        z = { x: p.cx + rx * cs - ry * sn, y: p.cy + rx * sn + ry * cs };
      const restL = { x: p.x - 75, y: p.y + 55 },
        restR = { x: p.x + 76, y: p.y + 53 };
      const handL = {
          x: restL.x + (a.x - restL.x) * p.grip,
          y: restL.y + (a.y - restL.y) * p.grip,
        },
        handR = { x: restR.x + (z.x - restR.x) * p.grip, y: restR.y + (z.y - restR.y) * p.grip };
      for (const [arm, sh, h, side] of [
        [left, shL, handL, -1],
        [right, shR, handR, 1],
      ])
        arm.setAttribute(
          "d",
          `M${sh.x} ${sh.y}Q${(sh.x + h.x) / 2 + side * 18} ${Math.max(sh.y, h.y) + 25} ${h.x} ${h.y}`,
        );
      held.setAttribute("transform", `translate(${p.cx} ${p.cy}) rotate(${p.cr})`);
      el.querySelector(".fan-a").setAttribute("transform", `rotate(${-p.spread} 0 23)`);
      el.querySelector(".fan-b").setAttribute("transform", `rotate(${p.spread + p.lag} 0 23)`);
      [handL, handR].forEach((h, j) => {
        fingers[j].setAttribute(
          "d",
          `M${h.x + (j ? 3 : -3)} ${h.y - 4}q${j ? -7 : 7} -2 ${j ? -6 : 6} 4q0 5 ${j ? 5 : -5} 4`,
        );
      });
      const gaze = (p.cx - p.x) * 0.025;
      el.querySelector(".face").setAttribute("transform", `translate(${gaze} 0)`);
    }
    const tl = gsap.timeline({
      paused: true,
      repeat: -1,
      repeatDelay: 0.05,
      onUpdate: paint,
    });
    state.t = tl;
    const to = (v, at, d, e = "sine.inOut") => tl.to(p, { ...v, duration: d, ease: e }, at);
    const _resetCard = (v, at) => {
      tl.to(held, { opacity: 0, duration: 0.12 }, at);
      tl.set(p, v, at + 0.13);
      tl.to(held, { opacity: 1, duration: 0.15 }, at + 0.15);
    };
    if (i === 1) {
      Object.assign(p, { cx: 205, cy: 211, cr: 3, grip: 1, turn: 0.2, lean: 0.5 });
      // Anticipation, a quick opening, then individual sheets catching up.
      to({ cy: 215, y: 160, lean: 1 }, 0, 0.18);
      to(
        { cx: 205, cy: 196, cr: -2, y: 158, lean: -0.5, spread: 34, lag: -12 },
        0.18,
        0.48,
        "power2.out",
      );
      to({ lag: 4 }, 0.53, 0.23, "sine.out");
      to({ lag: 0 }, 0.76, 0.2);
      to({ cx: 209, cy: 196, cr: 3, lean: 0.8, turn: 0.45 }, 0.83, 0.4);
      to({ cx: 203, cy: 198, cr: -2, lean: -0.4, turn: -0.3 }, 1.23, 0.44);
      to(
        { spread: 0, lag: 9, cx: 205, cy: 208, cr: 0, y: 160, lean: 1, turn: 0.15 },
        1.67,
        0.32,
        "power2.inOut",
      );
      to({ lag: 0 }, 1.93, 0.2, "power2.out");
      // A short edge tap and a softer recovery, rather than a uniform bounce.
      to({ cy: 223, cr: 0, y: 160 }, 2.13, 0.12, "power2.in");
      to({ cy: 211, cr: 3, y: 159, turn: 0.2, lean: 0.5 }, 2.25, 0.35, "power2.out");
    } else {
      Object.assign(p, { cx: 78, cy: 220, cr: -8 });
      to({ x: 183, y: 167, lean: -2, turn: -0.65, grip: 1 }, 0, 0.32);
      to({ cx: 135, cy: 171, cr: -13, x: 191, y: 158, lean: -1 }, 0.32, 0.42, "power2.out");
      to(
        { cx: 278, cy: 200, cr: 0, x: 220, y: 161, turn: 0.6, lean: 1.5 },
        0.74,
        0.58,
        "power2.inOut",
      );
      // Guide to the physical slot; release before the feed mechanism takes over.
      to({ cx: 306, cy: 207, x: 224, lean: 2 }, 1.32, 0.32, "sine.out");
      to({ grip: 0 }, 1.64, 0.24);
      to({ cx: 363 }, 1.68, 0.42, "power1.inOut");
      const receiver = el.querySelector(".receiver");
      tl.to(receiver, { x: 2, duration: 0.12, ease: "power2.out" }, 1.76).to(
        receiver,
        { x: 0, duration: 0.32, ease: "sine.out" },
        1.88,
      );
      tl.to(
        el.querySelector(".display"),
        { y: -3, duration: 0.2, yoyo: true, repeat: 1, ease: "sine.inOut" },
        1.83,
      );
      tl.to(el.querySelector(".indicator"), { fill: "#e88f52", duration: 0.12 }, 1.8).to(
        el.querySelector(".indicator"),
        { fill: "#81976a", duration: 0.24 },
        2.12,
      );
      to({ x: 200, y: 159, turn: -0.18, lean: -1 }, 1.98, 0.5);
      // Replenish only while hidden in the source pile, never during the carry.
      tl.set(held, { opacity: 0 }, 2.12);
      tl.set(p, { cx: 78, cy: 220, cr: -8 }, 2.13);
      tl.set(held, { opacity: 1 }, 2.22);
    }

    // Expressions drift across several work cycles, with long, soft transitions.
    // Each eye and the mouth keeps its own continuous path rather than swapping faces.
    const mouth = el.querySelector(".mouth"),
      eyes = el.querySelector(".eyes");
    gsap.set(eyes, { svgOrigin: "-10 -12" });
    const face = gsap.timeline({
      paused: true,
      repeat: -1,
      repeatDelay: 0.3 + Math.random() * 0.4,
      defaults: { ease: "sine.inOut" },
    });
    state.face = face;
    // Keep the original dot eyes. Expression comes from the same continuous mouth line.
    // Changes in width, depth and asymmetry are visible without opening the mouth.
    face.to(mouth, { attr: { d: "M-14 0q8 6 17 -2" }, duration: 1 }, 0.25);
    face
      .to(eyes, { scaleY: 0.12, duration: 0.12 }, 1.8)
      .to(eyes, { scaleY: 1, duration: 0.2 }, 1.92);
    face.to(mouth, { attr: { d: "M-10 1q4 2 8 0" }, duration: 1.05 }, 1.75);
    face.to(mouth, { attr: { d: "M-15 -1q9 12 19 0" }, duration: 1.2 }, 3.15);
    face.to(mouth, { attr: { d: "M-12 1q7 7 15 -3" }, duration: 1.05 }, 4.85);
    face
      .to(eyes, { scaleY: 0.12, duration: 0.11 }, 5.6)
      .to(eyes, { scaleY: 1, duration: 0.19 }, 5.71);
    face.to(mouth, { attr: { d: "M-11 1q5 3 10 -.5" }, duration: 1 }, 6.25);
    face.to(mouth, { attr: { d: "M-15 -1q7 9 16 1" }, duration: 1.1 }, 7.6);
    face.to({}, { duration: 0.4 });
    face.time(i === 2 ? 3 : 0);
    state.pose = p;
    state.paint = paint;
    paint();
    observer.observe(el);
  }
  const observer = new IntersectionObserver((es) =>
    es.forEach((e) => {
      const r = rigs.find((r) => r.el === e.target);
      r.visible = e.isIntersecting;
      sync(r);
    }),
  );
  function sync(r) {
    for (const t of [r.t, r.face]) {
      t.timeScale(speed);
      if (pref.matches) t.pause(0);
      else if (paused || document.hidden || !r.visible) t.pause();
      else t.play();
    }
  }
  window.GatherFanRig = {
    markup: () => svg(1),
    mount(el) {
      setup(el, 1);
      const r = rigs[rigs.length - 1];
      observer.unobserve(el);
      r.visible = false;
      r.t.pause(0);
      r.face.pause(0);
      return r;
    },
  };
  if (!document.getElementById("studies")) return;
  cards.forEach(([title, desc], index) => {
    const i = index + 1;
    const a = document.createElement("article");
    a.innerHTML = `<header><span>0${index + 1}</span><h2>${title}</h2></header>${svg(i)}<p>${desc}</p><div class="sizes"><span>The same action at loader size</span>${svg(i)}</div>`;
    document.getElementById("studies").append(a);
    a.querySelectorAll("svg").forEach((el) => {
      setup(el, i);
    });
  });
  document.getElementById("pause").addEventListener("click", (e) => {
    paused = !paused;
    e.currentTarget.setAttribute("aria-pressed", String(paused));
    e.currentTarget.textContent = paused ? "Resume motion" : "Pause motion";
    rigs.forEach(sync);
  });
  document.getElementById("speed").addEventListener("change", (e) => {
    speed = +e.target.value;
    rigs.forEach(sync);
  });
  pref.addEventListener("change", () => rigs.forEach(sync));
  document.addEventListener("visibilitychange", () => rigs.forEach(sync));
})();
