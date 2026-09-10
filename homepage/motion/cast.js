/* The curated cast: three ambient behaviors and one signature per character. */
(() => {
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const rand = (a, b) => a + Math.random() * (b - a);
  const defaults = {
    x: 0,
    y: 0,
    r: 0,
    sx: 1,
    sy: 1,
    eye: 1,
    gx: 0,
    gy: 0,
    smile: 0,
    left: 0,
    right: 0,
    glasses: 0,
    jump: 0,
  };
  const face = {
    slides: [127, 141, 138, 151, 150, 139],
    activity: [136, 121, 146, 133, 156, 119],
    support: [129, 158, 143, 169, 156, 160],
    answers: [143, 153, 151, 159, 159, 152],
  };
  const pivots = {
    slides: [
      [55, 105],
      [244, 117],
    ],
    activity: [
      [70, 140],
      [222, 118],
    ],
    support: [
      [57, 143],
      [237, 144],
    ],
    answers: [
      [84, 150],
      [220, 151],
    ],
  };
  const names = {
    slides: ["an easy blink", "checking on the others", "a smile to itself"],
    activity: ["a quick double blink", "thinking with the pencil", "a little spark"],
    support: ["a slow blink", "a quiet breath", "an encouraging smile"],
    answers: ["a considered blink", "a quick glance", "adjusting the glasses"],
  };
  let actors = [],
    timer,
    nextSlot = 0,
    manualPause = false;
  const blocked = () =>
    preference.matches ||
    document.hidden ||
    manualPause ||
    !!document.querySelector("dialog[open]");
  const ns = "http://www.w3.org/2000/svg";
  function make(host) {
    const svg = host.querySelector("svg"),
      body = svg.querySelector(".body"),
      kind = host.dataset.material || host.dataset.characterCopy || host.dataset.cast;
    svg.querySelector(".happy-mouth")?.remove();
    const legs = body.firstElementChild,
      legD = legs.getAttribute("d");
    svg.insertBefore(legs, body);
    const shadow = document.createElementNS(ns, "ellipse");
    for (const [k, v] of Object.entries({
      cx: 150,
      cy: 279,
      rx: 80,
      ry: 4,
      fill: "currentColor",
      stroke: "none",
      opacity: 0.07,
    }))
      shadow.setAttribute(k, v);
    svg.prepend(shadow);
    const eyes = [...svg.querySelectorAll(".eye")].map((old) => {
      const el = document.createElementNS(ns, "ellipse");
      for (const attr of old.attributes) el.setAttribute(attr.name, attr.value);
      const r = +old.getAttribute("r");
      el.setAttribute("rx", r);
      el.setAttribute("ry", r);
      old.replaceWith(el);
      return { el, r, base: r, x: +el.getAttribute("cx"), y: +el.getAttribute("cy") };
    });
    const a = {
      loader: host.hasAttribute("data-loading"),
      host,
      svg,
      body,
      legs,
      legD,
      shadow,
      eyes,
      kind,
      mouth: svg.querySelector(".mouth"),
      left: svg.querySelector(".arm-left"),
      right: svg.querySelector(".arm-right"),
      glasses: svg.querySelector(".glasses"),
      state: { ...defaults },
      gaze: { x: 0, y: 0 },
      visible: false,
      busy: false,
      last: -1,
      bag: [],
      due: performance.now() + rand(100, 750),
      cooldown: 0,
    };
    host.dataset.castReady = "true";
    // Optical sizing: keep the silhouette and face legible as fine page marks disappear.
    [...body.children]
      .filter(
        (el) =>
          el.tagName === "path" &&
          !el.hasAttribute("class") &&
          !el.hasAttribute("fill") &&
          !el.hasAttribute("stroke-width"),
      )
      .forEach((el) => {
        el.classList.add("fine-detail");
      });
    new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (!width) return;
      const tiny = width < 64;
      host.dataset.castSize = tiny ? "tiny" : width < 120 ? "small" : "large";
      svg.style.strokeWidth = Math.max(2, (300 / width) * 0.85);
      eyes.forEach((e) => {
        e.r = Math.max(e.base, (300 / width) * 0.78);
        e.el.setAttribute("rx", e.r);
      });
      paint(a, a.state);
    }).observe(svg);
    paint(a, a.state);
    return a;
  }
  let livingTime = 0;
  function paint(a, p) {
    if (document.body.hasAttribute("data-living-cast") && !blocked() && a.visible && !a.loader) {
      const i = ["support", "slides", "activity", "answers"].indexOf(a.kind),
        phase = (livingTime * 1.25 * Math.PI * 2) / [5.9, 4.2, 5.1, 6.7][i] + i * 1.7;
      const strength = a.host.dataset.motion === "signature" ? 0.25 : 0.65;
      p = {
        ...p,
        y: p.y + Math.sin(phase * 1.17) * 1.65 * 1.2 * strength,
        r: p.r + Math.sin(phase) * 0.65 * 1.65 * 1.25 * strength,
      };
    }

    a.body.setAttribute(
      "transform",
      `translate(${p.x} ${p.y}) translate(150 235) rotate(${p.r}) scale(${p.sx} ${p.sy}) translate(-150 -235)`,
    );
    {
      // Hips follow the paper; ankles stay on the floor. Curved knees absorb weight.
      const feet = {
        slides: [
          [60, 221, 51, 274, 32, 277],
          [223, 217, 240, 268, 260, 268],
        ],
        activity: [
          [105, 233, 98, 273, 79, 278],
          [173, 230, 190, 272, 212, 268],
        ],
        support: [
          [91, 229, 82, 269, 63, 271],
          [198, 228, 207, 268, 225, 272],
        ],
        answers: [
          [115, 223, 119, 268, 99, 272],
          [180, 222, 178, 266, 199, 272],
        ],
      }[a.kind];
      const rad = (p.r * Math.PI) / 180,
        c = Math.cos(rad),
        sn = Math.sin(rad);
      a.legs.setAttribute("transform", "");
      a.legs.setAttribute(
        "d",
        feet
          .map(([hx, hy, ax, ay, tx, ty], i) => {
            const dx = (hx - 150) * p.sx,
              dy = (hy - 235) * p.sy;
            const x = 150 + p.x + dx * c - dy * sn,
              y = 235 + p.y + dx * sn + dy * c;
            const ankleY = ay + p.jump;
            const kneeX = (x + ax) / 2 + (i ? 1 : -1) * Math.max(0, p.y - p.jump) * 1.2;
            return `M${x} ${y} Q${kneeX} ${(y + ankleY) / 2} ${ax} ${ankleY} L${tx} ${ty + p.jump}`;
          })
          .join(" "),
      );
    }
    a.legs.setAttribute("transform", `translate(0 ${p.jump})`);
    a.shadow.setAttribute("rx", 80 + p.jump * 0.8);
    a.shadow.style.opacity = 0.08 + p.jump * 0.002;
    const [l, r] = pivots[a.kind];
    a.left.setAttribute("transform", `rotate(${p.left} ${l.join(" ")})`);
    a.right.setAttribute("transform", `rotate(${p.right} ${r.join(" ")})`);
    a.eyes.forEach((e) => {
      e.el.setAttribute("ry", Math.max(0.18, e.r * p.eye));
      e.el.setAttribute("cx", e.x + p.gx + a.gaze.x);
      e.el.setAttribute("cy", e.y + p.gy + a.gaze.y);
    });
    const [x, y, cx, cy, ex, ey] = face[a.kind],
      s = p.smile;
    a.mouth.setAttribute(
      "d",
      `M${x - 2 * s} ${y - s} Q${cx} ${cy + 8 * s} ${ex + 2 * s} ${ey - s}`,
    );
    if (a.glasses) a.glasses.setAttribute("transform", `translate(0 ${p.glasses})`);
  }
  function stop(a) {
    a.tl?.kill();
    if (a.props) {
      a.props.remove();
      a.props = null;
    }
    const check = a.svg.querySelector(".checking");
    if (check) {
      check.style.strokeDasharray = "";
      check.style.strokeDashoffset = "";
    }
    gsap.killTweensOf(a.gaze);
    a.busy = false;
    a.gaze = { x: 0, y: 0 };
    a.state = { ...defaults };
    delete a.host.dataset.motion;
    paint(a, a.state);
  }
  function timeline(a, label) {
    a.tl?.kill();
    a.busy = true;
    a.host.dataset.motion = label;
    a.tl = gsap.timeline({
      onUpdate: () => paint(a, a.state),
      onComplete: () => {
        a.busy = false;
        delete a.host.dataset.motion;
        a.due = performance.now() + rand(550, 1250);
        a.cooldown = performance.now() + 350;
        schedule();
      },
    });
    return a.tl;
  }
  function blink(t, p, at = 0, speed = 1, double = false) {
    t.to(p, { eye: 0.06, duration: 0.095 * speed, ease: "power2.in" }, at).to(
      p,
      { eye: 1, duration: 0.16 * speed, ease: "power2.out" },
      at + 0.11 * speed,
    );
    if (double) blink(t, p, at + 0.37 * speed, 0.8);
  }
  function ambient(a, index) {
    const p = a.state,
      t = timeline(a, names[a.kind][index]);
    const to = (v, at, d, e = "sine.inOut") => t.to(p, { ...v, duration: d, ease: e }, at);
    if (index === 0) {
      blink(t, p, 0, a.kind === "support" ? 1.35 : 1, a.kind === "activity");
    } else if (a.kind === "slides") {
      if (index === 1) {
        to({ gx: -4, gy: -1 }, 0, 0.25);
        to({ r: -1.3, x: -0.7 }, 0.13, 0.5);
        to({ gx: 3 }, 0.65, 0.38);
        to({ r: 0, x: 0, gx: 0, gy: 0 }, 1.02, 0.55);
      } else {
        to({ smile: 0.7, eye: 0.8, y: -0.7 }, 0, 0.5);
        to({ eye: 1 }, 0.65, 0.18);
        to({ smile: 0, y: 0 }, 0.9, 0.6);
      }
    } else if (a.kind === "activity") {
      if (index === 1) {
        to({ gx: 3, gy: -3 }, 0, 0.2);
        to({ right: 9, r: 1.1 }, 0.13, 0.42);
        to({ right: 3, r: 0 }, 0.64, 0.6, "elastic.out(1,0.6)");
        to({ gx: 0, gy: 0, right: 0 }, 1, 0.35);
      } else {
        to({ gy: -3, smile: 0.7, sy: 1.009, y: -1.2 }, 0, 0.35);
        blink(t, p, 0.48, 0.85);
        to({ gy: 0, smile: 0, sy: 1, y: 0 }, 0.9, 0.6);
      }
    } else if (a.kind === "support") {
      if (index === 1) {
        to({ sy: 1.012, sx: 0.997, left: 3, right: -3, eye: 0.85 }, 0, 0.75);
        to({ sy: 1, sx: 1, left: 0, right: 0, eye: 1 }, 0.75, 0.85);
      } else {
        to({ smile: 0.8, r: -0.7, eye: 0.8 }, 0, 0.55);
        to({ eye: 1 }, 0.78, 0.2);
        to({ smile: 0, r: 0 }, 1, 0.65);
      }
    } else {
      if (index === 1) {
        to({ gx: 4, gy: 1 }, 0, 0.22);
        to({ r: 0.8 }, 0.15, 0.4);
        blink(t, p, 0.6);
        to({ gx: 0, gy: 0, r: 0 }, 0.95, 0.5);
      } else {
        to({ glasses: -2, gy: -1 }, 0, 0.35);
        to({ smile: 0.4 }, 0.2, 0.35);
        to({ glasses: 0 }, 0.65, 0.5, "elastic.out(1,0.65)");
        to({ smile: 0, gy: 0 }, 0.95, 0.35);
      }
    }
    nextSlot = performance.now() + rand(220, 420);
    schedule();
  }
  function signature(a) {
    if (
      blocked() ||
      !a.visible ||
      a.loader ||
      a.host.dataset.motion === "signature" ||
      performance.now() < a.cooldown
    )
      return;
    const p = a.state,
      t = timeline(a, "signature");
    nextSlot = performance.now() + 400;
    const to = (v, at, d, e = "power2.out") => t.to(p, { ...v, duration: d, ease: e }, at);
    const settle = (at) => {
      to({ x: 0, y: 0, r: 0, sx: 1, sy: 1 }, at, 0.95, "elastic.out(1,0.58)");
      to({ left: 0, right: 0 }, at + 0.1, 0.85, "elastic.out(1,0.65)");
      to({ smile: 0, gx: 0, gy: 0, glasses: 0, eye: 1 }, at + 0.2, 0.6, "sine.inOut");
    };
    if (a.kind === "slides") {
      // Friendly host: turn, lift the hand, two decreasing waves, relaxed return.
      to({ gx: 2, smile: 1 }, 0, 0.32);
      to({ r: 1.3, y: 1.5 }, 0, 0.12, "sine.in");
      to({ r: -4, x: -1.5, y: -1.5 }, 0.12, 0.5, "back.out(1.1)");
      to({ right: -27, left: 5 }, 0.22, 0.32, "sine.out");
      to({ right: -9 }, 0.54, 0.18, "sine.inOut");
      to({ right: -24 }, 0.72, 0.19, "sine.inOut");
      to({ right: -14 }, 0.91, 0.2, "sine.inOut");
      blink(t, p, 1.08);
      settle(1.15);
    } else if (a.kind === "activity") {
      // The thought leads the movement. A quick rise onto the toes, not a generic jump.
      to({ gx: 3, gy: -4, smile: 0.5 }, 0, 0.18);
      to({ y: 3, sy: 0.985, r: -1 }, 0, 0.14, "sine.in");
      to({ y: -4, sy: 1.018, r: 2.6, x: 1 }, 0.14, 0.42, "back.out(1.5)");
      to({ right: 26, left: 8, smile: 1 }, 0.23, 0.44, "back.out(1.2)");
      to({ right: 20 }, 0.67, 0.4, "sine.inOut");
      to({ gx: 0, gy: 0 }, 0.79, 0.26);
      blink(t, p, 0.92, 0.85);
      settle(1.1);
    } else if (a.kind === "support") {
      // A single open, welcoming breath; hands arrive after the weight shift.
      to({ y: 1.5, r: -1.2 }, 0, 0.27, "sine.inOut");
      to({ smile: 0.95, sy: 1.015, y: -1, sx: 1.008, r: 0 }, 0.2, 0.7, "sine.inOut");
      to({ left: 26, right: -26 }, 0.36, 0.67, "sine.inOut");
      blink(t, p, 1.05, 1.2);
      settle(1.4);
    } else {
      // Attentive inspector: look first, lean in, lift glasses, tiny confirming nod.
      to({ gx: 3, gy: -1 }, 0, 0.17);
      to({ r: 3.6, x: 2, y: 1 }, 0.12, 0.5, "back.out(1.05)");
      to({ glasses: -3.2, right: -9, smile: 0.7 }, 0.3, 0.4, "sine.out");
      to({ y: 3, r: 2.4, gy: 1 }, 0.81, 0.22, "sine.inOut");
      to({ y: 0, r: 3.1 }, 1.03, 0.27, "sine.inOut");
      blink(t, p, 1.18);
      settle(1.38);
    }
    t.timeScale(rand(0.94, 1.06));
    schedule();
  }
  function loading(a) {
    if (a.busy || blocked()) return;
    const p = a.state;
    a.busy = true;
    a.host.dataset.motion = "loading";
    const t = gsap.timeline({
      repeat: -1,
      delay: rand(0, 0.25),
      onUpdate: () => {
        // Broad silhouette movement remains readable at spinner sizes.
        const phase = t.progress() * Math.PI * 2,
          w = Math.sin(phase),
          hop = 1 - Math.cos(phase * 2);
        const q = { ...p };
        if (a.kind === "slides") {
          q.x += 12 * w;
          q.r += 9 * w;
          q.y -= 9 * hop;
          q.jump -= 9 * hop;
        }
        if (a.kind === "activity") {
          q.r += 7 * Math.sin(phase * 2);
          q.y -= 11 * hop;
          q.jump -= 11 * hop;
          q.right += 12 * Math.sin(phase * 4);
        }
        if (a.kind === "support") {
          q.r += 11 * w;
          q.x += 8 * w;
          q.left += 12 * w;
          q.right -= 12 * w;
          q.sy += 0.035 * Math.sin(phase * 2);
        }
        if (a.kind === "answers") {
          q.y -= 12 * hop;
          q.jump -= 12 * hop;
          q.r += 6 * w;
          q.glasses -= 2 * hop;
        }
        paint(a, q);
      },
    });
    a.tl = t;
    const to = (v, at, d, e = "sine.inOut") => t.to(p, { ...v, duration: d, ease: e }, at);
    if (!a.props) {
      a.props = document.createElementNS(ns, "g");
      a.props.classList.add("loading-props");
      a.svg.insertBefore(a.props, a.body);
      if (a.kind === "slides")
        a.props.innerHTML =
          '<rect class="float-card" x="95" y="81" width="92" height="66" rx="3" fill="#fff8df"/><rect class="float-card" x="95" y="81" width="92" height="66" rx="3" fill="#f5c054"/>';
      if (a.kind === "activity")
        a.props.innerHTML =
          '<path class="writing" d="M225 192q9-16 14-3t12-5t13-1" fill="none" stroke-width="3"/>';
      if (a.kind === "support")
        a.props.innerHTML =
          '<path class="turn-page" d="M145 70 233 87 226 220 145 207Z" fill="#f2f6e9"/>';
      if (a.kind === "support") a.body.insertBefore(a.props, a.eyes[0].el);
      if (a.kind === "answers") {
        const check = [...a.body.querySelectorAll("path")].find(
          (el) => el.getAttribute("stroke-width") === "4",
        );
        check?.classList.add("checking");
      }
    }
    if (a.kind === "slides") {
      // Deal two little slides in a continuous rising arc behind the character.
      a.props.querySelectorAll(".float-card").forEach((el, i) => {
        const at = i * 1.45;
        t.set(el, { x: 0, y: 0, rotation: -4, opacity: 0 }, at);
        t.to(
          el,
          { x: 12, y: -43, rotation: 6, opacity: 1, duration: 0.55, ease: "power2.out" },
          at,
        );
        t.to(el, { x: 44, y: -64, rotation: 15, duration: 0.6, ease: "sine.inOut" }, at + 0.55);
        t.to(
          el,
          { x: 64, y: -15, rotation: 24, opacity: 0, duration: 0.45, ease: "power2.in" },
          at + 1.15,
        );
      });
      to({ r: -2, y: -2, right: -15, smile: 0.7 }, 0, 0.65);
      to({ r: 1, y: 1, right: 3 }, 0.65, 0.65);
      to({ r: -1, y: -1, right: -10 }, 1.3, 0.65);
      to({ r: 0, y: 0, right: 0, smile: 0 }, 2, 0.95);
      blink(t, p, 2.35);
    } else if (a.kind === "activity") {
      const line = a.props.querySelector(".writing");
      const len = line.getTotalLength();
      t.set(line, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 }, 0);
      to({ gx: 4, gy: 3, r: 2, right: 26, smile: 0.6 }, 0, 0.45);
      to({ right: 18, r: 1 }, 0.45, 0.3);
      to({ right: 27, r: 2 }, 0.75, 0.32);
      to({ right: 20, r: 1 }, 1.07, 0.3);
      to({ right: 29, r: 2 }, 1.37, 0.32);
      t.to(line, { strokeDashoffset: 0, duration: 1.2, ease: "none" }, 0.48);
      t.to(line, { opacity: 0, duration: 0.35 }, 2.1);
      to({ right: 0, r: 0, gx: 0, gy: 0, smile: 0 }, 1.85, 0.85);
      blink(t, p, 2.25);
      t.to({}, { duration: 0.3 }, 2.7);
    } else if (a.kind === "support") {
      const leaf = a.props.querySelector(".turn-page");
      t.set(leaf, { svgOrigin: "145 145", scaleX: 1, opacity: 0 }, 0);
      t.to(leaf, { opacity: 1, duration: 0.25 }, 0.35);
      t.to(leaf, { scaleX: -1, duration: 1.25, ease: "sine.inOut" }, 0.5);
      t.to(leaf, { opacity: 0, duration: 0.25 }, 1.75);
      to({ r: -1.6, left: 12, right: -12, smile: 0.6 }, 0, 0.8);
      to({ r: 1.6, left: 7, right: -7 }, 0.8, 0.9);
      to({ r: 0, left: 0, right: 0, smile: 0 }, 1.7, 1);
      blink(t, p, 2.15, 1.2);
      t.to({}, { duration: 0.3 }, 2.7);
    } else {
      const check = a.svg.querySelector(".checking");
      const len = check.getTotalLength();
      t.set(check, { strokeDasharray: len, strokeDashoffset: len }, 0);
      to({ gx: 1, gy: 4, r: 2, glasses: -2 }, 0, 0.5);
      t.to(check, { strokeDashoffset: 0, duration: 0.55, ease: "power1.inOut" }, 0.55);
      to({ smile: 0.9, gy: 0, y: -1.5, r: -1, glasses: 0 }, 1, 0.45, "back.out(1.2)");
      to({ y: 2, r: 1 }, 1.45, 0.25);
      to({ y: 0, r: 0, smile: 0, gx: 0, gy: 0 }, 1.7, 0.75);
      blink(t, p, 2.1);
      t.to(check, { strokeDashoffset: len, duration: 0.35, ease: "sine.inOut" }, 2.65);
    }
    t.timeScale(1.65);
  }
  function choose(a) {
    if (!a.bag.length) {
      a.bag = [0, 1, 2];
      for (let i = 2; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a.bag[i], a.bag[j]] = [a.bag[j], a.bag[i]];
      }
      if (a.bag[0] === a.last) a.bag.push(a.bag.shift());
    }
    a.last = a.bag.shift();
    return a.last;
  }
  function schedule() {
    clearTimeout(timer);
    if (blocked()) return;
    const available = actors.filter((a) => a.visible && !a.busy && !a.loader);
    if (!available.length) return;
    const next = Math.max(nextSlot, Math.min(...available.map((a) => a.due)));
    timer = setTimeout(
      () => {
        if (blocked()) return;
        const a = actors
          .filter((a) => a.visible && !a.busy && !a.loader)
          .sort((a, b) => a.due - b.due)[0];
        if (a) ambient(a, choose(a));
      },
      Math.max(80, next - performance.now()),
    );
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const a = actors.find((a) => a.host === e.target);
        a.visible = e.isIntersecting && e.intersectionRatio >= 0.25;
        if (!a.visible) stop(a);
        else {
          a.due = performance.now() + rand(100, 750);
          if (a.loader && !blocked()) loading(a);
        }
      }
      schedule();
    },
    { threshold: [0, 0.25] },
  );
  actors = [...document.querySelectorAll(".character,[data-character-copy],[data-cast]")].map(make);
  actors.forEach((a) => {
    observer.observe(a.host);
    a.host.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "touch") signature(a);
    });
    const control = a.host.closest("button,a");
    if (control) {
      control.addEventListener("focus", () => signature(a));
      a.host.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") signature(a);
      });
      a.host.addEventListener("click", () => signature(a));
    }
  });
  const watcher = actors.find((a) => a.kind === "answers" && a.host.matches("button"));
  function restGaze() {
    if (blocked()) return;
    if (watcher)
      gsap.to(watcher.gaze, {
        x: 0,
        y: 0,
        duration: 0.4,
        overwrite: true,
        onUpdate: () => paint(watcher, watcher.state),
      });
  }
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!watcher?.visible || blocked() || e.pointerType === "touch") return;
      const b = watcher.svg.getBoundingClientRect();
      const clamp = (v, n) => Math.max(-n, Math.min(n, v));
      gsap.to(watcher.gaze, {
        x: clamp((e.clientX - b.left - b.width * 0.49) / 150, 3),
        y: clamp((e.clientY - b.top - b.height * 0.44) / 200, 1.6),
        duration: 0.38,
        ease: "power2.out",
        overwrite: true,
        onUpdate: () => paint(watcher, watcher.state),
      });
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", restGaze);
  window.addEventListener("scroll", restGaze, { passive: true });
  function reset() {
    clearTimeout(timer);
    actors.forEach((a) => {
      stop(a);
      a.due = performance.now() + rand(100, 750);
      if (a.loader && a.visible && !blocked()) loading(a);
    });
    nextSlot = 0;
    schedule();
  }
  preference.addEventListener("change", reset);
  document.addEventListener("visibilitychange", reset);
  const dialog = document.querySelector("#brief-dialog");
  if (dialog)
    new MutationObserver(reset).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  document.querySelector("[data-pause-cast]")?.addEventListener("click", (e) => {
    manualPause = !manualPause;
    e.currentTarget.setAttribute("aria-pressed", String(manualPause));
    e.currentTarget.textContent = manualPause ? "Resume motion" : "Pause motion";
    reset();
  });
  function livingTick(_time, delta) {
    if (blocked() || !document.body.hasAttribute("data-living-cast")) return;
    livingTime += Math.min(delta / 1000, 0.05);
    actors
      .filter((a) => a.visible && !a.loader)
      .forEach((a) => {
        paint(a, a.state);
      });
  }
  gsap.ticker.add(livingTick);
  window.addEventListener("pagehide", () => gsap.ticker.remove(livingTick));
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    actors.forEach(stop);
  });
  window.addEventListener("pageshow", reset);
})();
