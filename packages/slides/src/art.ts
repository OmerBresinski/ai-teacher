import type { ThemeArtLayer, ThemeArtRole } from "@tj/domain/documents";

/*
 * The ten themes' art per role (UX ruling 107), in slide points (960x540). Each theme keeps one
 * motif family and palette across its roles and changes only the density: the title slide gets the
 * fullest art, content slides a quiet piece in the margins, picture slides one small motif on the
 * side away from the picture. The layouts leave these zones free on every composition:
 *
 *   margins  x < 58 and x > 902 (the safe area's sides), y < 43 (above the tag lane),
 *            498 < y < 531 (between the safe area's foot and the accent bar)
 *   title    also y < 133 above the eyebrow, y > 392 below the class line, x > 831 beside the title
 *
 * `background.test.ts` holds every layer's box against every layout's elements. The colours are
 * pale (dark on Night Lab) so every ink, heading, muted and accent colour stays AA on them.
 */

type Art = Partial<Record<ThemeArtRole, ThemeArtLayer[]>>;

const url = (w: number, h: number, vw: number, vh: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${vw} ${vh}' preserveAspectRatio='none'>${body}</svg>`,
  )}")`;

/** An inline SVG drawn at a box. `vw`/`vh` default to the box, so the body is in slide points. */
function svg(
  x: number,
  y: number,
  w: number,
  h: number,
  body: string,
  view: [number, number] = [w, h],
): ThemeArtLayer {
  const [vw, vh] = view;
  return {
    image: url(w, h, vw, vh, body),
    flipped: url(w, h, vw, vh, `<g transform='matrix(-1 0 0 1 ${vw} 0)'>${body}</g>`),
    x,
    y,
    w,
    h,
  };
}

/** A flat block of colour: a band or a rule. */
const block = (x: number, y: number, w: number, h: number, color: string): ThemeArtLayer => ({
  image: `linear-gradient(${color}, ${color})`,
  x,
  y,
  w,
  h,
});

/* ------------------------------------------------------------------ Playground: sun, rainbow, clouds */

const sunBody = (ray: string, disc: string) =>
  `<g fill='${ray}'>${Array.from(
    { length: 12 },
    (_, i) =>
      `<rect x='113' y='12' width='14' height='44' rx='7' transform='rotate(${i * 30} 120 120)'/>`,
  ).join("")}</g><circle cx='120' cy='120' r='48' fill='${disc}'/>`;

const rainbowBody = (["#FFCFCF", "#FFE2A0", "#CFEBC2", "#CFE0FF"] as const)
  .map((c, i) => {
    const r = 88 - i * 14;
    return `<path d='M${100 - r} 110 A${r} ${r} 0 0 1 ${100 + r} 110' fill='none' stroke='${c}' stroke-width='14'/>`;
  })
  .join("");

const cloudBody = `<path d='M18 44 a16 16 0 0 1 6-30 a20 20 0 0 1 36-6 a16 16 0 0 1 26 14 a12 12 0 0 1 -2 22 Z' fill='#FFFFFF'/>`;

const PLAYGROUND: Art = {
  title: [
    svg(800, -110, 240, 240, sunBody("#FFE4A0", "#FFD97A")),
    svg(-24, 396, 300, 165, rainbowBody, [200, 110]),
    svg(700, 452, 110, 58, cloudBody, [100, 52]),
    svg(812, 410, 76, 40, cloudBody, [100, 52]),
  ],
  // A quarter of the sun peeking in above the counter.
  content: [
    svg(890, -84, 124, 124, sunBody("#FFE4A0", "#FFD97A"), [240, 240]),
    // A small rainbow rising from the bottom-left corner, in the margin above the accent bar.
    svg(-22, 488, 76, 42, rainbowBody, [200, 110]),
  ],
  picture: [svg(904, -62, 96, 96, sunBody("#FFE4A0", "#FFD97A"), [240, 240])],
};

/* ------------------------------------------------------------------ Crayon Box: an exercise book */

const MARGIN = "#F6C4CB";
const RULE = "#DCE8F8";
const starBody = (stroke: string) =>
  `<path d='M20 3 L25 14 L37 15 L28 23 L31 35 L20 28 L9 35 L12 23 L3 15 L15 14 Z' fill='none' stroke='${stroke}' stroke-width='3.5' stroke-linejoin='round'/>`;
const zigzag = (n: number, stroke: string) =>
  `<path d='M4 28 ${Array.from({ length: n }, (_, i) => `L${18 + i * 28} 10 L${32 + i * 28} 28`).join(" ")}' fill='none' stroke='${stroke}' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/>`;
const ruled = (y: number, h: number) =>
  svg(
    0,
    y,
    960,
    h,
    Array.from(
      { length: Math.floor(h / 34) },
      (_, i) => `<rect x='0' y='${16 + i * 34}' width='960' height='2' fill='${RULE}'/>`,
    ).join(""),
  );

const CRAYON: Art = {
  title: [
    svg(820, 14, 64, 60, starBody("#C9DCF6"), [40, 38]),
    svg(866, 70, 38, 36, starBody("#FBE29C"), [40, 38]),
    svg(92, 452, 262, 38, zigzag(9, "#C9DCF6")),
    svg(770, 418, 96, 96, starBody("#FBE29C"), [40, 38]),
    block(40, 0, 3, 540, MARGIN),
    ruled(404, 136),
  ],
  content: [svg(912, 4, 36, 34, starBody("#FBE29C"), [40, 38]), block(40, 0, 3, 531, MARGIN)],
  picture: [
    svg(912, 4, 36, 34, starBody("#FBE29C"), [40, 38]),
    svg(914, 486, 32, 30, starBody("#C9DCF6"), [40, 38]),
  ],
};

/* ------------------------------------------------------------------ Splash: waves and bubbles */

const wavePath = (w: number, y: number, amp: number, len: number, h: number) => {
  let d = `M0 ${y}`;
  for (let x = 0; x < w; x += len) d += ` q${len / 4} ${-amp} ${len / 2} 0 t${len / 2} 0`;
  return `${d} V${h} H0 Z`;
};
const bubbles = (rings: [number, number, number][], stroke = "#B9DDEE") =>
  `<g fill='none' stroke='${stroke}' stroke-width='3'>${rings
    .map(([cx, cy, r]) => `<circle cx='${cx}' cy='${cy}' r='${r}'/>`)
    .join("")}</g>`;

const SPLASH: Art = {
  title: [
    svg(
      0,
      444,
      960,
      96,
      `<path d='${wavePath(1040, 30, 16, 160, 96)}' fill='#E2F3FA' transform='translate(-60 0)'/><path d='${wavePath(1040, 56, 14, 160, 96)}' fill='#CFEAF6'/>`,
    ),
    svg(
      852,
      176,
      96,
      250,
      bubbles([
        [58, 24, 20],
        [30, 88, 13],
        [66, 142, 9],
        [38, 190, 6],
        [60, 232, 4],
      ]),
    ),
  ],
  content: [
    svg(
      908,
      300,
      48,
      226,
      bubbles([
        [24, 204, 14],
        [16, 150, 9],
        [30, 104, 6],
        [18, 66, 4],
        [28, 34, 3],
      ]),
    ),
  ],
  picture: [
    svg(
      910,
      392,
      44,
      134,
      bubbles([
        [22, 112, 12],
        [14, 66, 7],
        [28, 30, 4],
      ]),
    ),
  ],
};

/* ------------------------------------------------------------------ Treehouse: vine, branch, hills */

const leaf = (x: number, y: number, a: number, c: string, s = 1) =>
  `<path d='M0 0 Q18 -15 40 0 Q18 15 0 0 Z' fill='${c}' transform='translate(${x} ${y}) rotate(${a}) scale(${s})'/>`;
const LEAF_A = "#C2DEA8";
const LEAF_B = "#D3E8BF";
const STEM = "#BFDCA3";

const vineBody = (h: number, leaves: [number, number][]) =>
  `<path d='M44 -2 C30 ${h * 0.2} 14 ${h * 0.35} 26 ${h * 0.5} S40 ${h * 0.8} 22 ${h - 4}' fill='none' stroke='${STEM}' stroke-width='5' stroke-linecap='round'/>${leaves
    .map(([y, a], i) => leaf(i % 2 ? 26 : 32, y, a, i % 2 ? LEAF_B : LEAF_A, 0.7))
    .join("")}`;

const branchBody = `<path d='M540 6 C420 30 300 18 180 40 S40 60 -4 52' fill='none' stroke='${STEM}' stroke-width='6' stroke-linecap='round'/>${[
  [470, 20, 110, LEAF_A],
  [400, 26, 70, LEAF_B],
  [330, 22, 115, LEAF_A],
  [255, 32, 65, LEAF_B],
  [180, 40, 110, LEAF_A],
  [110, 50, 72, LEAF_B],
]
  .map(([x, y, a, c]) => leaf(Number(x), Number(y), Number(a), String(c)))
  .join("")}`;

const hillsBody = `<path d='M0 70 C160 20 320 30 480 62 S800 30 960 56 V148 H0 Z' fill='#E2EFD5'/><path d='M0 108 C200 70 420 84 600 104 S860 80 960 96 V148 H0 Z' fill='#D3E8BF'/>`;

const TREEHOUSE: Art = {
  title: [
    svg(420, 0, 540, 104, branchBody, [540, 104]),
    svg(0, 400, 960, 140, hillsBody, [960, 148]),
  ],
  content: [
    svg(
      906,
      0,
      54,
      330,
      vineBody(330, [
        [70, 200],
        [118, -20],
        [170, 195],
        [222, -25],
        [276, 200],
      ]),
      [60, 330],
    ),
  ],
  picture: [
    svg(
      906,
      0,
      54,
      140,
      vineBody(140, [
        [58, 200],
        [104, -20],
      ]),
      [60, 140],
    ),
  ],
};

/* ------------------------------------------------------------------ the clean themes: title only */

const CHALK: Art = { title: [block(0, 458, 960, 82, "#F2E8D2")] };
const READING_ROOM: Art = {
  title: [block(0, 0, 30, 540, "#CCDAD2"), block(36, 0, 3, 540, "#CCDAD2")],
};
const STUDIO: Art = {
  title: [
    svg(
      684,
      416,
      240,
      104,
      Array.from({ length: 6 * 12 }, (_, i) => {
        const cx = 10 + (i % 12) * 20;
        const cy = 10 + Math.floor(i / 12) * 17;
        return `<circle cx='${cx}' cy='${cy}' r='2.2' fill='#DDE4EC'/>`;
      }).join(""),
    ),
  ],
};
const EXAM_HALL: Art = { title: [block(0, 0, 960, 28, "#DCE3EF")] };
const NIGHT_LAB: Art = {
  title: [
    svg(
      600,
      404,
      360,
      136,
      `<g stroke='#2A303A' stroke-width='1'>${Array.from(
        { length: 16 },
        (_, i) => `<line x1='${i * 24 + 0.5}' y1='0' x2='${i * 24 + 0.5}' y2='136'/>`,
      ).join("")}${Array.from(
        { length: 6 },
        (_, i) => `<line x1='0' y1='${i * 24 + 0.5}' x2='360' y2='${i * 24 + 0.5}'/>`,
      ).join("")}</g>`,
    ),
  ],
};
const BEACON: Art = { title: [block(0, 456, 960, 84, "#DCE6FA")] };

export const THEME_ART: Record<string, Art> = {
  chalk: CHALK,
  playground: PLAYGROUND,
  crayon: CRAYON,
  splash: SPLASH,
  treehouse: TREEHOUSE,
  "reading-room": READING_ROOM,
  studio: STUDIO,
  "exam-hall": EXAM_HALL,
  "night-lab": NIGHT_LAB,
  beacon: BEACON,
};
