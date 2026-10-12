// The v1 pilot drawings the library reuses (pilot icons.js), keyed by concept id as the pilot's
// library.js REUSE map did: light <- sun. Drawings use the colour slots in palette.ts only.
import { C, E, F, H, IL, L, P, SH } from "./kit";
import type { IconDrawing } from "./types";

export const HEART_BODY =
  "M-30 -98 C40 -124 126 -86 128 -8 C130 68 64 124 18 150 C-6 162 -24 154 -44 134 C-100 88 -132 32 -128 -30 C-124 -80 -82 -104 -30 -98 Z";
export const DROP =
  "M0 -150 C40 -90 118 -20 118 50 C118 116 66 150 0 150 C-66 150 -118 116 -118 50 C-118 -20 -40 -90 0 -150Z";
export const LUNG =
  "M108 96 C104 74 92 62 78 66 C52 74 38 124 40 168 C41 196 58 208 84 200 L104 192 C110 189 112 183 112 176 Z";
export const CONE = "M28 208 L94 92 C100 82 140 82 146 92 L212 208Z";

export const CORE: Record<string, IconDrawing> = {
  heart: {
    name: "Heart",
    subject: "Science",
    ks: "KS2",
    svg: () => `<g transform="translate(120 128) scale(.6) rotate(-6)">
      ${L("M-56 -80 L-62 -136", "var(--flesh-d)", 28, 0.6)}
      ${L("M-4 -90 C-4 -150 50 -168 96 -146", "var(--flesh-d)", 32, 0.6)}
      ${L("M-96 -54 L-118 -98", "var(--water)", 22, 0.6)}
      ${F(HEART_BODY, "var(--flesh)", 0.6)}
      ${SH(HEART_BODY, "M30 -120 C100 -100 150 0 120 80 C90 150 30 170 -20 170 C40 100 60 0 30 -120Z", "var(--flesh-d)")}
      <g class="dt">${IL("M18 -96 C0 -30 10 60 40 130", "var(--flesh-d)", 7, 'opacity=".45"')}</g>
      <g class="dl">${IL("M-60 -60 C-80 -10 -60 50 -30 96 M-70 10 C-50 20 -40 40 -36 60 M60 -60 C90 -20 96 30 80 70 M80 0 C60 10 52 30 50 50", "var(--flesh-d)", 5, 'opacity=".5"')}</g>
      ${H("M-96 -32 C-94 -62 -72 -78 -46 -78", 13)}</g>`,
  },
  lungs: {
    name: "Lungs",
    subject: "Science",
    ks: "KS2",
    svg: () => `${L("M120 32 L120 96", "var(--pink-d)", 14)}
      ${L("M120 92 C118 104 112 108 104 116 M120 92 C122 104 128 108 136 116", "var(--pink-d)", 10)}
      ${F(LUNG, "var(--pink)")}${SH(LUNG, "M40 150 C70 170 90 170 112 150 L112 220 L30 220Z", "var(--pink-d)")}
      <g transform="translate(240 0) scale(-1 1)">${F(LUNG, "var(--pink)")}${SH(LUNG, "M40 150 C70 170 90 170 112 150 L112 220 L30 220Z", "var(--pink-d)")}</g>
      ${IL("M104 120 C92 130 86 140 82 156 M136 120 C148 130 154 140 158 156", "var(--pink-d)", 5, 'opacity=".6"')}
      ${H("M58 120 C60 100 66 86 76 80", 9)}`,
  },
  blood: {
    name: "Blood",
    subject: "Science",
    ks: "KS2",
    svg: () => `<g transform="translate(120 122) scale(.66)">${F(DROP, "var(--flesh-tint)", 0.66)}
      <g transform="translate(-40 40) rotate(-20)"><ellipse rx="40" ry="30" style="fill:var(--flesh)"/><ellipse rx="19" ry="12" style="fill:var(--flesh-d);opacity:.55"/></g>
      <g transform="translate(46 70) rotate(25)"><ellipse rx="40" ry="30" style="fill:var(--flesh)"/><ellipse rx="19" ry="12" style="fill:var(--flesh-d);opacity:.55"/></g>
      <g transform="translate(18 -20) rotate(10)"><ellipse rx="34" ry="25" style="fill:var(--flesh-l)"/><ellipse rx="16" ry="10" style="fill:var(--flesh-d);opacity:.5"/></g>
      <circle cx="66" cy="10" r="11" style="fill:#fff;stroke:var(--flesh);stroke-width:5"/>
      <circle cx="-74" cy="96" r="9" style="fill:#fff;stroke:var(--flesh);stroke-width:5"/></g>`,
  },
  seedling: {
    name: "Seedling",
    subject: "Science",
    ks: "KS1",
    svg: () => `${L("M120 152 C120 124 116 104 122 80", "var(--leaf-d)", 10)}
      ${F("M120 104 C98 76 62 78 48 100 C74 120 104 120 120 104Z", "var(--leaf)")}
      ${F("M122 84 C138 52 180 46 196 64 C180 92 148 98 122 84Z", "var(--leaf)")}
      <g class="dt">${IL("M118 104 C96 100 78 100 60 100 M124 84 C146 76 166 70 186 64", "var(--leaf-d)", 4, 'opacity=".55"')}</g>
      ${F("M72 150 L168 150 L158 214 L82 214Z", "var(--clay)")}
      ${SH("M72 150 L168 150 L158 214 L82 214Z", "M128 150 L170 150 L160 214 L120 214Z", "var(--clay-d)")}
      <rect x="62" y="138" width="116" height="24" class="o rr" style="fill:var(--clay-l)"/>
      <g class="dl">${P("M70 140 C90 132 150 132 170 140 L170 146 L70 146Z", "var(--earth-d)")}${E(146, 136, 9, 6, "var(--sand)", false)}${IL("M100 176 L140 176 M96 194 L144 194", "var(--clay-d)", 3, 'opacity=".5"')}</g>
      ${H("M60 98 C70 90 82 86 94 86", 7)}`,
  },
  light: {
    name: "Light (sun)",
    subject: "Science",
    ks: "KS1",
    svg: () => `${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<g transform="rotate(${a} 120 120)">${L("M120 52 L120 26", "var(--sun-d)", 16)}</g>`).join("")}
      ${C(120, 120, 52, "var(--sun)")}${SH("M68 120 A52 52 0 1 0 172 120 A52 52 0 1 0 68 120Z", "M150 70 C190 110 170 180 110 176 C150 160 170 120 150 70Z", "var(--sun-d)")}
      ${H("M88 104 C92 92 100 84 112 80", 10)}`,
  },
  volcano: {
    name: "Volcano",
    subject: "Geography",
    ks: "KS3",
    svg: () => `${C(98, 62, 18, "var(--smoke)")}${C(124, 46, 24, "var(--smoke)")}${C(150, 62, 18, "var(--smoke)")}
      ${F(CONE, "var(--earth)")}${SH(CONE, "M120 80 L220 80 L220 220 L150 220 Z", "var(--earth-d)")}
      ${P("M96 90 C104 84 136 84 144 90 C136 98 104 98 96 90Z", "var(--fire)")}
      <g class="dl">${IL("M62 168 C100 160 140 164 178 168 M44 196 C100 186 150 190 196 196 M80 136 C104 130 136 132 160 136", "var(--earth-d)", 4, 'opacity=".6"')}${IL("M120 96 L120 208", "var(--fire-l)", 6, 'opacity=".8"')}</g>
      <g class="dt">${L("M104 94 C98 122 108 134 100 162", "var(--fire)", 13)}${L("M136 94 C142 116 134 126 144 146", "var(--fire-l)", 10)}</g>
      ${H("M70 160 L92 120", 9)}`,
  },
};
