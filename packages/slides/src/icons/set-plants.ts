// Y3 plants and healthy growth. 240 viewBox, medium level is the base drawing.

import { DROP } from "./core";
import { AR, C, CLIP, E, F, H, IL, L, P, R, RR, SH } from "./kit";
import type { IconDrawing } from "./types";

// leaf with its base at (x,y), length n, angle a (deg), scale-corrected outline k
const leaf = (
  x: number,
  y: number,
  n: number,
  a: number,
  c = "var(--leaf)",
  k = 1,
  vein = true,
): string => {
  const d = `M0 0 C${n * 0.3} ${-n * 0.4} ${n * 0.75} ${-n * 0.38} ${n} 0 C${n * 0.75} ${n * 0.38} ${n * 0.3} ${n * 0.4} 0 0Z`;
  return `<g transform="translate(${x} ${y}) rotate(${a})">${F(d, c, k)}${vein ? `<g class="dt">${IL(`M${n * 0.08} 0 L${n * 0.85} 0`, "var(--leaf-d)", 3.5, 'opacity=".5"')}</g>` : ""}</g>`;
};
// terracotta pot, rim top at y0, centred on cx, scale s
const pot = (
  cx = 120,
  y0 = 150,
  s = 1,
  soil = true,
): string => `<g transform="translate(${cx} ${y0}) scale(${s})">
  ${F("M-48 0 L48 0 L38 64 L-38 64Z", "var(--clay)", s)}${SH("M-48 0 L48 0 L38 64 L-38 64Z", "M8 0 L50 0 L40 64 L0 64Z", "var(--clay-d)")}
  <rect x="-58" y="-12" width="116" height="24" class="o rr" style="fill:var(--clay-l);--k:${s}"/>
  ${soil ? P("M-50 -10 C-30 -18 30 -18 50 -10 L50 -4 L-50 -4Z", "var(--earth-d)") : ""}</g>`;
// cloud built from circles: outline pass then fill pass so no inner seams
type Circle = [number, number, number];
const cloud = (circles: Circle[], c: string): string =>
  circles.map(([x, y, r]) => C(x, y, r, c)).join("") +
  circles.map(([x, y, r]) => C(x, y, r, c, false)).join("");
const badge = (x: number, y: number, inner: string, c = "#fff"): string =>
  `${C(x, y, 30, c)}${inner}${L(`M${x - 20} ${y - 20} L${x + 20} ${y + 20}`, "var(--flesh)", 8)}`;
const drop = (x: number, y: number, s: number, c = "var(--water)"): string =>
  `<g transform="translate(${x} ${y}) scale(${s})">${F(DROP, c, s)}</g>`;
const sunGlyph = (x: number, y: number, r: number): string =>
  `${[0, 60, 120, 180, 240, 300].map((a) => `<g transform="rotate(${a} ${x} ${y})">${IL(`M${x} ${y - r - 6} L${x} ${y - r - 14}`, "var(--sun-d)", 5)}</g>`).join("")}${C(x, y, r, "var(--sun)")}`;

export const PLANTS: Record<string, IconDrawing> = {
  plant: {
    name: "Plant",
    svg: () => `${L("M120 150 L120 40", "var(--leaf-d)", 10)}
      ${leaf(120, 124, 70, 200)}${leaf(120, 112, 70, -20)}${leaf(120, 84, 58, 210)}${leaf(120, 72, 58, -30)}${leaf(120, 48, 40, -80)}
      ${pot(120, 156, 0.95)}${H("M58 112 C66 104 76 100 88 100", 6)}`,
  },
  seed: {
    name: "Seed",
    svg: () => {
      const sd = "M0 -62 C30 -40 40 0 32 30 C26 52 -26 52 -32 30 C-40 0 -30 -40 0 -62Z";
      const one = (x: number, y: number, r: number, s: number, c: string, d: string) =>
        `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">${F(sd, c, s)}${SH(sd, "M6 -70 C40 -30 50 30 20 60 L60 60 L60 -70Z", d)}${IL("M0 -44 C6 -14 6 14 0 38", d, 5, 'opacity=".7"')}${H("M-18 -10 C-16 -28 -10 -40 -4 -46", 7)}</g>`;
      return `${one(76, 150, -28, 0.95, "var(--earth)", "var(--earth-d)")}${one(164, 156, 24, 0.95, "var(--sand)", "var(--clay)")}${one(122, 96, 4, 1.15, "var(--clay)", "var(--clay-d)")}`;
    },
  },

  germination: {
    name: "Germination",
    svg: () => `${RR(24, 118, 192, 98, "var(--earth)", "rr")}${P("M30 118 L210 118 L210 128 L30 128Z", "var(--earth-d)", 'class="sh"')}
      <g class="dt">${C(60, 190, 6, "var(--stone)", false)}${C(186, 150, 5, "var(--stone)", false)}${C(176, 196, 4, "var(--stone)", false)}</g>
      ${L("M118 160 C112 176 124 186 116 206 M118 186 L100 200 M120 176 L138 192", "var(--sand-l)", 7)}
      ${E(120, 158, 24, 16, "var(--sand)")}${IL("M104 156 C112 150 128 150 136 156", "var(--earth-d)", 3)}
      ${L("M122 146 C124 120 118 96 126 74", "var(--leaf)", 9)}
      ${leaf(126, 76, 36, -150, "var(--leaf)", 1, false)}${leaf(126, 76, 36, -30, "var(--leaf)", 1, false)}`,
  },
  root: {
    name: "Roots",
    svg: () => `${RR(24, 98, 192, 120, "var(--earth)", "rr")}${P("M30 98 L210 98 L210 108 L30 108Z", "var(--earth-d)", 'class="sh"')}
      ${L("M120 92 L120 40", "var(--leaf-d)", 8)}${leaf(120, 58, 40, 200, "var(--leaf)", 1, false)}${leaf(120, 50, 40, -20, "var(--leaf)", 1, false)}
      ${L("M120 96 C116 130 126 160 118 204 M120 120 C100 128 84 132 66 150 M120 120 C140 130 156 134 174 150 M118 150 C100 160 92 170 80 192 M120 150 C140 160 150 170 162 194 M84 140 L70 132 M160 142 L176 136", "var(--sand-l)", 8)}
      ${H("M40 118 L60 118", 6)}`,
  },
  stem: {
    name: "Stem",
    svg: () => `${leaf(120, 150, 44, 200, "var(--leaf-l)", 1, false)}${leaf(120, 110, 44, -20, "var(--leaf-l)", 1, false)}${leaf(120, 70, 36, 210, "var(--leaf-l)", 1, false)}
      ${L("M120 222 C116 170 126 110 118 30", "var(--leaf-d)", 22)}${E(118, 30, 12, 16, "var(--leaf)")}
      ${IL("M112 196 C110 160 118 110 112 56", "#fff", 6, 'class="hl"')}
      <g class="dt">${AR("M150 200 L150 150", "var(--water)", 6, false)}${AR("M150 140 L150 90", "var(--water)", 6, false)}</g>`,
  },
  leaf: {
    name: "Leaf",
    svg: () => {
      const d = "M44 196 C40 120 90 46 204 36 C206 140 150 196 44 196Z";
      return `${L("M44 196 L24 216", "var(--leaf-d)", 9)}${F(d, "var(--leaf)")}${SH(d, "M44 196 L204 36 L220 220Z", "var(--leaf-d)")}
      ${IL("M44 196 C100 140 150 90 196 46 M80 160 L76 116 M80 160 L124 158 M114 126 L114 82 M114 126 L158 126 M146 94 L150 62 M146 94 L180 96", "var(--leaf-d)", 5, 'opacity=".6"')}
      ${H("M66 156 C70 116 96 82 130 64", 9)}`;
    },
  },
  flower: {
    name: "Flower",
    svg: () => `${L("M120 120 C118 160 124 190 120 222", "var(--leaf-d)", 10)}${leaf(121, 182, 50, -30)}
      ${[0, 72, 144, 216, 288].map((a) => `<g transform="rotate(${a} 120 86)">${E(120, 46, 26, 34, "var(--pink)")}</g>`).join("")}
      ${[0, 72, 144, 216, 288].map((a) => `<g transform="rotate(${a} 120 86)">${E(120, 46, 26, 34, "var(--pink)", false)}${IL("M120 30 L120 58", "var(--pink-d)", 4, 'class="dt" opacity=".5"')}</g>`).join("")}
      ${C(120, 86, 22, "var(--sun)")}${C(126, 92, 9, "var(--sun-d)", false, 1)}
      ${H("M96 34 C100 26 108 22 116 22", 6)}`,
  },
  fruit: {
    name: "Fruit",
    svg: () => {
      const apple =
        "M120 70 C92 52 40 60 40 120 C40 180 84 212 112 206 C116 205 124 205 128 206 C156 212 200 180 200 120 C200 60 148 52 120 70Z";
      return `${L("M120 70 C120 52 124 40 132 30", "var(--earth-d)", 9)}${F("M128 46 C140 24 172 22 184 34 C170 52 146 56 128 46Z", "var(--leaf)")}
      ${F(apple, "var(--flesh)")}
      ${P("M120 84 C96 70 56 76 56 122 C56 170 90 196 112 190 C116 189 124 189 128 190 C150 196 184 170 184 122 C184 76 144 70 120 84Z", "var(--enamel)")}
      ${IL("M120 96 C104 110 100 150 120 176 C140 150 136 110 120 96Z", "var(--enamel-d)", 4)}
      ${E(112, 136, 6, 10, "var(--earth-d)", false, 'transform="rotate(-15 112 136)"')}${E(128, 136, 6, 10, "var(--earth-d)", false, 'transform="rotate(15 128 136)"')}
      ${H("M60 100 C64 86 74 78 86 74", 7)}`;
    },
  },
  water: {
    name: "Water",
    svg: () => `<g transform="translate(120 112) scale(.64)">${F(DROP, "var(--water)", 0.64)}${SH(DROP, "M40 -100 C120 0 140 120 0 150 L200 150 L200 -100Z", "var(--water-d)")}${H("M-70 40 C-70 0 -50 -30 -30 -56", 16)}</g>
      ${IL("M40 216 C80 206 160 206 200 216", "var(--water)", 7, 'class="dt"')}`,
  },

  air: {
    name: "Air",
    svg: () => `${L("M24 84 L136 84 C168 84 176 46 150 40 C130 36 122 58 138 64", "var(--sky)", 13)}
      ${L("M24 124 L178 124 C204 124 212 156 190 164 C172 170 162 150 174 142", "var(--sky)", 13)}
      ${L("M40 164 L110 164 C134 164 138 194 118 198", "var(--sky)", 13)}
      ${leaf(150, 192, 42, -40, "var(--leaf)", 1, false)}`,
  },
  "soil-nutrients": {
    name: "Nutrients (soil)",
    svg: () => {
      const mound = "M20 200 C40 130 90 104 120 104 C150 104 200 130 220 200Z";
      return `${F(mound, "var(--earth)")}${SH(mound, "M130 100 C180 120 210 160 224 204 L130 204Z", "var(--earth-d)")}
      ${(
        [
          [80, 160, "var(--sun)"],
          [108, 136, "var(--icon-secondary)"],
          [140, 158, "var(--pink)"],
          [168, 180, "var(--leaf-l)"],
          [62, 186, "var(--icon-secondary)"],
          [120, 180, "var(--sun)"],
          [150, 126, "var(--leaf-l)"],
        ] as const
      )
        .map(
          ([x, y, c], i) =>
            `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" class="o rr2${i > 2 ? " dl" : ""}" transform="rotate(45 ${x} ${y})" style="fill:${c}"/>`,
        )
        .join("")}
      ${AR("M120 90 L120 40", "var(--leaf-d)", 9)}${H("M50 170 C60 150 74 136 90 128", 8)}`;
    },
  },
  "room-to-grow": {
    name: "Room to grow",
    svg: () => `${L("M120 150 L120 92", "var(--leaf-d)", 8)}${leaf(120, 120, 40, 200)}${leaf(120, 104, 40, -20)}
      ${pot(120, 162, 0.7)}
      ${AR("M84 70 L30 70", "var(--icon-secondary)", 9)}${AR("M156 70 L210 70", "var(--icon-secondary)", 9)}${AR("M120 66 L120 22", "var(--icon-secondary)", 9)}`,
  },
  soil: {
    name: "Soil",
    svg: () => `${RR(22, 70, 196, 144, "var(--earth)", "rr")}${P("M28 70 L212 70 L212 80 L28 80Z", "var(--earth-d)", 'class="sh"')}
      ${L("M34 70 L34 52 M50 70 L54 48 M70 70 L66 54 M170 70 L174 50 M190 70 L188 54 M206 70 L210 52", "var(--grass)", 7)}
      ${E(74, 112, 14, 9, "var(--stone)")}${E(168, 172, 16, 10, "var(--stone)")}${E(60, 180, 9, 6, "var(--stone)")}
      ${L("M110 146 C120 130 140 140 150 128 C160 116 172 124 180 118", "var(--pink)", 10)}
      <g class="dt">${C(150, 96, 3, "var(--earth-d)", false)}${C(100, 186, 3, "var(--earth-d)", false)}${C(196, 140, 3, "var(--earth-d)", false)}</g>
      ${H("M38 96 L38 140", 7)}`,
  },
  warmth: {
    name: "Warmth",
    svg: () => `${RR(98, 24, 44, 150, "#fff", "rr")}${C(120, 178, 34, "var(--flesh)")}${RR(110, 70, 20, 110, "var(--flesh)", "rr2", false)}
      ${IL("M142 50 L154 50 M142 74 L154 74 M142 98 L154 98 M142 122 L154 122", "var(--icon-ink)", 4)}
      ${IL("M60 70 C52 84 68 92 60 106 C52 120 68 128 60 142 M186 70 C178 84 194 92 186 106 C178 120 194 128 186 142", "var(--fire)", 7)}
      ${H("M104 168 C104 160 108 154 114 152", 6)}`,
  },
  "healthy-plant": {
    name: "Healthy plant",
    svg: () => `${L("M112 150 L112 40", "var(--leaf-d)", 11)}
      ${leaf(112, 128, 74, 196)}${leaf(112, 112, 74, -16)}${leaf(112, 86, 62, 208)}${leaf(112, 70, 62, -28)}${leaf(112, 46, 42, -84)}
      ${pot(112, 158, 0.9)}${C(186, 186, 30, "var(--leaf)")}${IL("M172 186 L182 196 L200 174", "#fff", 9)}`,
  },
  "without-water": {
    name: "Without water",
    svg: () => `${L("M104 150 L104 100 C104 70 92 60 80 60", "var(--leaf)", 9)}
      ${leaf(104, 120, 54, 120, "var(--leaf-l)")}${leaf(104, 108, 54, 70, "var(--leaf-l)")}${leaf(80, 62, 40, 100, "var(--sand)")}
      ${pot(104, 158, 0.9, false)}${P("M60 151 L148 151 L148 158 L60 158Z", "var(--sand)")}${IL("M74 154 L84 151 L92 156 M118 152 L126 156 L134 152", "var(--earth-d)", 2)}
      ${badge(186, 70, drop(186, 70, 0.14))}`,
  },
  "without-light": {
    name: "Without light",
    svg: () => `${C(104, 112, 92, "var(--icon-ink)", false)}
      ${L("M104 150 C100 110 110 70 104 30", "var(--sand-l)", 7)}${leaf(104, 40, 30, 210, "var(--sand)", 1, false)}${leaf(104, 34, 30, -30, "var(--sand)", 1, false)}${leaf(103, 100, 22, 200, "var(--sand)", 1, false)}
      ${pot(104, 162, 0.8)}
      ${badge(186, 70, sunGlyph(186, 70, 11))}`,
  },
  "fair-test": {
    name: "Fair test",
    svg: () => {
      const plant = (x: number) =>
        `${L(`M${x} 150 L${x} 100`, "var(--leaf-d)", 7)}${leaf(x, 122, 34, 200, "var(--leaf)", 1, false)}${leaf(x, 108, 34, -20, "var(--leaf)", 1, false)}${pot(x, 158, 0.6)}`;
      return `${plant(62)}${plant(178)}${L("M106 122 L134 122 M106 140 L134 140", "var(--icon-ink)", 8)}
      ${RR(30, 214, 180, 10, "var(--wood)", "rr2")}`;
    },
    small: () =>
      `${RR(30, 120, 70, 90, "var(--clay)", "rr2")}${RR(140, 120, 70, 90, "var(--clay)", "rr2")}${L("M65 120 L65 60 M175 120 L175 60", "var(--leaf)", 16)}${L("M106 130 L134 130 M106 156 L134 156", "var(--icon-ink)", 10)}`,
  },
  "measure-height": {
    name: "Measure height",
    svg: () => `${L("M86 150 L86 72", "var(--leaf-d)", 8)}${leaf(86, 120, 40, 200)}${leaf(86, 100, 40, -20)}${leaf(86, 76, 30, -70, "var(--leaf)", 1, false)}
      ${pot(86, 160, 0.72)}
      ${RR(152, 26, 44, 196, "var(--sun)", "rr2")}${IL("M152 50 L172 50 M152 74 L166 74 M152 98 L172 98 M152 122 L166 122 M152 146 L172 146 M152 170 L166 170 M152 194 L172 194", "var(--icon-ink)", 4)}
      ${IL("M100 52 L146 52", "var(--icon-secondary)", 5, 'stroke-dasharray="8 8"')}`,
  },
  "watering-can": {
    name: "Watering can",
    svg: () => {
      const body =
        "M60 100 L156 100 L162 196 C162 204 156 208 148 208 L68 208 C60 208 54 204 54 196Z";
      return `${L("M60 112 C30 112 30 176 58 176", "var(--icon-primary-dark)", 14)}${L("M156 182 L210 98", "var(--icon-primary)", 14)}
      ${RR(196, 82, 30, 22, "var(--icon-primary-dark)", "rr2")}
      ${F(body, "var(--icon-primary)")}${SH(body, "M120 96 L170 96 L170 212 L120 212Z", "var(--icon-primary-dark)")}
      ${L("M80 100 C80 64 136 64 136 100", "var(--icon-primary-dark)", 12)}
      ${drop(214, 140, 0.07)}${drop(226, 166, 0.06)}${drop(204, 172, 0.06)}
      ${H("M70 120 L70 186", 9)}`;
    },
  },
  "measuring-cylinder": {
    name: "Measuring cylinder",
    svg: () => {
      const tube = "M90 30 L150 30 L150 200 L90 200Z";
      return `${RR(62, 196, 116, 22, "var(--glass)", "rr2")}${F(tube, "var(--glass)")}${CLIP(tube, R(80, 110, 80, 100, "var(--water)", false) + R(80, 110, 80, 7, "var(--sky)", false))}
      ${IL("M90 60 L112 60 M90 84 L104 84 M90 108 L112 108 M90 132 L104 132 M90 156 L112 156 M90 180 L104 180", "var(--icon-ink)", 4)}
      ${L("M86 30 L154 30", "var(--glass)", 8)}${H("M140 50 L140 180", 7)}`;
    },
  },
  "plant-pot": {
    name: "Plant pot",
    svg: () => `<g transform="translate(0 -40)">${pot(120, 120, 1.5)}</g>${H("M64 96 L74 160", 8)}`,
  },
  prediction: {
    name: "Prediction",
    svg: () => `${cloud(
      [
        [80, 94, 44],
        [128, 74, 50],
        [170, 104, 42],
        [140, 134, 40],
        [94, 136, 38],
      ],
      "var(--icon-primary)",
    )}
      ${C(58, 178, 14, "var(--icon-primary)")}${C(36, 206, 9, "var(--icon-primary)")}
      ${IL("M108 86 C108 64 150 62 150 88 C150 106 128 106 128 124", "#fff", 14)}${C(128, 144, 8, "#fff", false)}
      ${H("M54 86 C58 70 70 58 84 54", 8)}`,
  },
  "growth-over-time": {
    name: "Growth over time",
    svg: () => `${pot(44, 170, 0.42)}${L("M44 166 L44 152", "var(--leaf-d)", 5)}${leaf(44, 154, 18, -40, "var(--leaf)", 1, false)}
      ${pot(116, 170, 0.48)}${L("M116 166 L116 124", "var(--leaf-d)", 6)}${leaf(116, 146, 26, 200, "var(--leaf)", 1, false)}${leaf(116, 132, 26, -20, "var(--leaf)", 1, false)}
      ${pot(192, 170, 0.54)}${L("M192 166 L192 64", "var(--leaf-d)", 7)}${leaf(192, 140, 32, 200, "var(--leaf)", 1, false)}${leaf(192, 118, 32, -20, "var(--leaf)", 1, false)}${leaf(192, 94, 28, 205, "var(--leaf)", 1, false)}${leaf(192, 74, 26, -30, "var(--leaf)", 1, false)}
      ${AR("M30 214 L214 214", "var(--icon-ink)", 7)}`,
  },
  windowsill: {
    name: "Windowsill",
    svg: () => `${RR(38, 22, 164, 160, "#fff", "rr2")}${R(52, 36, 64, 64, "var(--sky)", false)}${R(124, 36, 64, 64, "var(--sky)", false)}${R(52, 108, 64, 62, "var(--sky)", false)}${R(124, 108, 64, 62, "var(--sky)", false)}
      ${CLIP("M124 36 L188 36 L188 100 L124 100Z", C(176, 50, 26, "var(--sun)", false))}
      ${L("M120 150 L120 116", "var(--leaf-d)", 7)}${leaf(120, 134, 32, 200, "var(--leaf)", 1, false)}${leaf(120, 122, 32, -20, "var(--leaf)", 1, false)}
      ${pot(120, 168, 0.5)}${RR(20, 196, 200, 20, "var(--wood)", "rr2")}`,
  },
  bee: {
    name: "Bee",
    svg: () => {
      const body =
        "M48 140 C48 104 90 92 132 96 C176 100 200 120 200 142 C200 166 170 184 130 184 C86 184 48 172 48 140Z";
      return `${E(104, 76, 30, 44, "var(--glass)", true, 'transform="rotate(-24 104 76)"')}${E(146, 72, 26, 40, "var(--glass)", true, 'transform="rotate(18 146 72)"')}
      ${L("M200 142 L222 146", "var(--icon-ink)", 6)}
      ${F(body, "var(--sun)")}${CLIP(body, IL("M100 90 C92 120 92 160 100 190 M140 90 C132 120 132 160 140 190 M180 96 C172 120 172 160 180 186", "var(--icon-ink)", 16))}
      ${C(56, 128, 20, "var(--icon-ink)")}${C(52, 122, 5, "#fff", false)}
      ${L("M50 110 C44 92 36 86 28 84 M62 108 C62 92 58 82 52 76", "var(--icon-ink)", 5)}
      ${H("M78 116 C86 108 98 104 110 104", 7)}`;
    },
  },
  "leaf-food": {
    name: "Leaves make food",
    svg: () => {
      const d = "M64 210 C60 150 100 94 196 86 C198 168 150 210 64 210Z";
      return `${sunGlyph(56, 58, 28)}
      ${AR("M90 82 L118 110", "var(--sun-d)", 7)}
      ${F(d, "var(--leaf)")}${SH(d, "M64 210 L196 86 L220 220Z", "var(--leaf-d)")}
      ${IL("M64 210 C110 170 150 130 188 94", "var(--leaf-d)", 5, 'opacity=".6"')}
      ${H("M84 190 C90 160 112 128 144 110", 8)}`;
    },
  },
};
