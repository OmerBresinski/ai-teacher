/* How it works: the Slides character drops in once, the first time the section is in view.
   The rest pose is the markup, so without JavaScript or with reduced motion nothing moves. */
(() => {
  const section = document.querySelector("[data-hiw]");
  if (!section || !window.Flipbook || !("IntersectionObserver" in window)) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const actor = section.querySelector("[data-hiw-actor]"),
    side = section.querySelector("[data-hiw-side]"),
    head = section.querySelector(".section-head"),
    shadow = section.querySelector(".hm-hiw-shadow");

  // "Full anime": it drops in from the top right already spinning, with smear drawings and swirl
  // strokes, stretches as it falls, lands on a negative impact frame, squashes, throws a
  // shockwave, dust and cards, shakes, then settles through a hero pose to the rest pose.
  const spec = {
    duration: 1560,
    keys: [
      {
        t: 0,
        pose: "tuck",
        tx: 560,
        ty: -340,
        th: 0,
        smear: 1,
        swirl: 0.8,
        smearDx: 40,
        smearDy: -26,
      },
      {
        t: 240,
        pose: "tuck",
        tx: 210,
        ty: -180,
        th: 1,
        smear: 1,
        swirl: 0.8,
        smearDx: 30,
        smearDy: -14,
        ease: "lin",
        quant: 6,
      },
      {
        t: 520,
        pose: "tuck",
        tx: 30,
        ty: -95,
        th: 2,
        smear: 1,
        swirl: 0.8,
        smearDx: 12,
        smearDy: -6,
        ease: "lin",
        quant: 6,
      },
      { t: 600, pose: "stretch", tx: 6, ty: -60, th: 2, smear: 0, swirl: 0, ease: "in" },
      { t: 700, pose: "stretch", tx: 0, ty: -10, th: 2, ease: "in" },
      { t: 701, pose: "squash", th: 2, ease: "snap" },
      { t: 860, pose: "squash", th: 2, sy: 0.7, sx: 1.2 },
      { t: 960, pose: "hero", th: 2, sy: 1.1, sx: 0.92, bulge: -0.02, ty: -8, ease: "out" },
      { t: 1060, pose: "hero", th: 2, ease: "inout" },
      { t: 1340, pose: "hero", th: 2 },
      { t: 1560, pose: "rest_happy", th: 2 },
    ],
    frames: [
      [0, 520, 24],
      [520, 700, 24],
      [700, 1000, 24],
      [1000, 1560, 12],
    ],
    fx: (t) => {
      const o = {};
      if (t >= 560 && t < 700) o.fall = 1;
      if (t >= 700 && t < 740) {
        o.negative = true;
        o.lines = true;
      } else if (t >= 740 && t < 900) o.lines = true;
      if (t >= 700 && t < 1150) {
        o.ring = (t - 700) / 450;
        o.ringSize = 1.1;
      }
      if (t >= 740 && t < 1260) {
        o.dust = (t - 740) / 520;
        o.dustSize = 1.2;
      }
      if (t >= 720 && t < 1300) o.papers = (t - 720) / 580;
      return o;
    },
    shake: [{ at: 700, dur: 280, amp: 9 }],
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
  const book = window.Flipbook.mount(actor, spec, { region, shake: side });

  // Hold the character back until the entrance starts, so it never appears twice.
  section.classList.add("hiw-armed");
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      section.classList.add("hiw-playing");
      const anims = book.play();
      if (shadow)
        anims.push(shadow.animate([{ opacity: 0 }, { opacity: 0 }], { duration: book.duration }));
      section.classList.remove("hiw-armed");
    },
    { threshold: 0.6 },
  );
  observer.observe(side);
})();
