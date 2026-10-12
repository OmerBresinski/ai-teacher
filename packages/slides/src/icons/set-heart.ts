// Y6 heart and circulation. 240 viewBox, medium level is the base drawing.

import { DROP, HEART_BODY, LUNG } from "./core";
import { AR, C, CLIP, E, F, FIG, H, IL, L, P, R, RR, SH, TX } from "./kit";
import type { IconDrawing } from "./types";

// small heart glyph centred at (x,y), scale s
const miniHeart = (x: number, y: number, s: number): string =>
  `<g transform="translate(${x} ${y}) scale(${s})">${F(HEART_BODY, "var(--flesh)", s)}${SH(HEART_BODY, "M30 -120 C100 -100 150 0 120 80 C90 150 30 170 -20 170 C40 100 60 0 30 -120Z", "var(--flesh-d)")}</g>`;
// a tube seen from the side with a cut end on the left: wall thickness tells artery from vein
const tube = (
  body: string,
  bodyD: string,
  cut: string,
  lumen: string,
  lumenR: [number, number],
): string => {
  const sil = "M52 92 L196 92 Q212 92 212 108 L212 140 Q212 156 196 156 L52 156Z";
  return `${F(sil, body)}${SH(sil, "M40 132 L220 132 L220 170 L40 170Z", bodyD)}
    ${E(52, 124, 20, 32, cut)}${E(54, 124, lumenR[0], lumenR[1], lumen, false)}`;
};
const cell = (x: number, y: number, r: number, c: string, n: string): string =>
  `${C(x, y, r, c)}${C(x + r * 0.15, y - r * 0.1, r * 0.36, n, false)}`;
const bubble = (
  x: number,
  y: number,
  r: number,
  fill: string,
  txt: string,
  sub: string,
  ink: string,
): string =>
  `${C(x, y, r, fill)}${TX(x - (sub ? r * 0.12 : 0), y + r * 0.3, txt, r * 0.78, ink, sub)}<path d="M${x - r * 0.55} ${y - r * 0.2} A${r * 0.62} ${r * 0.62} 0 0 1 ${x - r * 0.1} ${y - r * 0.62}" class="hl" style="--gw:${Math.max(3, r * 0.12)}px"/>`;

export const HEART: Record<string, IconDrawing> = {
  "blood-vessels": {
    name: "Blood vessels",
    svg: () => `${L("M40 196 C70 150 90 120 120 112 C150 104 170 80 196 44", "var(--flesh)", 30)}
      ${L("M120 112 C150 120 176 140 204 150", "var(--flesh)", 22)}
      ${L("M28 150 C52 110 78 82 110 72 C138 64 150 50 162 30", "var(--vein)", 26)}
      ${IL("M50 180 C76 142 96 126 120 120", "#fff", 6, 'class="hl"')}
      ${E(40, 196, 16, 10, "var(--flesh-d)", true, 'transform="rotate(-30 40 196)"')}
      ${E(28, 150, 14, 9, "var(--vein-d)", true, 'transform="rotate(-35 28 150)"')}`,
  },
  artery: {
    name: "Artery",
    svg: () => `${tube("var(--flesh)", "var(--flesh-d)", "var(--flesh-l)", "var(--flesh-d)", [8, 13])}
      ${H("M80 104 L180 104", 8)}
      ${AR("M96 58 L178 58", "var(--icon-ink)", 9)}
      <g class="dt">${IL("M100 124 L190 124", "var(--flesh-d)", 4, 'opacity=".35"')}</g>`,
  },
  vein: {
    name: "Vein",
    svg: () => `${tube("var(--vein)", "var(--vein-d)", "var(--sky)", "var(--vein-d)", [15, 26])}
      ${IL("M120 98 C132 112 136 120 140 124 M120 150 C132 136 136 128 140 124 M164 98 C176 112 180 120 184 124 M164 150 C176 136 180 128 184 124", "var(--sky)", 6)}
      ${H("M80 104 L112 104", 8)}
      ${AR("M178 58 L96 58", "var(--icon-ink)", 9)}`,
  },
  capillary: {
    name: "Capillary",
    svg: () => {
      const caps = [56, 98, 142, 184].map(
        (y) => `M62 120 C80 120 76 ${y} 96 ${y} L144 ${y} C164 ${y} 160 120 178 120`,
      );
      return `${L("M14 120 L66 120", "var(--flesh)", 30)}${L("M174 120 L226 120", "var(--vein)", 30)}
      ${caps.map((d) => L(d, "var(--vein)", 9)).join("")}
      ${CLIP("M0 0 L120 0 L120 240 L0 240Z", caps.map((d) => IL(d, "var(--o2)", 9)).join(""))}
      <g class="dt">${cell(120, 77, 8, "var(--gut)", "var(--vein-d)")}${cell(120, 163, 8, "var(--gut)", "var(--vein-d)")}</g>
      ${H("M24 110 L52 110", 7)}`;
    },
  },

  "circulatory-system": {
    name: "Circulatory system",
    svg: () => `${L("M96 92 L70 150 M144 92 L170 150", "var(--icon-tint)", 24)}${L("M108 150 L102 214 M132 150 L138 214", "var(--icon-tint)", 26)}
      ${RR(82, 72, 76, 92, "var(--icon-tint)", "rr")}${C(120, 44, 24, "var(--icon-tint)")}
      ${IL("M116 98 L114 40 M114 104 L94 96 L74 148 M116 112 L106 158 L102 210", "var(--flesh)", 6)}
      ${IL("M132 98 L126 40 M134 104 L148 96 L168 148 M130 112 L136 158 L140 210", "var(--vein)", 6)}
      ${miniHeart(124, 104, 0.17)}
      <g class="dt">${IL("M114 58 L104 46 M114 58 L124 46", "var(--flesh)", 4)}</g>`,
    small: () => `${RR(76, 70, 88, 100, "var(--pink)", "rr")}${C(120, 42, 26, "var(--pink)")}
      ${IL("M112 100 L106 40 M112 120 L104 200", "var(--flesh)", 10)}${IL("M132 100 L134 40 M132 120 L140 200", "var(--vein)", 10)}${miniHeart(122, 110, 0.28)}`,
  },
  "blood-route": {
    name: "Route of the blood",
    svg: () => `${AR("M100 108 C66 100 62 66 84 56", "var(--vein)", 10)}${AR("M156 56 C178 66 174 100 142 108", "var(--flesh)", 10)}
      ${AR("M142 150 C180 160 184 186 166 196", "var(--flesh)", 10)}${AR("M74 196 C56 186 60 160 98 150", "var(--vein)", 10)}
      <g transform="translate(120 30) scale(.42) translate(-120 -120)">${F(LUNG, "var(--pink)", 0.42)}<g transform="translate(240 0) scale(-1 1)">${F(LUNG, "var(--pink)", 0.42)}</g></g>
      ${RR(78, 186, 84, 40, "var(--gut)", "rr2")}<g class="dl">${cell(100, 206, 9, "var(--stomach)", "var(--vein-d)")}${cell(124, 206, 9, "var(--stomach)", "var(--vein-d)")}${cell(146, 206, 9, "var(--stomach)", "var(--vein-d)")}</g>
      ${miniHeart(120, 126, 0.26)}`,
    small: () => `${L("M120 120 m-62 0 a62 40 0 1 0 124 0 a62 40 0 1 0 -124 0", "var(--flesh)", 14)}
      ${IL("M58 120 a62 40 0 0 1 62 -40", "var(--vein)", 14)}${IL("M182 120 a62 40 0 0 1 -62 40", "var(--vein)", 14)}${miniHeart(120, 118, 0.34)}`,
  },
  "heart-chambers": {
    name: "Heart chambers",
    svg: () => `<g transform="translate(120 122) scale(.62)">
      ${L("M-40 -96 C-40 -150 30 -170 80 -140", "var(--flesh-d)", 30, 0.62)}${L("M-86 -60 L-92 -150", "var(--vein)", 28, 0.62)}
      ${F(HEART_BODY, "var(--flesh-d)", 0.62)}
      ${P("M-100 -50 C-100 -88 -24 -96 -12 -60 C-8 -36 -30 -14 -60 -14 C-86 -14 -100 -28 -100 -50Z", "var(--vein)")}
      ${P("M12 -64 C22 -96 100 -90 104 -50 C106 -26 88 -12 60 -12 C30 -12 8 -36 12 -64Z", "var(--flesh-l)")}
      ${P("M-108 0 L-12 0 L-10 128 C-48 104 -96 56 -108 0Z", "var(--vein)")}
      ${P("M10 0 L114 0 C108 60 60 110 8 140 Z", "var(--flesh-l)")}
      ${IL("M-40 -16 L-46 6 M-24 6 L-30 -16 M50 -14 L44 4 M70 4 L64 -14", "#fff", 6, 'opacity=".9"')}
      ${H("M-110 -70 C-104 -90 -84 -100 -64 -100", 12)}</g>`,
  },
  "lungs-oxygen": {
    name: "Lungs collect oxygen",
    svg: () => `<g transform="translate(18 26) scale(.85)">${L("M120 32 L120 96", "var(--pink-d)", 14, 0.85)}
      ${F(LUNG, "var(--pink)", 0.85)}${SH(LUNG, "M40 150 C70 170 90 170 112 150 L112 220 L30 220Z", "var(--pink-d)")}
      <g transform="translate(240 0) scale(-1 1)">${F(LUNG, "var(--pink)", 0.85)}${SH(LUNG, "M40 150 C70 170 90 170 112 150 L112 220 L30 220Z", "var(--pink-d)")}</g></g>
      ${bubble(54, 54, 30, "var(--sky)", "O", "2", "var(--icon-ink)")}
      ${AR("M78 76 L94 110", "var(--icon-ink)", 7)}`,
  },
  oxygen: {
    name: "Oxygen",
    svg: () =>
      `${bubble(108, 124, 74, "var(--sky)", "O", "2", "var(--icon-ink)")}${C(186, 70, 22, "var(--sky)")}${C(190, 170, 14, "var(--sky)")}`,
  },
  "carbon-dioxide": {
    name: "Carbon dioxide",
    svg: () =>
      `${bubble(112, 126, 76, "var(--metal)", "CO", "2", "var(--icon-ink)")}${C(192, 66, 20, "var(--metal)")}${C(196, 172, 13, "var(--metal)")}`,
  },
  nutrients: {
    name: "Nutrients",
    svg: () => {
      const apple =
        "M120 84 C96 66 50 74 50 124 C50 176 86 210 110 204 C116 202 124 202 130 204 C154 210 190 176 190 124 C190 74 144 66 120 84Z";
      return `${RR(130, 120, 82, 82, "var(--sand)", "rr")}${RR(140, 132, 62, 62, "var(--sand-l)", "rr2", false)}
      <g transform="translate(-22 4) scale(.82)">${L("M120 84 C120 66 124 54 132 44", "var(--earth-d)", 9, 0.82)}
      ${F("M126 60 C140 38 170 36 182 48 C168 66 144 70 126 60Z", "var(--leaf)", 0.82)}
      ${F(apple, "var(--leaf-l)", 0.82)}${SH(apple, "M150 80 C200 110 196 190 130 206 C170 170 176 120 150 80Z", "var(--leaf-d)")}
      ${H("M70 116 C72 100 80 90 92 86", 10)}</g>
      <g class="dl">${C(180, 60, 9, "var(--sun)")}${C(204, 84, 7, "var(--icon-secondary)")}${C(206, 52, 6, "var(--icon-primary)")}</g>`;
    },
  },
  "water-in-blood": {
    name: "Water",
    svg: () =>
      `<g transform="translate(120 120) scale(.66)">${F(DROP, "var(--water)", 0.66)}${SH(DROP, "M40 -100 C120 0 140 120 0 150 L200 150 L200 -100Z", "var(--water-d)")}${H("M-70 40 C-70 0 -50 -30 -30 -56", 16)}</g>`,
  },
  digestion: {
    name: "Digestion",
    svg: () => `${L("M44 66 L196 66 C214 66 214 98 196 98 L60 98 C40 98 40 130 60 130 L180 130 C200 130 200 162 180 162 L76 162 C58 162 58 194 76 194 L150 194", "var(--gut)", 24)}
      ${IL("M44 66 L196 66 C214 66 214 98 196 98 L60 98 C40 98 40 130 60 130 L180 130 C200 130 200 162 180 162 L76 162 C58 162 58 194 76 194 L150 194", "var(--gut-d)", 5, 'class="sh" stroke-dasharray="2 14"')}
      ${C(110, 40, 9, "var(--sun)")}${C(140, 34, 7, "var(--leaf)")}${C(168, 42, 8, "var(--icon-primary)")}
      ${H("M60 60 L120 60", 5)}`,
  },
  "body-cells": {
    name: "Body cells",
    svg: () => {
      const blob = (x: number, y: number, s: number, r: number) =>
        `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">${F("M-50 -10 C-50 -46 -10 -56 20 -46 C54 -36 58 0 50 26 C40 54 0 58 -26 46 C-46 36 -50 14 -50 -10Z", "var(--gut)", s)}${E(4, -2, 18, 15, "var(--vein)", false)}${C(9, -6, 5, "var(--vein-d)", false)}${H("M-34 -18 C-30 -32 -18 -40 -4 -40", 7)}</g>`;
      return `${blob(84, 92, 1, 0)}${blob(160, 104, 0.82, 30)}${blob(110, 172, 0.9, -20)}`;
    },
  },
  muscles: {
    name: "Muscles",
    svg: () => {
      const arm =
        "M24 198 L24 152 C24 140 30 134 42 132 C62 100 116 96 140 124 L148 130 L152 102 C140 94 136 70 146 54 C156 38 186 36 198 50 C210 64 208 86 196 100 L192 178 C190 200 176 210 156 210 L36 210 C28 210 24 206 24 198Z";
      return `${F(arm, "var(--clay-l)")}${SH(arm, "M20 186 C80 196 160 196 200 150 L210 214 L20 214Z", "var(--clay)")}
      ${P("M50 140 C66 112 112 108 134 132 C112 148 76 150 50 140Z", "var(--clay)", 'opacity=".55"')}
      <g class="dt">${IL("M152 62 C162 58 172 58 182 62 M150 76 C160 72 172 72 184 76", "var(--clay-d)", 4, 'opacity=".6"')}</g>
      ${H("M56 126 C70 114 90 110 108 112", 9)}`;
    },
  },

  pulse: {
    name: "Pulse",
    svg: () => `${miniHeart(120, 112, 0.6)}
      ${L("M14 130 L66 130 L80 104 L98 170 L118 70 L134 130 L226 130", "var(--icon-ink)", 9)}
      ${H("M60 92 C62 74 74 62 90 60", 10)}`,
  },

  "heart-rate": {
    name: "Heart rate",
    svg: () => `${RR(26, 54, 188, 140, "var(--icon-ink)", "rr")}
      <g class="dt">${IL("M44 90 L196 90 M44 124 L196 124 M44 158 L196 158", "var(--leaf-d)", 2, 'opacity=".55"')}</g>
      ${L("M40 132 L82 132 L94 104 L108 170 L124 82 L138 132 L200 132", "var(--leaf-l)", 8)}
      ${miniHeart(176, 70, 0.14)}`,
  },
  exercise: {
    name: "Exercise",
    svg: () =>
      FIG(
        146,
        46,
        "M126 80 L110 136 M110 136 L144 170 L140 214 M110 136 L76 168 L44 166 M124 88 L156 110 L186 98 M124 88 L94 104 L74 82",
        "var(--icon-primary)",
        22,
      ) +
      `<g class="dt">${IL("M30 100 L56 100 M20 130 L54 130 M34 160 L54 160", "var(--icon-secondary)", 7)}</g>`,
  },
  rest: {
    name: "At rest",
    svg: () => `${RR(60, 140, 108, 18, "var(--wood)", "rr2")}${L("M72 158 L72 214 M156 158 L156 214", "var(--wood-d)", 12)}
      ${FIG(110, 52, "M108 86 L108 136 M108 136 L156 136 L160 200 M108 98 L140 116 L150 132", "var(--icon-primary)", 22)}
      <g class="dt">${TX(176, 70, "z", 30, "var(--icon-secondary)")}${TX(198, 46, "z", 22, "var(--icon-secondary)")}</g>`,
  },
  timer: {
    name: "Count for one minute",
    svg: () => `${RR(106, 22, 28, 22, "var(--metal-d)", "rr2")}${L("M168 66 L180 54", "var(--metal-d)", 14)}
      ${C(120, 132, 82, "var(--icon-primary)")}${C(120, 132, 64, "#fff", false)}
      ${IL("M120 76 L120 88 M176 132 L164 132 M120 188 L120 176 M64 132 L76 132", "var(--icon-ink)", 6)}
      ${P("M120 132 L120 76 A56 56 0 0 1 168 106 Z", "var(--icon-tint)")}
      ${L("M120 132 L150 92", "var(--icon-ink)", 8)}${C(120, 132, 9, "var(--icon-ink)", false)}
      ${H("M60 104 C66 88 78 74 94 66", 9)}`,
  },
  "pulse-graph": {
    name: "Pulse results",
    svg: () => `${RR(64, 128, 46, 82, "var(--icon-secondary)", "rr2")}${RR(134, 64, 46, 146, "var(--icon-primary)", "rr2")}
      ${SH("M134 64 L180 64 L180 210 L134 210Z", "M160 60 L184 60 L184 214 L160 214Z", "var(--icon-primary-dark)")}
      ${IL("M40 30 L40 212 L210 212", "var(--icon-ink)", 8)}
      ${miniHeart(157, 38, 0.12)}`,
  },
  "balanced-diet": {
    name: "Balanced diet",
    svg: () => {
      const seg = (a0: number, a1: number, c: string) => {
        const r = 70,
          p = (a: number): [number, number] => [
            120 + r * Math.cos((a * Math.PI) / 180),
            120 + r * Math.sin((a * Math.PI) / 180),
          ];
        const [x0, y0] = p(a0),
          [x1, y1] = p(a1);
        return P(
          `M120 120 L${x0.toFixed(1)} ${y0.toFixed(1)} A70 70 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`,
          c,
        );
      };
      return `${C(120, 120, 96, "#fff")}${C(120, 120, 80, "var(--metal)", false)}
      ${seg(-90, 30, "var(--leaf)")}${seg(30, 140, "var(--sun)")}${seg(140, 205, "var(--pink)")}${seg(205, 240, "var(--water)")}${seg(240, 270, "var(--icon-secondary-dark)")}
      ${IL("M120 120 L120 50 M120 120 L180.6 155 M120 120 L66.4 165 M120 120 L56.6 90.4 M120 120 L85 59.4", "#fff", 5)}
      ${C(150, 80, 9, "var(--flesh)", false)}${C(160, 98, 7, "var(--leaf-d)", false)}
      ${H("M44 96 C52 72 70 52 94 42", 8)}`;
    },
  },
  salt: {
    name: "Salt",
    svg: () => {
      const body =
        "M76 92 L164 92 L176 206 C176 214 170 218 162 218 L78 218 C70 218 64 214 64 206Z";
      return `${F("M80 92 C80 50 160 50 160 92Z", "var(--metal)")}${C(104, 72, 4, "var(--icon-ink)", false)}${C(120, 66, 4, "var(--icon-ink)", false)}${C(136, 72, 4, "var(--icon-ink)", false)}
      ${F(body, "var(--glass)")}${CLIP(body, R(50, 140, 140, 90, "var(--natron)", false))}${SH(body, "M140 90 L190 90 L190 220 L140 220Z", "var(--metal-d)")}
      ${R(74, 88, 92, 12, "var(--metal-d)", true)}
      <g class="dt">${R(118, 30, 6, 6, "var(--metal-d)", false)}${R(98, 22, 6, 6, "var(--metal-d)", false)}${R(140, 18, 6, 6, "var(--metal-d)", false)}</g>
      ${H("M84 120 L80 190", 8)}`;
    },
  },
  "fatty-food": {
    name: "Fatty food",
    svg: () => {
      const box = "M58 112 L182 112 L166 214 L74 214Z";
      return `${(
        [
          [78, 40, -12],
          [98, 30, -5],
          [118, 26, 0],
          [140, 30, 6],
          [160, 38, 12],
        ] as const
      )
        .map(
          ([x, y, r]) =>
            `<g transform="rotate(${r} ${x + 9} 120)">${RR(x, y, 18, 100, "var(--sun)", "rr2")}</g>`,
        )
        .join("")}
      ${F(box, "var(--roman)")}${SH(box, "M130 110 L190 110 L170 220 L130 220Z", "var(--roman-d)")}
      ${IL("M66 136 L174 136", "#fff", 8, 'opacity=".85"')}
      ${H("M70 128 L80 190", 7)}`;
    },
  },
  smoking: {
    name: "Smoking",
    svg: () => `<g transform="rotate(-24 120 150)">${RR(40, 134, 112, 30, "var(--enamel)", "rr2")}${RR(152, 134, 46, 30, "var(--clay-l)", "rr2")}
      ${P("M40 134 L52 134 L52 164 L40 164Z", "var(--fire)")}${P("M40 134 L46 134 L46 164 L40 164Z", "var(--fire-l)")}
      <g class="dt">${IL("M164 142 L188 142 M164 156 L188 156", "var(--clay-d)", 3, 'opacity=".5"')}</g></g>
      ${L("M50 124 C34 104 58 92 46 72 C36 56 54 44 52 28", "var(--smoke)", 12)}`,
  },
  alcohol: {
    name: "Alcohol",
    svg: () => {
      const bottle =
        "M146 22 L170 22 L170 70 C192 84 196 100 196 120 L196 206 C196 214 190 218 182 218 L134 218 C126 218 120 214 120 206 L120 120 C120 100 124 84 146 70Z";
      const glass = "M34 76 L112 76 C112 120 98 142 73 142 C48 142 34 120 34 76Z";
      return `${F(bottle, "var(--leaf-d)")}${SH(bottle, "M170 60 L200 60 L200 220 L170 220Z", "var(--icon-ink)")}${RR(126, 136, 64, 46, "var(--sand-l)", "rr2", false)}
      ${F(glass, "var(--glass)")}${CLIP(glass, P("M30 100 L116 100 L116 150 L30 150Z", "var(--roman)"))}
      ${L("M73 142 L73 200", "var(--glass)", 10)}${RR(44, 196, 58, 14, "var(--glass)", "rr2")}
      ${H("M134 120 L134 196", 8)}${H("M44 86 C44 100 48 112 54 120", 6)}`;
    },
  },
  "healthy-heart": {
    name: "Healthy heart",
    svg: () => `${miniHeart(110, 118, 0.62)}
      ${C(178, 176, 34, "var(--leaf)")}${IL("M162 176 L174 188 L196 162", "#fff", 10)}
      ${H("M50 96 C52 76 66 62 84 60", 11)}`,
  },
  harm: {
    name: "Harm",
    svg: () => `<g transform="translate(110 118) scale(.62)">${F(HEART_BODY, "var(--flesh-l)", 0.62)}${SH(HEART_BODY, "M30 -120 C100 -100 150 0 120 80 C90 150 30 170 -20 170 C40 100 60 0 30 -120Z", "var(--flesh-d)")}
      ${L("M-6 -96 L18 -40 L-20 0 L16 50 L-4 140", "var(--icon-ink)", 10, 0.62)}</g>
      ${F("M176 134 L214 200 L138 200Z", "var(--sun)")}${IL("M176 156 L176 178", "var(--icon-ink)", 8)}${C(176, 190, 4.5, "var(--icon-ink)", false)}`,
  },
  "blood-pressure": {
    name: "Blood pressure",
    svg: () => {
      const arc = (a0: number, a1: number, c: string) => {
        const p = (a: number): [number, number] => [
          120 + 66 * Math.cos((a * Math.PI) / 180),
          136 + 66 * Math.sin((a * Math.PI) / 180),
        ];
        const [x0, y0] = p(a0),
          [x1, y1] = p(a1);
        return IL(
          `M${x0.toFixed(1)} ${y0.toFixed(1)} A66 66 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`,
          c,
          16,
          'style="stroke-linecap:butt"',
        );
      };
      return `${C(120, 136, 90, "var(--metal)")}${C(120, 136, 78, "#fff", false)}
      ${arc(165, 230, "var(--leaf)")}${arc(230, 300, "var(--sun)")}${arc(300, 375, "var(--flesh)")}
      ${L("M120 136 L170 96", "var(--icon-ink)", 9)}${C(120, 136, 12, "var(--icon-ink)", false)}
      ${miniHeart(120, 186, 0.14)}
      ${H("M50 110 C56 90 70 72 90 62", 9)}`;
    },
  },
};
