/* How it works: the Slides character bursts in once, the first time the section is in view, then
   stays alive at rest (UX ruling 114: smooth base, anime accents). Slides' persona is boundless
   energy, can't sit still: it spins in, lands with a squash, rebounds, lands again and pops a
   hero pose; at rest it breathes, blinks, now and then hops or glances at the copy, and spins
   when hovered or tapped. The rest pose is the markup, so without JavaScript or with reduced
   motion nothing moves, including when reduced motion is turned on mid-page. */
(() => {
  const section = document.querySelector("[data-hiw]");
  if (!section || !window.Flipbook || !("IntersectionObserver" in window)) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const actor = section.querySelector("[data-hiw-actor]"),
    side = section.querySelector("[data-hiw-side]"),
    head = section.querySelector(".section-head"),
    shadow = section.querySelector(".hm-hiw-shadow");

  // Slides' own poses, as overrides of the rest pose.
  const poses = {
    // bounces back up off the impact: long, arms flung up, knees tucked
    rebound: {
      sy: 1.1,
      sx: 0.92,
      bulge: -0.02,
      arms: {
        L: [
          [-140, 60, 0],
          [-150, 14, 0],
        ],
        R: [
          [128, 66, 0],
          [140, 18, 0],
        ],
      },
      legs: {
        L: [
          [-112, 248, 10],
          [-92, 262, 0],
        ],
        R: [
          [84, 246, 10],
          [64, 262, 0],
        ],
      },
      mouth: "happy",
    },
    // second, smaller landing: squeezed joy
    land2: {
      sy: 0.86,
      sx: 1.1,
      bulge: 0.05,
      arms: {
        L: [
          [-150, 110, 0],
          [-176, 138, 0],
        ],
        R: [
          [140, 118, 0],
          [166, 140, 0],
        ],
      },
      legs: {
        L: [
          [-134, 256, 0],
          [-128, 277, 0],
        ],
        R: [
          [104, 254, 0],
          [110, 277, 0],
        ],
      },
      mouth: "happy",
      eyes: "shut",
    },
  };

  // The entrance: it drops in from the top right already spinning, with swirl strokes, stretches
  // as it falls, lands on a held squash, throws a shockwave, dust and cards, shakes, rebounds into
  // a hop, lands smaller, pops a hero pose and settles on the rest pose.
  const spin = { pose: "tuck", swirl: 0.8, ease: "lin" };
  const entrance = {
    duration: 1900,
    impact: 840,
    keys: [
      { t: 0, ...spin, tx: 560, ty: -340, th: 0 },
      { t: 300, ...spin, tx: 210, ty: -180, th: 1 },
      { t: 640, ...spin, tx: 30, ty: -95, th: 2 },
      { t: 740, pose: "stretch", tx: 6, ty: -60, th: 2, swirl: 0, ease: "in" },
      { t: 840, pose: "stretch", tx: 0, ty: -10, th: 2, ease: "in" },
      { t: 841, pose: "squash", th: 2, ease: "snap" },
      { t: 960, pose: "squash", th: 2, sy: 0.7, sx: 1.2 },
      { t: 1080, pose: "rebound", th: 2, ty: -46, ease: "out" },
      { t: 1180, pose: "land2", th: 2, ty: 0, ease: "in" },
      { t: 1290, pose: "hero", th: 2, ease: "out" },
      { t: 1620, pose: "hero", th: 2 },
      { t: 1790, pose: "rest_happy", th: 2 },
      { t: 1900, pose: "rest_happy", th: 2 },
    ],
    fx: (t) => {
      const o = {};
      if (t >= 680 && t < 840) o.fall = 1;
      if (t >= 840 && t < 1000) o.lines = true;
      if (t >= 840 && t < 1320) {
        o.ring = (t - 840) / 480;
        o.ringSize = 1.1;
      }
      if (t >= 880 && t < 1440) {
        o.dust = (t - 880) / 560;
        o.dustSize = 1.2;
      }
      if (t >= 860 && t < 1500) o.papers = (t - 860) / 640;
      return o;
    },
    shake: [
      { at: 840, dur: 280, amp: 9 },
      { at: 1180, dur: 110, amp: 3 },
    ],
  };

  // Resting life. Beats and the hover spin start and end on the rest pose; the breath deforms
  // the body (see Flipbook.player) and repaints at a low rate because it is slow.
  const R = { pose: "rest_happy", th: 0 };
  const CLIPS = {
    hop: {
      duration: 580,
      keys: [
        { t: 0, ...R },
        { t: 90, pose: "land2", th: 0, sy: 0.93, sx: 1.05, eyes: "dot" },
        { t: 250, pose: "rebound", th: 0, ty: -22, ease: "out" },
        { t: 380, pose: "land2", th: 0, ty: 0, sy: 0.94, sx: 1.04, eyes: "dot", ease: "in" },
        { t: 480, ...R, ease: "out" },
        { t: 580, ...R },
      ],
    },
    glance: {
      duration: 1000,
      keys: [
        { t: 0, ...R, head: 0 },
        { t: 89, ...R, head: 0 },
        { t: 90, pose: "rest_happy", th: 0, head: -0.13, lean: -0.04, ty: 5, ease: "snap" },
        { t: 820, pose: "rest_happy", th: 0, head: -0.13, lean: -0.04, ty: 5 },
        { t: 900, ...R, head: 0, ease: "snap" },
        { t: 1000, ...R, head: 0 },
      ],
    },
    burst: {
      duration: 820,
      keys: [
        { t: 0, ...R },
        { t: 80, pose: "land2", th: 0, sy: 0.9, eyes: "dot" },
        { t: 160, pose: "tuck", th: 0.125, ty: -28, quant: 8, ease: "out" },
        { t: 480, pose: "tuck", th: 1, ty: -30, quant: 8, ease: "lin", swirl: 0.6 },
        { t: 560, pose: "land2", th: 1, ty: 0, ease: "in" },
        { t: 660, pose: "hero", th: 1, ease: "out" },
        { t: 760, pose: "rest_happy", th: 1 },
        { t: 820, pose: "rest_happy", th: 1 },
      ],
    },
  };
  CLIPS.burst.smearUntil = 480;
  const idle = {
    clips: CLIPS,
    breath: { cycle: 3800, inhale: 1100, exhale: 1500, depth: 0.03, fps: 10 },
    lift: {
      L: [
        [-137, 86, 0],
        [-142, 121, 0],
      ],
      R: [
        [124, 113, 0],
        [125, 84, 0],
      ],
    },
  };

  // The drawings stay on the character's side of the section: beside the heading on a wide
  // screen, below it once the columns stack.
  const region = () => {
    const s = section.getBoundingClientRect(),
      c = side.getBoundingClientRect(),
      h = head.getBoundingClientRect();
    if (c.top >= h.bottom) return new DOMRect(s.left, c.top, s.width, s.bottom - c.top);
    const left = (h.right + c.left) / 2;
    return new DOMRect(left, s.top, s.right - left, s.height);
  };
  const slides = window.Flipbook.player(
    actor,
    { entrance, idle, poses },
    { region, shake: side, shadow, section },
  );

  // Hold the character back until the entrance starts, so it never appears twice.
  section.classList.add("hiw-armed");
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      section.classList.add("hiw-playing");
      slides.start();
      section.classList.remove("hiw-armed");
    },
    { threshold: 0.6 },
  );
  observer.observe(side);
  // Reduced motion turned on before the entrance: show the character at rest straight away.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  reduced.addEventListener("change", function disarm() {
    if (!reduced.matches) return;
    reduced.removeEventListener("change", disarm);
    if (!section.classList.contains("hiw-armed")) return;
    observer.disconnect();
    slides.start();
    section.classList.remove("hiw-armed");
  });
})();
