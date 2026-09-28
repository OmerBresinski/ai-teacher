/* Closing CTA: the Check character steps in once from the right, the first time the block is in
   view, then stays alive at rest (UX rulings 114 and 115). Check's persona is precise: measured
   steps, exact stops, no hops and no frame shake. At rest it breathes (drawn, feet planted), blinks
   (drawn half lids), turns its raised hand now and then, and every 12-20 s plays one beat: pushing
   its glasses up, a small left-right inspection, or tapping its tick twice. On hover or tap it looks
   over its glasses at the pointer (at most once every 4 s); that look also comes up on its own,
   about one beat in three or four, never twice running and at least 20 s apart.
   The rest drawing is the artwork, so every handoff is exact. Off screen or in a hidden tab nothing
   runs and the clock pauses. Reduced motion, at any moment: everything stops and the artwork shows
   at rest; switching it back resumes only the resting life. On a phone the character is hidden, so
   nothing starts. The rig is motion/check.js; the node pool and easing are Flipbook.kit. */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const FB = window.CheckFlipbook,
    CS = window.CheckSmooth,
    M = FB.model;
  const f1 = (n) => Math.round(n * 10) / 10;
  const { reconciler, clamp01, sine, between } = window.Flipbook.kit;
  const EASE = { lin: (u) => u, io: sine, in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u) };
  const STEP = { eyes: 1, mouth: 1, brows: 1 };
  function mix(a, b, u) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
      return a.map((v, i) => mix(v, b[i], u));
    if (a && b && typeof a === "object" && !Array.isArray(a)) {
      const o = {};
      for (const k in a) o[k] = k in b ? mix(a[k], b[k], u) : a[k];
      return o;
    }
    return a;
  }
  // keys: { t, ease, cut, ...pose }. A `cut` key is jumped to on its time (a stepped accent); drawn
  // states (eyes, mouth, brows) change on the key they belong to.
  function interp(keys, t) {
    const j = keys.findIndex((k) => k.t > t);
    if (j === -1) return structuredClone(keys[keys.length - 1]);
    if (j === 0) return structuredClone(keys[0]);
    const a = keys[j - 1],
      b = keys[j];
    if (b.cut) return structuredClone(a);
    const p = mix(a, b, (EASE[b.ease] || EASE.io)(clamp01((t - a.t) / (b.t - a.t))));
    for (const f in STEP) p[f] = a[f];
    return p;
  }

  // ---------- the resting script: a pure function of the time since the rest began (seeded)
  const rng = (seed) => {
    let x = seed >>> 0 || 1;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 4294967296;
    };
  };
  const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
  // the breath is evaluated at 30 Hz and painted only when some part has moved a visible
  // amount (a quarter of an artwork unit, about 0.2 px): the same motion at about a quarter of the cost
  const qa = (n) => Math.round(n * 4);
  const sig = (p) =>
    [
      p.sy * 160,
      p.sx * 160,
      p.bulge * 160,
      p.glassesY,
      p.eyeDy,
      ...p.arms.L.flat(),
      ...p.arms.R.flat(),
    ]
      .map(qa)
      .join(",") + p.eyes;
  let lastSig = "";
  const BREATH_MS = 1000 / 30; // the breath is evaluated at 30 Hz: a quarter-unit step every 2-3 ticks at its fastest
  function script(seed) {
    const r = rng(seed),
      B = [],
      K = [];
    let bt = 500 + r() * 500,
      kt = 1400 + r() * 1600;
    function ensure(T) {
      while (bt < T + 15000) {
        const inh = 1250 + r() * 400,
          hold = 150 + r() * 150,
          exh = 1600 + r() * 500,
          gap = 450 + r() * 450;
        B.push({
          s: bt,
          inh,
          hold,
          exh,
          d: 0.014 + r() * 0.007,
          A: 0.8 + r() * 0.9,
          roll: B.length % 3 === 2,
          end: bt + inh + hold + exh + 700,
        });
        bt += inh + hold + exh + gap;
      }
      while (kt < T + 15000) {
        const slow = r() < 0.22,
          len = slow ? 205 + r() * 10 : 160 + r() * 25; // 150-200 ms, a slower one now and then
        K.push({ s: kt, end: kt + len });
        kt += len + 2800 + r() * 4200;
      }
    }
    return { B, K, ensure };
  }
  const find = (arr, t) => {
    let lo = 0,
      hi = arr.length - 1,
      i = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (arr[m].s <= t) {
        i = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return i;
  };
  function breathCurve(e, x) {
    if (x <= 0) return 0;
    if (x < e.inh) return smoother(x / e.inh); // eases in slowly
    x -= e.inh;
    if (x < e.hold) return 1; // a brief hold at the top
    x -= e.hold;
    if (x < e.exh) {
      const u = x / e.exh;
      return (1 - u) ** 3 * (1 + 3 * u);
    } // the sigh: lets go, then a long settle
    return 0;
  }
  const add = (pt, dx, dy) => [pt[0] + dx, pt[1] + dy, pt[2]];

  // ---------- beats: anticipation, the action at a slow, deliberate pace, a hold, and back to rest
  function clipKeys(name, rest, dir = 1) {
    const K = (t, o = {}) => Object.assign(structuredClone(rest), o, { t });
    const withR = (R) => ({ arms: { L: rest.arms.L, R } });
    // the glasses push, shared by two beats, deliberate (about 550 ms): a finger reaches for the bridge,
    // a small dip, the glasses slide up easing out as the brow settles, a tiny settle with a glint
    const push = (t0, from) => {
      const gy = from.glassesY || 0,
        hand = (dy) =>
          withR([
            [244, 196 + dy, 20],
            [160, 136 + gy + dy, 24],
          ]);
      return [
        K(t0 + 300, { ...from, ...hand(0), ease: "io" }),
        K(t0 + 420, { ...from, ...hand(3), glassesY: gy + 1, sy: 0.992, ease: "io" }),
        K(t0 + 620, {
          ...withR([
            [240, 184, 20],
            [158, 128, 24],
          ]),
          glassesY: -0.8,
          brows: from.brows || 0,
          browUp: 0.08,
          sy: 1.008,
          glint: 0.7,
          ease: "out",
        }),
        K(t0 + 770, {
          ...withR([
            [248, 170, 12],
            [196, 128, 16],
          ]),
          eyes: "wide",
          glint: 1,
          brows: 0,
          browUp: 0,
          ease: "io",
        }),
        K(t0 + 1050, { glint: 0.35, ease: "io" }),
        K(t0 + 1250, { glint: 0, ease: "io" }),
      ];
    };
    if (name === "push") {
      // the glasses have slipped a little; it notices, and puts them right
      const SLIP = { glassesY: 4, glassesTilt: 0.03, eyeDy: -2, mouth: "flat" };
      return {
        duration: 2000,
        keys: [K(0), K(450, { ...SLIP, ease: "io" }), K(700, SLIP), ...push(700, SLIP)],
      };
    }
    if (name === "inspect") {
      // a small, slow look left, a hold, a look right, a hold, back: checking the room is in order
      // v5: a small settle first (anticipation); the eyes snap ahead (90 ms, out) and the head follows
      // 90 ms behind them (in-out); each hold drifts; the eyes come home before the head
      const e = (dx, o = {}) => ({
        eyeDx: dx,
        eyeDy: 0.5,
        mouth: "flat",
        sy: 0.995,
        drop: 0.5,
        ...o,
      });
      return {
        duration: 2350,
        keys: [
          K(0),
          K(110, { eyeDy: 0.4, sy: 0.99, drop: 0.9, mouth: "flat", ease: "io" }),
          K(200, { ...e(-3.4), head: 0, sy: 0.99, drop: 0.9, ease: "out" }),
          K(500, { ...e(-3.2), head: -0.015, ease: "io" }),
          K(900, { ...e(-3.1, { eyeDy: 0.9, sy: 0.998, drop: 0.3 }), head: -0.018, ease: "io" }),
          K(990, { ...e(3.4, { eyeDy: 0.9, sy: 0.998, drop: 0.3 }), head: -0.018, ease: "out" }),
          K(1300, { ...e(3.2), head: 0.015, ease: "io" }),
          K(1800, { ...e(3.1, { eyeDy: 0.9, sy: 0.998, drop: 0.3 }), head: 0.018, ease: "io" }),
          K(1890, { eyeDx: 0, eyeDy: 0.3, head: 0.018, mouth: "flat", ease: "out" }),
          K(2250, { ease: "io" }),
          K(2350),
        ],
      };
    }
    if (name === "tap") {
      // eyes down to its tick; the finger comes over and taps it twice, slowly; satisfied
      const look = { eyeDy: 4.5, eyeDx: -2.5, mouth: "flat" };
      const over = {
        ...look,
        arms: {
          L: [
            [70, 226, 22],
            [140, 176, 22],
          ],
          R: rest.arms.R,
        },
      };
      const on = {
        ...look,
        sy: 0.992,
        arms: {
          L: [
            [72, 230, 22],
            [139, 184, 22],
          ],
          R: rest.arms.R,
        },
      };
      const high = {
        ...look,
        sy: 1.012,
        drop: -1,
        arms: {
          L: [
            [68, 214, 20],
            [134, 158, 22],
          ],
          R: rest.arms.R,
        },
      };
      const firm = {
        ...look,
        eyes: "closed",
        sy: 0.94,
        sx: 1.035,
        bulge: 0.02,
        drop: 2.5,
        arms: {
          L: [
            [73, 232, 22],
            [139, 186, 22],
          ],
          R: [
            [251, 162, 0],
            [250, 134, 0],
          ],
        },
      };
      return {
        duration: 2200,
        keys: [
          K(0),
          K(300, { ...look, ease: "io" }),
          K(700, { ...over, ease: "io" }),
          K(820, { ...on, ease: "in" }),
          K(900, on),
          K(1080, { ...high, ease: "out" }),
          K(1160, { ...firm, ease: "in" }),
          K(1210, firm),
          K(1290, {
            ...firm,
            sy: 0.946,
            sx: 1.03,
            drop: 2.1,
            bulge: 0.016,
            spark: 0.4,
            ease: "io",
          }),
          K(1480, { ...over, eyeDy: 2, spark: 0.85, ease: "out" }),
          K(1700, { eyes: "happy", sy: 1.01, spark: 1, ease: "io" }),
          K(1950, { eyes: "happy", sy: 1.03, drop: -1.5, ease: "io" }),
          K(2150, { ease: "io" }),
          K(2200),
        ],
      };
    }
    // look (hover or tap): the glasses slide down its nose, it looks over the rims at the pointer, the
    // eyebrow goes up slowly and stays up a beat; then it pushes the glasses back up
    const LOOK = {
      glassesY: 12,
      glassesTilt: 0.03,
      eyeDy: -7,
      eyeDx: 2.2 * dir,
      drop: 1.6,
      sy: 0.994,
      head: 0.004 * dir,
      mouth: "tight",
      brows: 1,
      browUp: 0,
    };
    return {
      duration: 2850,
      keys: [
        K(0),
        K(420, { ...LOOK, brows: 0, ease: "io" }),
        K(430, LOOK),
        K(800, { ...LOOK, eyeDy: -7.3 }),
        K(1150, { ...LOOK, eyeDy: -7.4, browUp: 1, ease: "io" }),
        K(1550, { ...LOOK, eyeDy: -7.6, browUp: 1.06, ease: "io" }),
        ...push(1550, { ...LOOK, browUp: 1.06 }),
        K(2850),
      ],
    };
  }

  function start({ actor, region, section }) {
    const svg = actor.querySelector("svg"),
      base = svg.querySelector("g.body");
    // drawn the way the ambient cast draws every other character: 2-unit strokes
    svg.style.strokeWidth = "2";
    const uid = `ck-${Math.random().toString(36).slice(2, 7)}`;
    svg.insertAdjacentHTML(
      "afterbegin",
      `<defs><filter id="hiw-blur" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="3"/></filter><clipPath id="${uid}" clipPathUnits="userSpaceOnUse"><rect/></clipPath></defs>`,
    );
    const clipRect = svg.querySelector(`#${uid} rect`);
    const group = document.createElementNS(NS, "g");
    group.setAttribute("clip-path", `url(#${uid})`);
    group.style.visibility = "hidden";
    svg.appendChild(group);
    const paint = reconciler(group);
    // one shadow for the whole page: the rig's rest shadow replaces the page's CSS shadow in the
    // artwork, so the art at rest and the rig at rest are the same pixels
    const restShadow = document.createElementNS(NS, "g");
    restShadow.innerHTML = FB.draw(FB.full({ th: 0, head: 0 }), 0).match(/<ellipse[^>]*\/>/)[0];
    svg.insertBefore(restShadow, base);

    // ---- clip: the region, ending at the margin line while it is up and just under the ground marks
    let box = null,
      clipX = "",
      clipW = "",
      clipH = "";
    function measure() {
      const b = svg.getBoundingClientRect(),
        r = region(),
        k = b.width / svg.viewBox.baseVal.width;
      box = {
        x: (r.left - b.left) / k,
        y: (r.top - b.top) / k,
        r: (r.right - b.left) / k,
        b: (r.bottom - b.top) / k,
      };
      clipX = clipW = clipH = "";
      clipRect.setAttribute("y", f1(box.y));
      return { left: (32 - box.x) / 2, right: (box.r - 270) / 2, box };
    }
    let lastPose = null;
    function render(p, i = 0) {
      paint(FB.draw(p, i));
      let x0 = box.x,
        x1 = box.r;
      if (p.wingA > 0) {
        const X = M.cx + p.wing;
        if (p.wing > 0) x1 = Math.min(x1, X + 1);
        else x0 = Math.max(x0, X - 1);
      }
      const sx = String(f1(x0)),
        sw = String(f1(x1 - x0));
      if (sx !== clipX) {
        clipRect.setAttribute("x", sx);
        clipX = sx;
      }
      if (sw !== clipW) {
        clipRect.setAttribute("width", sw);
        clipW = sw;
      }
      const bottom = Math.min(box.b, p.floor ? FB.FLOOR : FB.GROUND + 16),
        h = String(f1(bottom - box.y));
      if (h !== clipH) {
        clipRect.setAttribute("height", h);
        clipH = h;
      }
      lastPose = p;
    }

    // ---- poses
    const rest = () => FB.full({ th: 0, head: 0 });
    let S = script(7);
    function idleAt(t, blinkOff) {
      S.ensure(t);
      const p = rest();
      let busy = false,
        next = Infinity,
        blink = 0;
      const bi = find(S.B, t),
        e = bi >= 0 ? S.B[bi] : null;
      if (S.B[bi + 1]) next = S.B[bi + 1].s;
      if (e && t < e.end) {
        busy = true;
        const x = t - e.s,
          k = e.d / 0.014;
        const c = breathCurve(e, x),
          cS = breathCurve(e, x - 120),
          cH = breathCurve(e, x - 200),
          cF = breathCurve(e, x - 300);
        p.sy = 1 + e.d * c;
        p.sx = 1 + 0.22 * e.d * c;
        p.bulge = 0.25 * e.d * c; // the chest leads
        const up = -1.9 * cS * k,
          hand = -1.3 * cH * k; // the shoulders, then the hands
        // the fidget: the raised left hand turns a small, slow arc once a breath, 450 ms behind it;
        // every third breath the fingers roll once (a slow drum in the air)
        const len = e.inh + e.hold + e.exh,
          w = clamp01((x - 450) / len),
          sw = Math.sin(Math.PI * w);
        const fx = e.roll ? 0.9 * e.A * Math.sin(2 * Math.PI * w) : -e.A * sw,
          fy = e.roll ? -0.8 * e.A * sw * Math.cos(Math.PI * w) : -0.5 * e.A * sw;
        p.arms = {
          L: [
            add(p.arms.L[0], -0.6 * cH * k + fx * 0.35, up + fy * 0.35),
            add(p.arms.L[1], -0.9 * cH * k + fx, up + hand + fy),
          ],
          R: [add(p.arms.R[0], 0.6 * cH * k, up), add(p.arms.R[1], 0.9 * cH * k, up + hand)],
        };
        p.glassesY = 0.55 * (c - cF) * 4 * k + 0.25 * cF * k; // the glasses lag the face, then settle a hair
        p.eyeDy = -0.3 * cF * k;
      }
      const ki = find(S.K, t),
        kb = ki >= 0 ? S.K[ki] : null;
      if (S.K[ki + 1]) next = Math.min(next, S.K[ki + 1].s);
      if (!blinkOff && kb && t < kb.end) {
        // a drawn blink: the lid half down, shut, half up (a quick close, a slower open)
        const u = (t - kb.s) / (kb.end - kb.s),
          len = kb.end - kb.s;
        blink = u < 0.25 ? 1 : u < 0.7 ? 2 : 3;
        p.eyes = blink === 2 ? "closed" : "half";
        next = Math.min(next, kb.s + (blink === 1 ? 0.25 : blink === 2 ? 0.7 : 1) * len);
      }
      if (e && t < e.end) next = Math.min(next, e.end);
      return { p, busy, blink, next };
    }
    const idlePose = (t, blinkOff) => idleAt(t, blinkOff).p;
    let clip = null,
      from = null;
    function clipPose(t) {
      let p = interp(clip.keys, t);
      if (from && t < 180) {
        const q = mix(from, p, sine(t / 180));
        for (const f in STEP) q[f] = p[f];
        p = q;
      } // out of the breath from the drawing on screen
      return p;
    }

    // ---- state and loop
    let tl = null,
      mode = "waiting",
      t0 = 0,
      idle0 = 0,
      raf = 0,
      timer = 0,
      pausedAt = 0,
      frozen = false;
    let onScreen = true,
      lastPaint = 0,
      lastKey = "";
    let beatAt = 0,
      beatIx = 0,
      lastHover = -1e9;
    const reducedMQ = matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reducedMQ.matches;
    const live = () => onScreen && !frozen && document.visibilityState === "visible" && !reduce;
    const moving = () => mode === "entrance" || mode === "clip" || mode === "idle";

    function wake() {
      clearTimeout(timer);
      timer = 0;
      const now = performance.now();
      if (!moving()) return;
      if (!live()) {
        cancelAnimationFrame(raf);
        raf = 0;
        if (!pausedAt) pausedAt = now;
        return;
      }
      if (pausedAt) {
        const d = now - pausedAt;
        pausedAt = 0;
        t0 += d;
        idle0 += d;
        beatAt += d;
        lastPaint += d;
      }

      if (!raf) raf = requestAnimationFrame(frame);
    }
    const sleepUntil = (at, now) => {
      clearTimeout(timer);
      timer = setTimeout(wake, Math.max(0, at - now));
    };
    function beginIdle(now) {
      mode = "idle";
      clip = from = null;
      idle0 = now;
      lastKey = "";
      S = script((Math.random() * 4294967296) >>> 0); // each rest is its own performance
      if (!beatAt || beatAt < now) beatAt = now + between(12000, 20000);
    }
    function play(name, now, dir) {
      if (mode !== "idle") return false;
      from = lastPose ? structuredClone(lastPose) : idlePose(now - idle0, true);
      clip = { name, ...clipKeys(name, rest(), dir) };
      mode = "clip";
      t0 = now;
      return true;
    }
    const ORDER = ["push", "inspect", "tap"];
    // v5b: the hover look also plays on its own, rarely, for people who never hover: after 2 other beats
    // (half the time) or 3 (always), never back to back, and at least 20 s after the last look of any kind
    let sinceLook = 0,
      lastLook = -1e9;
    function nextBeat(now) {
      const ok = now - Math.max(lastLook, lastHover) >= 20000 && sinceLook >= 2;
      if (ok && (sinceLook >= 3 || Math.random() < 0.5)) {
        sinceLook = 0;
        return ["look", Math.random() < 0.5 ? -1 : 1];
      }
      sinceLook++;
      return [ORDER[beatIx++ % 3], 1];
    }
    function frame(now) {
      raf = 0;
      if (!live() || !moving()) return wake();
      let p = null,
        fast = false,
        seed = 0;
      if (mode === "entrance") {
        const t = now - t0;
        if (t < tl.duration) {
          p = CS.poseAt(tl, t);
          fast = true;
        } else beginIdle(now);
      }
      if (mode === "clip") {
        const t = now - t0;
        if (t < clip.duration) {
          p = clipPose(t);
          fast = true;
        } else beginIdle(now);
      }
      if (mode === "idle") {
        if (now >= beatAt) {
          beatAt = now + between(12000, 20000);
          const [nm, d] = nextBeat(now);
          if (play(nm, now, d)) {
            if (nm === "look") lastLook = now;
            p = clipPose(0);
            fast = true;
          }
        }
        if (mode === "idle") {
          const t = now - idle0,
            st = idleAt(t),
            key = `${st.busy}|${st.blink}`;
          // 15 fps for the slow breath, one paint per blink edge, one paint to land on the still
          // drawing, then nothing until the next event
          // the breath is evaluated every display frame (unchanged attributes are skipped by the
          // reconciler); a blink edge or the landing on the still drawing paints once; between
          // breaths nothing runs until the next event
          if (st.busy) {
            const g = sig(st.p);
            if (g !== lastSig || key !== lastKey) {
              p = st.p;
              lastKey = key;
              lastSig = g;
            }
          } else if (!lastPaint || key !== lastKey) {
            p = st.p;
            lastKey = key;
          }
          sleepUntil(Math.min(st.busy ? now + BREATH_MS : idle0 + st.next, beatAt), now);
        }
      }
      if (p) {
        render(p, seed);
        lastPaint = now;
      }
      if (fast) raf = requestAnimationFrame(frame);
    }

    // ---- reduced motion, at any moment: stop everything, the original artwork back at rest
    function showArt(art) {
      group.style.visibility = art ? "hidden" : "visible";
      base.style.visibility = art ? "" : "hidden";
      restShadow.style.visibility = art ? "" : "hidden";
    }
    function still() {
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(timer);
      timer = 0;
      pausedAt = 0;
      clip = from = null;
      showArt(true);
      mode = "still";
    }
    function resume() {
      // motion allowed again: the resting life only; the entrance never replays
      const now = performance.now();
      measure();
      beatAt = 0;
      beginIdle(now);
      render(idlePose(0, true));
      lastPaint = now;
      lastKey = "";
      showArt(false);
      wake();
    }
    reducedMQ.addEventListener("change", () => {
      reduce = reducedMQ.matches;
      if (reduce) {
        if (moving()) still();
        else if (mode === "waiting") mode = "still";
      } else if (mode === "still" && tl) resume();
    });

    function begin(dir = "right") {
      tl = CS.timeline(dir, measure());
      if (reduce) {
        mode = "still";
        return null;
      }
      beatAt = 0;
      pausedAt = 0;
      frozen = false;
      lastPaint = 0;
      mode = "entrance";
      t0 = performance.now();
      clip = from = null;
      render(CS.poseAt(tl, 0));
      showArt(false);
      wake();
      return tl;
    }

    new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting);
      wake();
    }).observe(section);
    document.addEventListener("visibilitychange", wake);
    addEventListener("resize", () => {
      if (moving()) {
        measure();
        if (lastPose) render(lastPose);
      }
    });
    // hover or tap: the look over the glasses at the pointer, rate-limited; pointer only (decorative)
    const look = (e) => {
      const now = performance.now();
      if (!live() || now - lastHover < 4000) return;
      const r = svg.getBoundingClientRect(),
        dir = e.clientX < r.left + r.width * 0.5 ? -1 : 1;
      if (play("look", now, dir)) {
        lastHover = now;
        sinceLook = 0;
        beatAt = Math.max(beatAt, now + 7000);
        wake();
      }
    };
    actor.style.pointerEvents = "auto";
    actor.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && look(e));
    actor.addEventListener("pointerdown", look);

    // review and measurement: play a beat now; freeze the loop and draw any moment exactly
    return {
      begin,
      get mode() {
        return mode;
      },
      get timeline() {
        return tl;
      },
      play(name, dir = 1) {
        const now = performance.now();
        if (play(name, now, dir)) {
          beatAt = Math.max(beatAt, now + 7000);
          wake();
          return true;
        }
        return false;
      },
      freeze() {
        frozen = true;
        cancelAnimationFrame(raf);
        raf = 0;
        clearTimeout(timer);
      },
      entrance(t) {
        showArt(false);
        render(CS.poseAt(tl, t));
      },
      idle(t, blinkOff) {
        showArt(false);
        render(idlePose(t, blinkOff));
      },
      seed(n) {
        S = script(n);
      },
      idleEvents: () => ({ B: S.B, K: S.K }),
      clip(name, t, fromT = 0, dir = 1) {
        showArt(false);
        from = idlePose(fromT, true);
        clip = { name, ...clipKeys(name, rest(), dir) };
        render(t >= clip.duration ? idlePose(0, true) : clipPose(t));
        return clip.duration;
      },
      clipDuration: (name) => clipKeys(name, rest()).duration,
      showArt,
    };
  }

  // Boot. The block is the home page's closing CTA; its character is the Check artwork (home.mjs
  // marks it data-closing-check, so the ambient cast leaves it to this player).
  const section = document.querySelector(".closing-block");
  const actor = section?.querySelector("[data-closing-check]");
  if (!actor || !window.Flipbook || !("IntersectionObserver" in window)) return;
  const words = section.querySelector(".closing-inner > div");
  // The drawings stay on the character's side of the block: right of the midpoint between the
  // words and the character, so nothing is drawn over the heading, the line or the button.
  const region = () => {
    const s = section.getBoundingClientRect(),
      w = words.getBoundingClientRect(),
      c = actor.getBoundingClientRect(),
      left = (w.right + c.left) / 2;
    return new DOMRect(left, s.top, s.right - left, s.height);
  };
  const check = start({ actor, region, section });
  // Hook for the shared hover affordance (new/_shared/hover-affordance.*, still being designed, not
  // adopted here yet): the actor names its hover beat, and check.play("look", dir) plays it.
  actor.dataset.hoverBeat = "look";
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      check.begin("right");
    },
    { threshold: 0.6 },
  );
  observer.observe(actor);
  // ?motion-debug exposes the player to the browser checks (seek any moment, play a beat).
  if (new URLSearchParams(location.search).has("motion-debug")) window.closingCheck = check;
})();
