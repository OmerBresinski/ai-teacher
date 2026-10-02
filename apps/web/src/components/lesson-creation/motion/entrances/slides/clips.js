// Beats and the hover spin for the smooth renderer: the same key poses as v4a-idle's clips.
(() => {
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
      frames: [[0, 580, 12]],
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
      frames: [[0, 1000, 12]],
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
      frames: [[0, 560, 24], [560, 820, 12]],
    },
    // One breath, drawn: the card swells from its planted base (top corners rise and spread),
    // shoulders and arms lift and drift with a small elbow change, the face rides up, and the
    // out-breath carries a hint of weight shift. Six held drawings, 250 ms each.
    breath: {
      duration: 1500,
      keys: [
        { t: 0, ...R, sy: 1, swell: 0, lean: 0 },
        { t: 250, pose: "rest_happy", th: 0, sy: 1.014, swell: 0.014, lean: 0, arms: { L: [[-134, 92, 0], [-139, 126, 0]], R: [[121, 119, 0], [123, 90, 0]] } },
        { t: 500, pose: "rest_happy", th: 0, sy: 1.03, swell: 0.03, lean: 0, arms: { L: [[-137, 86, 0], [-142, 121, 0]], R: [[124, 113, 0], [125, 84, 0]] } },
        { t: 750, pose: "rest_happy", th: 0, sy: 1.03, swell: 0.03, lean: 0, arms: { L: [[-137, 86, 0], [-142, 121, 0]], R: [[124, 113, 0], [125, 84, 0]] } },
        { t: 1000, pose: "rest_happy", th: 0, sy: 1.016, swell: 0.016, lean: 0.012, arms: { L: [[-134, 93, 0], [-140, 128, 0]], R: [[120, 120, 0], [123, 92, 0]] } },
        { t: 1250, ...R, sy: 1, swell: 0, lean: 0 },
        { t: 1500, ...R, sy: 1, swell: 0, lean: 0 },
      ],
      frames: [[0, 1500, 4]],
    },
  };
  delete CLIPS.breath; // breathing is continuous in the smooth renderer
  CLIPS.burst.smearAt = 480;
  window.CLIPS = CLIPS;
})();
