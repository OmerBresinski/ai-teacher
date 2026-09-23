import { gsap } from "gsap";
// Source production.js work beats. All hand/prop contact timing is preserved.
export function buildBeat(context, n) {
  const { p, actors, fan, questionNodes, questionLengths, draw, setFanMode, onComplete } = context;
  const tl = gsap.timeline({ paused: true, onUpdate: draw, onComplete });
  const go = (v, t, d = 0.6, e = "sine.inOut") => tl.to(p, { ...v, duration: d, ease: e }, t);
  if (n === 0) {
    go({ fold: 1 }, 0.2, 1.05);
    go({ y: 244 }, 1.55, 0.6);
    go({ y: 251 }, 2.75, 0.7);
    tl.to({}, { duration: 0.45 }, 3.45);
  }
  if (n === 1) {
    go({ y: 242 }, 0, 0.7);
    go({ look: -2 }, 0.65, 0.5);
    go({ r: 1, look: 2 }, 1.2, 0.6);
    go({ r: 0, look: 0 }, 1.9, 0.4);
    go({ fold: 0, y: 251 }, 2.35, 0.95);
    tl.to({}, { duration: 0.3 }, 3.3);
  }
  if ([2, 5, 8].includes(n)) {
    const { from, to } = context;
    actors[to].x = 570;
    actors[to].alpha = 0;
    tl.to(actors[from], { x: 230, duration: 0.75, ease: "sine.inOut" }, 0);
    tl.to(actors[to], { x: 435, alpha: 1, duration: 0.75, ease: "sine.inOut" }, 0);
    go({ x: 321, y: 245, gazeMix: 1, outerRelease: 1 }, 0, 0.75);
    go({ grip: 1 }, 0.48, 0.62);
    go({ y: 242 }, 1.1, 0.22);
    go({ offer: 1 }, 1.38, 0.4); // A visible shared grip precedes release.
    tl.to(actors[from], { x: 85, alpha: 0, duration: 0.85, ease: "sine.inOut" }, 1.78);
    tl.to(actors[to], { x: 320, duration: 0.85, ease: "sine.inOut" }, 1.78);
    go({ x: 320, y: 251, gazeMix: 0 }, 1.78, 0.85);
    tl.to({}, { duration: 0.3 }, 2.63);
  }
  if (n === 11) {
    // A declined worksheet acknowledges the choice and leaves empty-handed.
    const { from, to } = context;
    actors[to].x = 560;
    actors[to].alpha = 0;
    go({ gesture: 1, look: 2 }, 0, 0.25);
    go({ gesture: 0, look: 0 }, 0.35, 0.3);
    tl.to(actors[from], { x: 150, alpha: 0, duration: 0.85, ease: "sine.inOut" }, 0.65);
    tl.to(actors[to], { x: 320, alpha: 1, duration: 0.85, ease: "sine.inOut" }, 0.85);
  }
  if (n === 3) {
    p.pending = 1;
    p.stackGap = 0;
    p.magic = 0;
    p.py = 4;
    p.px = 0;
    p.pr = 0;
    p.paperFront = 0;
    p.contact = 0;
    go({ gesture: 1, px: 45, py: -19, pr: -5 }, 0.15, 0.65);
    go({ px: 82, py: -12, pr: -3 }, 0.8, 0.45);
    tl.set(p, { paperFront: 1 }, 1.25);
    go({ px: 0, py: -18, pr: 0 }, 1.25, 0.75);
    // Travel to the starting edge before revealing anything; the hand then owns the wipe.
    go({ sweep: 1 }, 2, 0.35);
    go({ magic: 1, spark: 1 }, 2.35, 0.95);
    go({ spark: 0 }, 3.3, 0.2);
    go({ sweep: 0 }, 3.5, 0.2);
    go({ py: 0 }, 3.7, 0.7);
    tl.set(p, { deck: 1, ink: 1, pending: 0 }, 4.4);
    go({ gesture: 0, gripShape: 1, y: 253.2, x: 326 }, 4.4, 0.5);
    tl.to({}, { duration: 0.2 }, 4.9);
  }
  if (n === 4) {
    go({ ambientGate: 0 }, 0, 0.2);
    go({ x: 326, y: 253.2, r: 3, stackGap: 0 }, 0, 0.3);
    tl.call(
      () => {
        setFanMode(true);
      },
      [],
      0.3,
    );
    const time = { value: 0 };
    tl.to(
      time,
      {
        value: fan.t.duration(),
        duration: fan.t.duration(),
        ease: "none",
        onUpdate() {
          fan.t.time(time.value);
        },
      },
      0.3,
    );
    const end = 0.3 + fan.t.duration();
    tl.call(
      () => {
        setFanMode(false);
        p.x = 326;
        p.y = 253.2;
        p.r = 3;
      },
      [],
      end,
    );
    go({ x: 320, y: 251, r: 0, stackGap: 0, ambientGate: 1 }, end, 0.4);
  }
  if (n === 6) {
    p.questions = 0;
    p.q0 = p.q1 = p.q2 = 0;
    p.sheet = 1;
    p.sheetFront = 0;
    p.sx = 0;
    p.sy = 18;
    p.sr = 0;
    go({ extractGrip: 1 }, 0, 0.2);
    go({ sx: 48, sy: -18, sr: -6 }, 0.2, 0.65);
    go({ sx: 84, sy: -10, sr: -4 }, 0.85, 0.45);
    tl.set(p, { sheetFront: 1 }, 1.3);
    go({ sx: 0, sy: 0, sr: 0, y: 249, sheetGrip: 1 }, 1.3, 0.7);
    tl.set(p, { tool: 1, stroke: -1, penX: -21, penY: -33 }, 2);
    go({ gesture: 1, toolAlpha: 1 }, 2, 0.4);
    go({ penY: -27 }, 2.4, 0.16);
    let at = 2.56;
    for (let i = 0; i < 3; i++) {
      tl.set(p, { stroke: i, contact: 1 }, at);
      go({ [`q${i}`]: 1 }, at, 0.72, "none");
      at += 0.72;
      const end = questionNodes[i].getPointAtLength(questionLengths[i]);
      tl.set(p, { contact: 0, penX: end.x, penY: end.y }, at);
      go({ penY: end.y - 6 }, at, 0.14);
      at += 0.14;
      if (i < 2) {
        go({ penX: -21, penY: -33 + (i + 1) * 12 }, at, 0.3);
        at += 0.3;
        go({ penY: -27 + (i + 1) * 12 }, at, 0.14);
        at += 0.14;
      }
    }
    tl.set(p, { questions: 1, stroke: -1 }, at);
    go({ penX: 31, penY: -42 }, at, 0.35);
    go({ toolAlpha: 0 }, at + 0.35, 0.25);
    go({ gesture: 0, extractGrip: 0, y: 245 }, at + 0.6, 0.5);
  }
  if (n === 7) {
    go({ gesture: 1, rx: 351, ry: 267 }, 0, 0.4);
    go({ extend: 1, ry: 293, y: 241 }, 0.45, 1.1);
    go({ r: -1 }, 1.7, 0.55);
    go({ r: 0 }, 2.35, 0.45);
    go({ extend: 0, gesture: 0, sheetGrip: 0, y: 251 }, 3.05, 0.85);
  }
  if (n === 9) {
    go({ compare: 1, y: 249 }, 0, 0.85);
    go({ r: -1, look: -3 }, 1.2, 0.55);
    go({ r: 1, look: 3 }, 2, 0.55);
    go({ r: 0, look: 0 }, 2.8, 0.5);
    go({ compare: 0, y: 251 }, 3.5, 0.85);
  }
  if (n === 10) {
    go({ gesture: 1, rx: 369, ry: 234 }, 0, 0.65);
    tl.set(p, { tool: 2 }, 0.4);
    go({ toolAlpha: 1 }, 0.4, 0.3);
    go({ rx: 320, ry: 236 }, 0.8, 0.6);
    go({ ry: 251 }, 1.45, 0.17, "power2.in");
    tl.set(p, { seal: 1 }, 1.62);
    go({ rx: 365, ry: 226 }, 1.8, 0.4, "power2.out");
    go({ toolAlpha: 0 }, 2.25, 0.25);
    go({ gesture: 0, y: 239 }, 2.5, 0.7);
    tl.to({}, { duration: 1.1 }, 3.2);
  }

  return tl;
}
