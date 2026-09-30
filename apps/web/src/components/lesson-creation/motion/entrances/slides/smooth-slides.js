/* Slides, smooth: the chosen v4a choreography rendered continuously at display rate.
   Anime timing and acting, smooth base; the only stepped accents are a short hold on impact and
   single smear drawings mid-spin. Poses come from the flipbook engine (Flipbook.poseAt/draw) and
   are evaluated every animation frame; the drawing is reconciled into a fixed pool of SVG nodes,
   so a frame is attribute updates only. Idle (breath, blink, beats, hover) runs on the same loop,
   in the rhythm of the sign-in cast (apps/web/src/components/brand/cast-rig.ts).
   Off screen or in a hidden tab the loop stops; under reduced motion nothing starts.
   v3 (c-motion-slides-v3): begin(spec) takes an entry spec per direction. A spec may add
   `spin` (-1 turns the other way; smear drawing and ghosts follow), `hold` (impact hold ms),
   `smearUntil`, `under(p)` (drawn behind the character) and `floor` (fx flag: clip at the
   ground line, for the pop out of the floor). Without them it renders exactly as v4a-final. */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (u) => Math.max(0, Math.min(1, u));
  const sine = (u) => 0.5 - Math.cos(Math.PI * clamp01(u)) / 2;
  function mix(a, b, u) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => mix(v, b[i], u));
    if (a && b && typeof a === "object") { const o = { ...a }; for (const k in b) o[k] = k in a ? mix(a[k], b[k], u) : b[k]; return o; }
    return u < 0.5 ? a : b;
  }

  // ---------- reconciler: SVG string -> fixed node pool, attribute updates only
  const TAG = /<(\w+)\s([^>]*?)\/>/g, ATTR = /([\w:-]+)="([^"]*)"/g;
  function reconciler(group) {
    const pool = [];
    return (str) => {
      let i = 0, m;
      TAG.lastIndex = 0;
      while ((m = TAG.exec(str))) {
        let el = pool[i];
        if (!el || el.localName !== m[1]) {
          const fresh = document.createElementNS(NS, m[1]);
          fresh._a = {};
          if (el) group.replaceChild(fresh, el); else group.appendChild(fresh);
          pool[i] = el = fresh;
        }
        const seen = {};
        let a;
        ATTR.lastIndex = 0;
        while ((a = ATTR.exec(m[2]))) {
          seen[a[1]] = 1;
          if (el._a[a[1]] !== a[2]) { el.setAttribute(a[1], a[2]); el._a[a[1]] = a[2]; }
        }
        for (const k in el._a) if (!seen[k]) { el.removeAttribute(k); delete el._a[k]; }
        i++;
      }
      while (pool.length > i) pool.pop().remove();
    };
  }

  function start({ actor, spec, clips, region, side, section, shadow }) {
    const FB = window.Flipbook, P = FB.poses;
    for (const [name, over] of Object.entries({ ...(spec.poses || {}) }))
      P[name] = Object.assign(structuredClone(P.rest), over);
    const svg = actor.querySelector("svg"), base = svg.querySelector("g.body");
    const uid = `sm-${Math.random().toString(36).slice(2, 7)}`;
    svg.insertAdjacentHTML("afterbegin", `<defs><filter id="hiw-blur" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="3"/></filter><clipPath id="${uid}" clipPathUnits="userSpaceOnUse"><rect/></clipPath><clipPath id="${uid}-f" clipPathUnits="userSpaceOnUse"><path d="M-3000 -3000H3000V277H283A128 9 0 0 1 27 277H-3000Z"/></clipPath></defs>`);
    const clipRect = svg.querySelector(`#${uid} rect`);
    const group = document.createElementNS(NS, "g"), inner = document.createElementNS(NS, "g");
    const top = document.createElementNS(NS, "g");
    group.append(inner, top);
    svg.appendChild(group);
    const paint = reconciler(inner), paintTop = reconciler(top);
    const f1 = (n) => Math.round(n * 10) / 10;
    function fitClip() {
      const box = svg.getBoundingClientRect(), r = region(), k = box.width / svg.viewBox.baseVal.width;
      clipRect.setAttribute("x", f1((r.left - box.left) / k)); clipRect.setAttribute("y", f1((r.top - box.top) / k));
      clipRect.setAttribute("width", f1(r.width / k)); clipRect.setAttribute("height", f1(r.height / k));
    }

    // ---- entrance pose at time t, with the two stepped accents
    let D, IMPACT, HOLD, SPIN, SMEAR_UNTIL, KEYS;
    function useSpec(s) {
      spec = s; D = s.duration; IMPACT = s.impact;
      HOLD = s.hold ?? 50; // impact hold: the first squash drawing held ~3 frames
      SPIN = s.spin ?? 1; SMEAR_UNTIL = s.smearUntil ?? 600;
      KEYS = s.keys.map((k) => ({ ...k, quant: undefined }));
    }
    useSpec(spec);
    function entrancePose(t) {
      let te = t;
      if (t > IMPACT && t < IMPACT + HOLD) te = IMPACT + 1;
      const p = FB.poseAt(KEYS, te, spec.fx);
      // smear: a single drawing per turn, at the three-quarter-back view, only while spinning fast.
      // Turning the other way meets that view at 0.625, and the ghosts trail the other way.
      const u = p.th - Math.floor(p.th);
      p.smear = te < SMEAR_UNTIL && Math.abs(u - (SPIN > 0 ? 0.375 : 0.625)) < 0.035 ? SPIN : 0;
      p.entrance = true;
      return p;
    }
    // clips (beats and the hover spin) evaluated the same way
    const clipPose = (c, t) => {
      const p = FB.poseAt(c.keys.map((k) => ({ ...k, quant: undefined })), t, c.fx);
      if (c.smearAt) { const u = p.th - Math.floor(p.th); p.smear = t < c.smearAt && Math.abs(u - 0.375) < 0.035 ? 1 : 0; }
      return p;
    };

    // ---- idle: a continuous breath with real body deformation (cast-rig rhythm: slow sine)
    const R = structuredClone(P.rest_happy);
    const LIFT = { arms: { L: [[-137, 86, 0], [-142, 121, 0]], R: [[124, 113, 0], [125, 84, 0]] } };
    const BREATH = 3800;
    function idlePose(t, blink) {
      const ph = (t % BREATH) / BREATH;
      // in-breath a touch quicker than the out-breath
      const b = ph < 0.42 ? sine(ph / 0.42) : 1 - sine((ph - 0.42) / 0.58);
      const p = structuredClone(R);
      p.sy = 1 + 0.03 * b; p.swell = 0.03 * b;
      p.lean = 0.01 * Math.sin(Math.PI * 2 * ph) * (ph > 0.42 ? 1 : 0.3);
      p.arms = mix(R.arms, LIFT.arms, b);
      p.blink = blink; p.th = 0; p.gx = 0;
      return p;
    }
    const blinkAt = (t) => (t < 0 || t > 180 ? 0 : 1 - Math.abs(t - 90) / 90); // 0.18 s, as cast-rig

    function shadowFor(p) {
      if (!shadow) return;
      const u = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const h = clamp01(-p.ty / 180), sx = (1 - h * 0.55) * (1 + (p.swell || 0) * 1.2), sy = 1 - h * 0.55;
      const tx = p.tx * u;
      shadow.style.transform = Math.abs(tx) < 0.01 && Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 ? "" : `translateX(${f1(tx)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      // below the floor (the pop entry) the shadow waits in the hole until the card is out
      const under = p.entrance && spec.under && p.ty > 0 ? clamp01(1 - p.ty / 60) : null;
      shadow.style.opacity = under != null ? String(f1(under * 100) / 100) : h ? String(f1((1 - h * 0.6) * 100) / 100) : "";
    }
    const far = (p) => Math.abs(p.tx) > 1 || Math.abs(p.ty) > 1 || p.smear || p.swirl || p.fall || p.lines || p.ring != null || p.dust != null || p.papers != null;

    function render(p) {
      p.noShadow = true;
      paint((p.entrance && spec.under ? spec.under(p) : "") + FB.draw(p, 0));
      paintTop(p.entrance && spec.over ? spec.over(p) : ""); // drawn over the character, unclipped by the floor
      if (far(p) || p.hole) group.setAttribute("clip-path", `url(#${uid})`); else group.removeAttribute("clip-path");
      if (p.floor) inner.setAttribute("clip-path", `url(#${uid}-f)`); else inner.removeAttribute("clip-path");
      shadowFor(p);
    }

    // ---- state + loop
    let mode = "entrance", t0 = 0, idle0 = 0, clip = null, clipFrom = null, raf = 0, onScreen = true;
    let nextBlink = 0, nextBeat = 0, beat = "hop", lastBurst = -1e9, shakeAnims = [];
    const perf = (window.__smoothPerf = { frames: 0, total: 0, max: 0 });
    const live = () => onScreen && document.visibilityState === "visible" && !reduced.matches;

    function shake(at, dur, amp) {
      const kf = [], n = Math.round((dur / 1000) * 30);
      for (let k = 0; k <= n; k++) {
        const a = amp * (1 - k / n);
        kf.push({ translate: k === n ? "0 0" : `${f1((k % 2 ? -1 : 1) * a * (0.6 + Math.random() * 0.4))}px ${f1((Math.random() - 0.5) * a * 1.2)}px` });
      }
      shakeAnims.push(side.animate(kf, { delay: at, duration: dur, easing: "linear" }));
    }

    function frame(now) {
      raf = 0;
      if (!live()) return;
      const s0 = performance.now();
      let p;
      if (mode === "entrance") {
        const t = now - t0;
        if (t >= D) { mode = "idle"; idle0 = now; nextBlink = now + rnd(1500, 3000); nextBeat = now + rnd(10000, 15000); }
        else p = entrancePose(t);
      }
      if (mode === "clip") {
        const t = now - t0;
        if (t >= clip.duration) { mode = "idle"; idle0 = now; clip = null; }
        else {
          p = clipPose(clip, t);
          if (clipFrom && t < 140) p = mix(clipFrom, p, sine(t / 140)); // ease out of the breath
        }
      }
      if (mode === "idle") {
        if (now >= nextBeat) {
          nextBeat = now + rnd(10000, 15000);
          play(beat, now); beat = beat === "hop" ? "glance" : "hop";
          return schedule();
        }
        if (now >= nextBlink + 180) nextBlink = now + rnd(3000, 5000);
        p = idlePose(now - idle0, blinkAt(now - nextBlink));
      }
      render(p);
      const cost = performance.now() - s0;
      perf.frames++; perf.total += cost; perf.max = Math.max(perf.max, cost);
      schedule();
    }
    const schedule = () => { if (!raf && live()) raf = requestAnimationFrame(frame); };

    function play(name, now = performance.now()) {
      if (mode !== "idle") return false;
      clipFrom = idlePose(now - idle0, 0);
      clip = clips[name]; mode = "clip"; t0 = now;
      schedule();
      return true;
    }

    function begin(next) {
      if (next) useSpec(next);
      for (const a of shakeAnims) a.cancel();
      shakeAnims = [];
      fitClip();
      mode = "entrance"; t0 = performance.now(); clip = null;
      base.style.visibility = "hidden"; // the drawing takes over; hidden, not faded (see flipbook.js)
      for (const s of spec.shake || []) shake(s.at, s.dur, s.amp);
      schedule();
    }

    new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); schedule(); }).observe(section);
    document.addEventListener("visibilitychange", schedule);
    addEventListener("resize", () => mode === "entrance" && fitClip());
    const burst = () => {
      const now = performance.now();
      if (!live() || now - lastBurst < 2500) return;
      if (play("burst", now)) lastBurst = now;
    };
    actor.style.pointerEvents = "auto";
    actor.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && burst());
    actor.addEventListener("pointerdown", burst);

    // scrubbing for the fidelity page and filmstrips: render the entrance at t, loop paused
    const seek = (t) => { onScreen = false; if (raf) cancelAnimationFrame(raf); raf = 0; base.style.visibility = "hidden"; render(t >= D ? idlePose(0, 0) : entrancePose(t)); };
    const resume = () => { onScreen = true; schedule(); };
    return { begin, play, seek, resume, get duration() { return D; }, get spec() { return spec; }, entrancePose, render };
  }

  window.SmoothSlides = { start };
})();
