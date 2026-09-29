/* Plan, smooth: the v2 choreography evaluated every display frame (PlanRig.poseAt/draw) and painted
   into a fixed pool of SVG <path> nodes, so a frame is attribute updates only (plus a transform on
   the one shadow element). Anime accents stay stepped: spec.holds freezes a drawing for a few frames
   (the plie bottom), and fast cover strokes leave ghost smears. The entrance direction is a spec per
   side (spec.byFrom[from]). Off screen or in a hidden tab the loop stops; under reduced motion it never
   starts and the rest artwork shows. At the end the rest artwork takes over (visibility, not opacity). */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const TAG = /<path\s([^>]*?)\/>/g, ATTR = /([\w:-]+)="([^"]*)"/g;
  const f1 = (n) => Math.round(n * 10) / 10;
  const clamp01 = (u) => Math.max(0, Math.min(1, u));

  // fixed pool of <path> nodes; unused nodes are hidden, never removed
  function pool(group, size) {
    const nodes = [];
    const grow = () => { const el = document.createElementNS(NS, "path"); el._a = { visibility: "hidden" }; el.setAttribute("visibility", "hidden"); group.appendChild(el); nodes.push(el); };
    for (let i = 0; i < size; i++) grow();
    return (str) => {
      let i = 0, m;
      TAG.lastIndex = 0;
      while ((m = TAG.exec(str))) {
        if (i >= nodes.length) grow();
        const el = nodes[i], seen = { visibility: 1 };
        let a;
        ATTR.lastIndex = 0;
        while ((a = ATTR.exec(m[1]))) {
          seen[a[1]] = 1;
          if (el._a[a[1]] !== a[2]) { el.setAttribute(a[1], a[2]); el._a[a[1]] = a[2]; }
        }
        if (el._a.visibility !== "visible") { el.setAttribute("visibility", "visible"); el._a.visibility = "visible"; }
        for (const k in el._a) if (!seen[k]) { el.removeAttribute(k); delete el._a[k]; }
        i++;
      }
      for (; i < nodes.length; i++) if (nodes[i]._a.visibility !== "hidden") { nodes[i].setAttribute("visibility", "hidden"); nodes[i]._a.visibility = "hidden"; }
    };
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  // v6: a flag the change listener keeps; never read .matches per frame (Chromium can drop the event)
  let RM = reduced.matches;
  function start({ actor, specs, region, section, shadow, onEnd }) {
    const R = window.PlanRig;
    const svg = actor.querySelector("svg"), base = svg.querySelector("g.body");
    const uid = `pl-${Math.random().toString(36).slice(2, 7)}`;
    svg.insertAdjacentHTML("afterbegin", `<defs><clipPath id="${uid}" clipPathUnits="userSpaceOnUse"><rect/></clipPath><clipPath id="${uid}g" clipPathUnits="userSpaceOnUse"><rect x="-3000" y="-3000" width="6000" height="${3000 + R.GROUND + 1}"/></clipPath></defs>`);
    const clipRect = svg.querySelector(`#${uid} rect`);
    const outer = document.createElementNS(NS, "g"), groundG = document.createElementNS(NS, "g"), bodyG = document.createElementNS(NS, "g");
    outer.append(groundG, bodyG); svg.appendChild(outer);
    const paintGround = pool(groundG, 34), paintBody = pool(bodyG, 40);
    let clipOn = null, groundOn = null, regionBox = null;
    function fitClip() {
      const box = svg.getBoundingClientRect(), r = region(), k = box.width / svg.viewBox.baseVal.width;
      regionBox = [(r.left - box.left) / k, (r.top - box.top) / k, (r.right - box.left) / k, (r.bottom - box.top) / k];
      clipRect.setAttribute("x", f1(regionBox[0])); clipRect.setAttribute("y", f1(regionBox[1]));
      clipRect.setAttribute("width", f1(regionBox[2] - regionBox[0])); clipRect.setAttribute("height", f1(regionBox[3] - regionBox[1]));
    }

    let spec = null, D = 0;
    const remap = (t) => {
      // stepped accent: hold a drawing for `dur` ms at `at`, then catch up by `until` (no jump)
      for (const [at, dur, until] of spec.holds || []) {
        if (t >= at && t < at + dur) return at;
        if (t >= at + dur && t < until) return at + ((t - at - dur) * (until - at)) / (until - at - dur);
      }
      return t;
    };
    function poseFor(t) {
      const te = remap(t), p = R.poseAt(spec, te), ghosts = [];
      for (const [dt, o] of [[20, 0.4], [40, 0.22]]) {
        if (te - dt < 0) continue;
        if (dt === 40 && p.lim < 0.5) continue; // v6b: a closed book smears once, not a lattice
        const g = R.poseAt(spec, te - dt);
        if (Math.abs(g.cL - p.cL) > 0.07 || Math.abs(g.cR - p.cR) > 0.07) ghosts.push([g, o]);
        else if (dt === 20 && p.lim > 0.5 && Math.abs(g.pitch - p.pitch) > 0.22) ghosts.push([g, 0.3]); // v6: the spring smears once, one ghost
      }
      return [p, ghosts];
    }

    function shadowFor(p) {
      if (!shadow) return;
      const u = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const lift = -(p.ty + p.bob) * (1 - (p.gnd || 0));
      const h = clamp01(lift / 400);
      let s = 1 - h * 0.8; // grows as it comes down
      // it only exists on stage: none while Plan is outside the region or still under the ground
      const cx = R.CX + p.tx, [x0, , x1] = regionBox;
      s *= clamp01((cx - x0 - 40) / 80) * clamp01((x1 - cx - 40) / 80);
      if (lift < 0) s *= clamp01(1 + lift / 120);
      s *= clamp01((340 - lift) / 140); // no shadow until it is close enough to cast one
      const tx = p.tx * u;
      shadow.style.transform = Math.abs(tx) < 0.01 && Math.abs(s - 1) < 1e-4 ? "" : `translateX(${f1(tx)}px) scale(${s.toFixed(4)})`;
    }

    function render(p, ghosts) {
      const d = R.draw(p, spec, ghosts);
      paintGround(d.ground); paintBody(d.body);
      const far = Math.abs(p.tx) > 1 || Math.abs(p.ty + p.bob) > 1 || p.route || p.slot > 0.01;
      if (far !== clipOn) { clipOn = far; if (far) outer.setAttribute("clip-path", `url(#${uid})`); else outer.removeAttribute("clip-path"); }
      const g = !!p.clipGround;
      if (g !== groundOn) { groundOn = g; if (g) bodyG.setAttribute("clip-path", `url(#${uid}g)`); else bodyG.removeAttribute("clip-path"); }
      shadowFor(p);
    }
    function handOff() {
      paintGround(""); paintBody("");
      base.style.visibility = "";
      if (shadow) shadow.style.transform = "";
    }

    let t0 = 0, raf = 0, running = false, onScreen = true;
    const perf = (window.__smoothPerf = { frames: 0, total: 0, max: 0 });
    const live = () => onScreen && document.visibilityState === "visible" && !RM;
    function frame(now) {
      raf = 0;
      if (!running) return;
      if (!live()) return;
      const s0 = performance.now(), t = now - t0;
      // v6: from the rest key on, the artwork itself is the drawing (0 px handoff, no seam at the end)
      if (t >= D || (spec.restAt != null && t >= spec.restAt)) { running = false; handOff(); if (onEnd) onEnd(); return; }
      render(...poseFor(t));
      const cost = performance.now() - s0;
      perf.frames++; perf.total += cost; perf.max = Math.max(perf.max, cost);
      schedule();
    }
    const schedule = () => { if (!raf && running && live()) raf = requestAnimationFrame(frame); };

    // reduced motion switched on mid-entrance: stop and put the rest artwork back
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; handOff(); };
    reduced.addEventListener("change", (e) => { RM = e.matches; if (RM) stop(); });
    const pick = (from) => {
      const s = specs[from] || specs.right, r = region(), a = actor.getBoundingClientRect(), k = a.width / 300;
      return typeof s === "function" ? s({ stageAtScreenEdge: r.left <= 1, room: { left: (a.left - Math.max(r.left, 0)) / k, right: (Math.min(r.right, innerWidth) - a.right) / k } }) : s;
    };
    function begin(from) {
      if (RM) return stop();
      spec = pick(from); D = spec.duration;
      fitClip();
      t0 = performance.now(); running = true;
      base.style.visibility = "hidden";
      render(...poseFor(0));
      schedule();
    }
    new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); schedule(); }).observe(section);
    document.addEventListener("visibilitychange", schedule);
    addEventListener("resize", () => running && fitClip());

    // scrubbing for filmstrips: render direction `from` at t with the loop paused
    const seek = (from, t) => {
      running = false; if (raf) cancelAnimationFrame(raf); raf = 0;
      spec = pick(from); D = spec.duration; fitClip();
      if (t >= D || (spec.restAt != null && t >= spec.restAt)) return handOff();
      base.style.visibility = "hidden";
      render(...poseFor(t));
    };
    return { begin, seek, get duration() { return D; }, get running() { return running; }, specs };
  }

  window.SmoothPlan = { start };
})();
