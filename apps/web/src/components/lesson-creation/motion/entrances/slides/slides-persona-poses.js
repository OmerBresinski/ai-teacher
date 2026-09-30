// Slides persona poses (boundless energy, can't sit still). Partial overrides of the rest pose, passed as
// spec.poses; paste into the spec in how-it-works.js when a variant is chosen.
window.SLIDES_POSES = {
  // bounces back up off the impact: long, arms flung up, knees tucked
  rebound: {
    sy: 1.1, sx: 0.92, bulge: -0.02,
    arms: { L: [[-140, 60, 0], [-150, 14, 0]], R: [[128, 66, 0], [140, 18, 0]] },
    legs: { L: [[-112, 248, 10], [-92, 262, 0]], R: [[84, 246, 10], [64, 262, 0]] },
    mouth: "happy",
  },
  // second, smaller landing: squeezed joy
  land2: {
    sy: 0.86, sx: 1.1, bulge: 0.05,
    arms: { L: [[-150, 110, 0], [-176, 138, 0]], R: [[140, 118, 0], [166, 140, 0]] },
    legs: { L: [[-134, 256, 0], [-128, 277, 0]], R: [[104, 254, 0], [110, 277, 0]] },
    mouth: "happy", eyes: "shut",
  },
  // startled: arms half up, mouth open
  glance: {
    arms: { L: [[-140, 90, 0], [-162, 68, 0]], R: [[128, 100, 0], [152, 80, 0]] },
    mouth: "o",
  },
  // foot-to-foot fidget, weight on the left then on the right
  fidgetL: {
    lean: -0.1,
    arms: { L: [[-140, 122, 0], [-150, 152, 0]], R: [[130, 88, 0], [150, 56, 0]] },
    legs: { L: [[-102, 272, 0], [-118, 277, 0]], R: [[104, 240, 12], [90, 258, 0]] },
    mouth: "happy",
  },
  fidgetR: {
    lean: 0.1,
    arms: { L: [[-140, 80, 0], [-164, 48, 0]], R: [[126, 124, 0], [136, 152, 0]] },
    legs: { L: [[-124, 240, 12], [-110, 258, 0]], R: [[90, 268, 0], [108, 270, 0]] },
    mouth: "happy",
  },
};
