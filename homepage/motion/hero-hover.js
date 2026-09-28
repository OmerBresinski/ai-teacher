/* Hero hover reactions (UX rulings 114, 115, 124). Loaded after first paint by assets/hero-motion.js.
   Slides "ta-da", Plan waves, Worksheet twirls its pencil (drawn from and slotted back behind the
   sheet), Check looks over its glasses. Every hover or tap reacts at once, with no cooldown: early in
   a reaction a re-hover carries it on; later it plays again, easing out of the pose it is in. Each
   reaction also plays now and then on its own, one character at a time, so touch visitors see it.
   The clips are baked from the design-study cast modules (context "hero", scale 0.45); a reaction owns
   its character while it plays and adds hero-motion's idle sway on top, so the handback is seamless.
   Still under reduced motion and in a hidden tab. */
(() => {
  // The hover clips, baked at 30 Hz from the cast modules (context "hero", hero-rig units): c-motion-v4a-final, c-motion-plan-v6b-idle, c-motion-worksheet-v4b-idle, c-motion-check-v5c-idle
  const CLIPS = {
    slides: {
      name: "tada",
      ms: 1240,
      hz: 30,
      f: {
        sx: [
          1, 1.02, 1.03, 1.03, 1.04, 1.02, 1, 0.98, 0.97, 0.97, 0.98, 0.98, 0.98, 0.99, 1.01, 1.03,
          1.02, 1, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 1,
          1, 1, 1, 1, 1, 1,
        ],
        sy: [
          1, 0.97, 0.96, 0.95, 0.95, 0.98, 1.01, 1.03, 1.04, 1.05, 1.03, 1.03, 1.02, 1.01, 0.98,
          0.96, 0.97, 1, 1.01, 1.02, 1.02, 1.02, 1.02, 1.02, 1.02, 1.02, 1.01, 1.01, 1.01, 1.01,
          1.01, 1.01, 1, 1, 1, 1, 1, 1,
        ],
        jump: [
          0, 0, 0, 0, 0, -2.75, -5.48, -7.44, -8.61, -9, -9.59, -9.87, -9.57, -7.57, -3.75, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        lx: [
          0, -10.59, -16.37, -17.55, -17.55, -16.45, -15.36, -14.58, -14.11, -13.95, -13.95, -13.95,
          -14.07, -14.8, -16.18, -17.55, -16.94, -15.36, -14.37, -13.96, -13.95, -13.95, -13.95,
          -13.95, -13.95, -13.95, -13.95, -13.95, -13.95, -13.95, -13.51, -10.85, -5.86, -1.74,
          -0.05, 0, 0, 0,
        ],
        ly: [
          0, 2.17, 3.36, 3.6, 3.6, -9.87, -23.27, -32.84, -38.59, -40.5, -40.5, -40.5, -39.04,
          -30.13, -13.12, 3.6, -3.85, -23.17, -35.35, -40.36, -40.5, -40.5, -40.5, -40.5, -40.5,
          -40.5, -40.5, -40.5, -40.5, -40.5, -39.23, -31.5, -17.02, -5.06, -0.14, 0, 0, 0,
        ],
        lb: [
          0, 3.8, 5.88, 6.3, 6.3, 2.17, -1.93, -4.86, -6.61, -7.2, -7.2, -7.2, -6.75, -4.03, 1.18,
          6.3, 4.02, -1.9, -5.62, -7.16, -7.2, -7.2, -7.2, -7.2, -7.2, -7.2, -7.2, -7.2, -7.2, -7.2,
          -6.97, -5.6, -3.02, -0.9, -0.03, 0, 0, 0,
        ],
        rx: [
          0, 12.22, 18.89, 20.25, 20.25, 19.15, 18.06, 17.28, 16.81, 16.65, 16.65, 16.65, 16.77,
          17.5, 18.88, 20.25, 19.64, 18.06, 17.07, 16.66, 16.65, 16.65, 16.65, 16.65, 16.65, 16.65,
          16.65, 16.65, 16.65, 16.65, 16.13, 12.95, 7, 2.08, 0.06, 0, 0, 0,
        ],
        ry: [
          0, 12.49, 19.31, 20.7, 20.7, 7.5, -5.62, -15, -20.62, -22.5, -22.5, -22.5, -21.07, -12.34,
          4.32, 20.7, 13.41, -5.53, -17.45, -22.36, -22.5, -22.5, -22.5, -22.5, -22.5, -22.5, -22.5,
          -22.5, -22.5, -22.5, -21.8, -17.5, -9.45, -2.81, -0.08, 0, 0, 0,
        ],
        rb: [
          0, -1.36, -2.1, -2.25, -2.25, -6.38, -10.48, -13.41, -15.16, -15.75, -15.75, -15.75,
          -15.3, -12.58, -7.37, -2.25, -4.53, -10.45, -14.17, -15.71, -15.75, -15.75, -15.75,
          -15.75, -15.75, -15.75, -15.75, -15.75, -15.75, -15.75, -15.26, -12.25, -6.62, -1.97,
          -0.05, 0, 0, 0,
        ],
      },
    },
    support: {
      name: "wave",
      ms: 2080,
      hz: 30,
      f: {
        sy: [
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01,
          1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01,
          1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1,
        ],
        fy: [
          0, 0, 0, 0, 0, 0, -0.07, -0.15, -0.21, -0.27, -0.32, -0.36, -0.4, -0.42, -0.44, -0.45,
          -0.45, -0.42, -0.38, -0.3, -0.2, -0.11, -0.05, -0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        gx: [
          0, -0.31, -0.56, -0.75, -0.86, -0.9, -0.94, -0.97, -1.01, -1.04, -1.06, -1.08, -1.1,
          -1.11, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12,
          -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.11, -1.08, -1.04, -0.99, -0.95,
          -0.92, -0.9, -0.9, -0.83, -0.66, -0.39, -0.16, -0.03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        gy: [
          0, -0.31, -0.56, -0.75, -0.86, -0.9, -0.94, -0.97, -1.01, -1.04, -1.06, -1.08, -1.1,
          -1.11, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12,
          -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.12, -1.11, -1.08, -1.04, -0.99, -0.95,
          -0.92, -0.9, -0.9, -0.86, -0.78, -0.65, -0.53, -0.47, -0.45, -0.43, -0.38, -0.3, -0.25,
          -0.23, -0.22, -0.2, -0.17, -0.12, -0.07, -0.03, -0.01, 0, 0, 0,
        ],
        eye: [
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.92, 0.73, 0.44, 0.18, 0.04, 0, 0.1, 0.33, 0.67, 0.9,
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        ],
        lx: [
          0, 1.25, 2.25, 2.98, 3.43, 3.6, -0.24, -4.1, -7.54, -10.55, -13.14, -15.31, -17.05,
          -18.37, -19.26, -19.72, -19.76, -19.3, -18.33, -16.85, -14.88, -13.1, -11.82, -11.06,
          -10.8, -11.11, -12.02, -13.55, -15.7, -18.06, -19.84, -21, -21.55, -21.51, -20.95, -19.88,
          -18.29, -16.28, -14.6, -13.43, -12.76, -12.61, -12.82, -13.33, -14.12, -14.81, -15.2,
          -15.28, -14.41, -12.31, -9.29, -7.19, -6.32, -6.17, -5.63, -4.68, -3.31, -1.86, -0.83,
          -0.21, 0, 0, 0,
        ],
        ly: [
          0, 1.56, 2.82, 3.73, 4.29, 4.5, -5.69, -15.94, -25.07, -33.06, -39.94, -45.68, -50.3,
          -53.79, -56.16, -57.4, -57.62, -57.8, -58.19, -58.78, -59.57, -60.28, -60.79, -61.1,
          -61.2, -61.07, -60.69, -60.05, -59.16, -58.17, -57.43, -56.95, -56.72, -56.74, -56.96,
          -57.39, -58.02, -58.83, -59.5, -59.97, -60.23, -60.3, -60.16, -59.82, -59.28, -58.82,
          -58.56, -58.4, -54.86, -46.25, -33.85, -25.24, -21.7, -21.15, -19.3, -16.03, -11.35,
          -6.39, -2.84, -0.71, 0, 0, 0,
        ],
        lb: [
          0, 0.93, 1.69, 2.24, 2.57, 2.7, -1.88, -6.48, -10.58, -14.18, -17.26, -19.85, -21.92,
          -23.49, -24.55, -25.11, -25.2, -25.25, -25.35, -25.49, -25.69, -25.87, -26, -26.07, -26.1,
          -26.05, -25.9, -25.64, -25.28, -24.89, -24.59, -24.4, -24.31, -24.31, -24.4, -24.56,
          -24.8, -25.1, -25.35, -25.53, -25.63, -25.65, -25.58, -25.41, -25.14, -24.91, -24.78,
          -24.71, -23.19, -19.52, -14.23, -10.56, -9.04, -8.81, -8.04, -6.68, -4.73, -2.66, -1.18,
          -0.3, 0, 0, 0,
        ],
      },
    },
    activity: {
      name: "twirl",
      ms: 1840,
      hz: 30,
      f: {
        sx: [
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1.01, 1.01, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
          1, 1.01, 1.01, 1.01, 1.01, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
          1, 1,
        ],
        sy: [
          1, 1, 1, 1, 1, 1, 1, 0.99, 0.99, 0.99, 0.99, 0.99, 1, 1.01, 1.01, 1.01, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1, 0.98, 0.98, 0.98, 0.98, 0.99, 1, 1, 1, 1, 1, 1, 1, 1, 1.01, 1.01, 1,
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        ],
        gx: [
          0, 0.53, 0.93, 1.2, 1.33, 1.35, 1.32, 1.27, 1.21, 1.16, 1.13, 1.13, 1.13, 1.13, 1.13,
          1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.48, 0.87, 0.89, 0.84, 0.76, 0.63, 0.47, 0.01,
          0, 0, 0, 0,
        ],
        gy: [
          0, 0.09, 0.16, 0.2, 0.22, 0.21, 0.13, -0.03, -0.2, -0.35, -0.44, -0.72, -1.12, -1.32,
          -1.38, -1.43, -1.47, -1.51, -1.53, -1.56, -1.57, -1.57, -1.57, -1.54, -1.48, -1.4, -1.29,
          -1.15, -0.99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01, 0.12, 0.22, 0.22, 0.2, 0.15,
          0.09, 0.01, 0, 0, 0, 0, 0,
        ],
        eye: [
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        ],
        smile: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18,
          0.18, 0.18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        brow: [
          0, 0.04, 0.06, 0.08, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09,
          0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        rx: [
          0, -2.84, -4.98, -6.4, -7.11, -7.09, -6.28, -4.87, -3.23, -1.82, -1.01, -0.49, 0.11, 0.41,
          0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45,
          0.45, 0.45, 0.45, 0.36, 0.11, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.38, -3.81, -6.98, -7.2, -7.2,
          -7.2, -7.2, -7.2, -7.2, -5.6, -1.9, 0, 0,
        ],
        ry: [
          0, 2.84, 4.98, 6.4, 7.11, 7.18, 7.07, 6.87, 6.63, 6.43, 6.32, 3.83, 0.23, -1.57, -1.8,
          -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8,
          -1.8, -1.8, -1.44, -0.45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.38, 3.81, 6.98, 7.2, 7.2, 7.2, 7.2,
          7.2, 7.2, 5.6, 1.9, 0, 0,
        ],
        rb: [
          0, 0.05, 0.08, 0.1, 0.11, 0.11, 0.1, 0.1, 0.09, 0.07, 0.07, 0.04, -0.01, -0.03, -0.03,
          -0.03, -0.03, -0.03, -0.03, -0.03, -0.03, -0.03, -0.03, -0.03, -0.03, -0.03, -0.03, -0.03,
          -0.03, -0.03, -0.03, -0.03, -0.03, -0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01, 0.07, 0.11,
          0.11, 0.11, 0.11, 0.11, 0.11, 0.11, 0.09, 0.04, 0, 0,
        ],
        flap: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0.05, 0.15, 0.13, 0.04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        pen: [
          0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
        ],
        px: [
          0, -38.72, -19.75, -7.11, -0.79, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1.19, -11.85, -21.72, -23.28,
          -27.62, -35.56, -47.12, -62.28, 0, 0, 0, 0, 0,
        ],
        py: [
          0, 10.89, 5.56, 2, 0.22, 0, 0, 0, 0, 0, 0, -3.67, -9, -11.67, -16.96, -25.91, -33.53,
          -39.84, -44.84, -48.52, -50.89, -51.94, -51.55, -49.32, -45.25, -39.32, -31.55, -21.92,
          -10.44, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.34, 3.33, 6.11, 6.55, 7.77, 10, 13.25,
          17.52, 0, 0, 0, 0, 0,
        ],
        prot: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18.33, 45, 58.33, 102.19, 178.2, 243.02, 296.67, 339.14,
          370.44, 390.56, 399.5, 402.74, 416.17, 440.78, 476.58, 523.57, 581.75, 651.12, 720, 720,
          720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720,
          720, 720, 0, 0, 0, 0, 0,
        ],
      },
    },
    answers: {
      name: "look",
      ms: 2850,
      hz: 30,
      f: {
        rise: [
          0, 0.01, 0.04, 0.1, 0.16, 0.25, 0.33, 0.42, 0.51, 0.58, 0.65, 0.69, 0.72, 0.72, 0.72,
          0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72,
          0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72,
          0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72,
          0.52, 0.34, 0.19, 0.09, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0,
        ],
        fx: [
          0, 0, 0.01, 0.02, 0.04, 0.06, 0.08, 0.11, 0.13, 0.15, 0.16, 0.17, 0.18, 0.18, 0.18, 0.18,
          0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18,
          0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18,
          0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.13,
          0.08, 0.05, 0.02, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        gx: [
          0, 0.02, 0.06, 0.13, 0.23, 0.34, 0.46, 0.58, 0.7, 0.8, 0.89, 0.95, 0.98, 0.99, 0.99, 0.99,
          0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
          0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
          0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.72,
          0.46, 0.26, 0.12, 0.03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        gy: [
          0, -0.05, -0.19, -0.42, -0.72, -1.07, -1.46, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8,
          -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8,
          -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8,
          -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8, -1.8,
          -1.8, -1.8, -1.47, -0.84, -0.39, -0.11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        smile: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22,
          -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22,
          -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22,
          -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22,
          -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, -0.22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
        ],
        glasses: [
          0, 0.08, 0.33, 0.72, 1.24, 1.84, 2.5, 3.17, 3.81, 4.38, 4.85, 5.19, 5.37, 5.4, 5.4, 5.4,
          5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4,
          5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4,
          5.4, 5.4, 5.4, 5.4, 5.42, 5.57, 5.75, 5.85, 4.13, 2.54, 1.3, 0.4, -0.15, -0.36, -0.33,
          -0.22, -0.1, -0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        brow: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09, 0.09,
          0.09, 0.09, 0.09, 0.09, 0.1, 0.12, 0.16, 0.2, 0.26, 0.31, 0.36, 0.4, 0.43, 0.45, 0.45,
          0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45,
          0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.37, 0.28, 0.21, 0.16, 0.13, 0.12,
          0.12, 0.11, 0.1, 0.09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        rx: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.3, -2.62, -6.99, -12.88, -19.57,
          -26.27, -32.16, -36.53, -38.85, -39.15, -39.15, -39.15, -39.15, -39.4, -39.63, -39.81,
          -39.94, -40.02, -40.05, -38.42, -33.57, -27.75, -23.69, -22.82, -21.41, -18.63, -14.86,
          -10.62, -6.5, -3.06, -0.79, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        ry: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.09, 0.75, 2.01, 3.7, 5.62, 7.55,
          9.24, 10.5, 11.16, 11.31, 11.75, 12.31, 12.6, 9.73, 7.08, 5.01, 3.52, 2.6, 2.25, 2.25,
          2.25, 2.25, 2.25, 2.24, 2.1, 1.83, 1.46, 1.04, 0.64, 0.3, 0.08, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        rb: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.02, -0.07, -0.18, -0.32, -0.45,
          -0.45, -0.45, -0.45, -0.45, -0.45, -0.45, -0.45, -0.45, -0.45, -0.45, -0.45, -0.45, -0.45,
          -0.45, -0.45, -0.45, -0.43, -0.4, -0.37, -0.31, -0.22, -0.14, -0.07, -0.02, 0, 0, 0, 0, 0,
          0, 0, 0, 0,
        ],
      },
    },
  };
  const life = window.HeroLife;
  if (!life || !window.gsap) return;
  const ns = "http://www.w3.org/2000/svg";
  const REST = {
    lean: 0,
    rise: 0,
    jump: 0,
    sx: 1,
    sy: 1,
    fx: 0,
    fy: 0,
    gx: 0,
    gy: 0,
    eye: 1,
    smile: 0,
  };
  const BASE = { slides: 214, activity: 234, support: 230, answers: 234 };
  const BLEND = 240; // ms: a reaction that interrupts a pose eases out of it
  const r2 = (v) => Math.round(v * 100) / 100;
  const input = document.querySelector(".hm-brief input");
  let lastKey = -1e9;
  input?.addEventListener("input", () => {
    lastKey = performance.now();
  });

  // ---- Rig: built on a character's first reaction; at rest the markup is exactly the original.
  const ORIG = new WeakMap();
  function keep(el, name) {
    if (!el) return;
    if (!ORIG.has(el)) ORIG.set(el, {});
    const o = ORIG.get(el);
    if (!(name in o)) o[name] = el.getAttribute(name);
  }
  function restore(el, name) {
    const o = el && ORIG.get(el);
    if (!o || !(name in o)) return;
    if (o[name] == null) el.removeAttribute(name);
    else el.setAttribute(name, o[name]);
  }
  function rig(actor) {
    if (actor.rig) return actor.rig;
    const svg = actor.host.querySelector("svg");
    const arm = (group) => {
      const limb = group.querySelector(".limb");
      const d = limb.getAttribute("d");
      const hand = document.createElementNS(ns, "g");
      for (const el of [...group.children]) if (el !== limb) hand.append(el);
      group.append(hand);
      const n = d.match(/-?\d*\.?\d+/g).map(Number);
      return { group, limb, hand, n, cmd: /C/.test(d) ? "C" : "Q" };
    };
    const mouth = svg.querySelector(".mouth");
    const glasses = actor.glasses;
    // The face (eyes, mouth, glasses) slides as one inside the card.
    const parts = [glasses, ...actor.eyes.map((e) => e.element), mouth].filter(Boolean);
    const face = document.createElementNS(ns, "g");
    parts[0].before(face);
    face.append(...parts);
    const R = {
      kind: actor.host.dataset.heroActor,
      arms: [arm(actor.left), arm(actor.right)],
      face,
      mouth,
      mouthD: mouth?.getAttribute("d"),
      eyes: actor.eyes.map((e) => ({
        ...e,
        x: Number(e.element.getAttribute("cx")),
        y: Number(e.element.getAttribute("cy")),
      })),
      extras: {},
    };
    for (const A of R.arms)
      for (const [el, n] of [
        [A.limb, "d"],
        [A.group, "transform"],
        [A.hand, "transform"],
      ])
        keep(el, n);
    for (const [el, n] of [
      [actor.body, "transform"],
      [actor.legs, "d"],
      [mouth, "d"],
      [face, "transform"],
      [glasses, "transform"],
    ])
      keep(el, n);
    for (const e of R.eyes) for (const n of ["ry", "cx", "cy"]) keep(e.element, n);
    actor.rig = R;
    return R;
  }
  function extra(actor, name, markup, where) {
    const R = actor.rig;
    if (!R.extras[name]) {
      const g = document.createElementNS(ns, "g");
      g.innerHTML = markup;
      g.setAttribute("display", "none");
      where(g);
      R.extras[name] = g;
    }
    return R.extras[name];
  }
  function paint(actor, s) {
    const R = actor.rig;
    const { pose } = actor;
    const idle = life.sway(actor, false);
    const B = BASE[R.kind];
    const lift = s.rise + s.jump + idle.lift;
    const angle = pose.angle + s.lean + idle.lean;
    actor.body.setAttribute(
      "transform",
      `translate(0 ${r2(lift)}) translate(150 235) rotate(${r2(angle)}) translate(-150 -235) translate(150 ${B}) matrix(${r2(s.sx)} 0 0 ${r2(s.sy)} 0 0) translate(-150 ${-B})`,
    );
    const rad = (angle * Math.PI) / 180;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    actor.legs.setAttribute(
      "d",
      pose.feet
        .map(([hx0, hy0, ax, ay, tx, ty]) => {
          const hx = 150 + (hx0 - 150) * s.sx;
          const hy = B + (hy0 - B) * s.sy;
          const x = 150 + (hx - 150) * c - (hy - 235) * sn;
          const y = 235 + lift + (hx - 150) * sn + (hy - 235) * c;
          const ankle = ay + s.jump;
          return `M${r2(x)} ${r2(y)} Q${r2((x + ax) / 2)} ${r2((y + ankle) / 2)} ${ax} ${r2(ankle)} L${tx} ${r2(ty + s.jump)}`;
        })
        .join(" "),
    );
    R.arms.forEach((A, side) => {
      const dx = (side ? s.rx : s.lx) || 0;
      const dy = (side ? s.ry : s.ly) || 0;
      const bend = (side ? s.rb : s.lb) || 0;
      const rot = ((side ? s.ra : s.la) || 0) + (side ? -idle.arm : idle.arm * 0.5);
      A.group.setAttribute("transform", `rotate(${r2(rot)} ${pose.pivots[side].join(" ")})`);
      const m = A.n.slice();
      const L = m.length;
      m[L - 2] += dx;
      m[L - 1] += dy;
      const vx = m[L - 2] - m[0];
      const vy = m[L - 1] - m[1];
      const len = Math.hypot(vx, vy) || 1;
      const px = (-vy / len) * bend;
      const py = (vx / len) * bend;
      if (A.cmd === "C") {
        m[2] += dx * 0.33 + px;
        m[3] += dy * 0.33 + py;
        m[4] += dx * 0.66 + px;
        m[5] += dy * 0.66 + py;
      } else {
        m[2] += dx * 0.5 + px;
        m[3] += dy * 0.5 + py;
      }
      const p = m.map(r2);
      A.limb.setAttribute(
        "d",
        A.cmd === "C"
          ? `M${p[0]} ${p[1]} C${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]}`
          : `M${p[0]} ${p[1]} Q${p[2]} ${p[3]} ${p[4]} ${p[5]}`,
      );
      A.hand.setAttribute("transform", `translate(${r2(dx)} ${r2(dy)})`);
    });
    R.face.setAttribute("transform", `translate(${r2(s.fx)} ${r2(s.fy)})`);
    actor.glasses?.setAttribute("transform", `translate(0 ${r2(s.glasses || 0)})`);
    const open = Math.min(s.eye, idle.blink);
    for (const e of R.eyes) {
      e.element.setAttribute("ry", r2(Math.max(0.2, e.radius * open)));
      e.element.setAttribute("cx", r2(e.x + s.gx));
      e.element.setAttribute("cy", r2(e.y + s.gy));
    }
    if (R.mouth) {
      if (Math.abs(s.smile) < 0.03) R.mouth.setAttribute("d", R.mouthD);
      else {
        const [x, y, cx, cy, ex, ey] = pose.face;
        const k = s.smile;
        R.mouth.setAttribute(
          "d",
          `M${r2(x - 2 * k)} ${r2(y - k)} Q${cx} ${r2(cy + 6 * k)} ${r2(ex + 2 * k)} ${r2(ey - k)}`,
        );
      }
    }
    if (s.brow || R.extras.brow) {
      const g = extra(
        actor,
        "brow",
        R.eyes
          .map(
            (e) =>
              `<path d="M${e.x - 5} ${e.y - 9} Q${e.x} ${e.y - 12} ${e.x + 5} ${e.y - 9}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
          )
          .join(""),
        (node) => R.face.append(node),
      );
      g.setAttribute("display", s.brow > 0.02 ? "inline" : "none");
      g.setAttribute("transform", `translate(0 ${r2(-3 * (s.brow || 0))})`);
      g.setAttribute("opacity", r2(Math.min(1, (s.brow || 0) * 1.5)));
    }
    if (s.pen || R.extras.pencil) {
      // Under the paper: the pencil comes out from behind the sheet and is slotted back behind it.
      const g = extra(
        actor,
        "pencil",
        '<path d="M-3 -14h6v22l-3 6-3-6Z" fill="#f5c054" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M-3 8h6" stroke="currentColor" stroke-width="1.4"/>',
        (node) => {
          const paper = actor.body.querySelector('path[fill^="url"]');
          if (paper) paper.before(node);
          else actor.body.append(node);
        },
      );
      if (s.pen) {
        const n = R.arms[1].n;
        const hx = n[n.length - 2] + (s.rx || 0) + s.px;
        const hy = n[n.length - 1] + (s.ry || 0) + s.py;
        g.setAttribute("display", "inline");
        g.setAttribute("transform", `translate(${r2(hx)} ${r2(hy)}) rotate(${r2(s.prot)})`);
      } else g.setAttribute("display", "none");
    }
  }
  // Put every attribute back exactly as the markup had it and hand the character back.
  function release(actor) {
    const R = actor.rig;
    actor.react = null;
    if (!R) return;
    for (const A of R.arms)
      for (const [el, n] of [
        [A.limb, "d"],
        [A.group, "transform"],
        [A.hand, "transform"],
      ])
        restore(el, n);
    for (const [el, n] of [
      [actor.body, "transform"],
      [actor.legs, "d"],
      [R.mouth, "d"],
      [R.face, "transform"],
      [actor.glasses, "transform"],
    ])
      restore(el, n);
    for (const e of R.eyes) for (const n of ["ry", "cx", "cy"]) restore(e.element, n);
    for (const g of Object.values(R.extras)) g.setAttribute("display", "none");
    actor.owner = false;
    life.paint(actor, life.blocked() || !actor.visible);
  }

  // ---- Playback: baked clip tables, interpolated per display frame.
  function poseAt(clip, ms) {
    const s = { ...REST, pen: 0, px: 0, py: 0, prot: 0 };
    const x = (Math.min(ms, clip.ms) / 1000) * clip.hz;
    const i = Math.floor(x);
    const w = x - i;
    for (const [key, v] of Object.entries(clip.f)) {
      const a = v[Math.min(i, v.length - 1)];
      const b = v[Math.min(i + 1, v.length - 1)];
      s[key] = key === "pen" ? a : a + (b - a) * w;
    }
    return s;
  }
  const playing = new Set();
  function frame() {
    const t = performance.now();
    for (const actor of playing) {
      const R = actor.react;
      const ms = t - R.start;
      if (ms >= R.clip.ms) {
        playing.delete(actor);
        release(actor);
        continue;
      }
      const s = poseAt(R.clip, ms);
      if (R.from && ms < BLEND) {
        const w = 1 - (1 - ms / BLEND) ** 2;
        for (const k in s)
          if (k !== "pen" && typeof R.from[k] === "number")
            s[k] = R.from[k] + (s[k] - R.from[k]) * w;
      }
      R.s = s;
      paint(actor, s);
    }
    if (!playing.size) gsap.ticker.remove(frame);
  }
  function play(actor) {
    const clip = CLIPS[actor.host.dataset.heroActor];
    if (!clip) return;
    const R = actor.react;
    // A re-hover early in the reaction carries it on; later, it plays again from the current pose.
    if (R && performance.now() - R.start < clip.ms * 0.45) return;
    rig(actor);
    actor.owner = true;
    actor.react = { clip, start: performance.now(), from: R?.s || null, s: null };
    if (!playing.size) gsap.ticker.add(frame);
    playing.add(actor);
    frame(); // the first frame is painted now, so the reaction shows on the next frame
  }
  const skip = () => life.blocked();
  for (const actor of life.actors) {
    actor.host.addEventListener("pointerenter", () => {
      if (!skip()) play(actor);
    });
  }
  // The hover that loaded this file: play it now if the pointer is still on a character.
  for (const actor of life.actors) if (actor.host.matches(":hover") && !skip()) play(actor);
  life.onReset = () => {
    for (const actor of playing) release(actor);
    playing.clear();
    gsap.ticker.remove(frame);
  };

  // ---- Natural plays: rarely, one character at a time, never the same one twice running.
  let last = null;
  function natural() {
    setTimeout(natural, (24 + Math.random() * 16) * 1000);
    const quiet = document.activeElement !== input && performance.now() - lastKey > 6000;
    if (skip() || !quiet || playing.size) return;
    const pool = life.actors.filter((a) => a.visible && a !== last);
    if (!pool.length) return;
    last = pool[Math.floor(Math.random() * pool.length)];
    play(last);
  }
  setTimeout(natural, (14 + Math.random() * 10) * 1000);
})();
