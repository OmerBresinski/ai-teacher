// Y8 volcanoes and plate tectonics. 240 viewBox, medium level is the base drawing.
// Accuracy rules: the mantle is drawn solid (flat --mantle, never glowing); only magma and lava glow.

import { DROP } from "./core";
import { AR, C, CLIP, E, F, H, IL, L, P, R, RR, SH } from "./kit";
import type { IconDrawing } from "./types";

type Circle = [number, number, number];
const cloud = (circles: Circle[], c: string): string =>
  circles.map(([x, y, r]) => C(x, y, r, c)).join("") +
  circles.map(([x, y, r]) => C(x, y, r, c, false)).join("");
// cone: base from x0 to x1 at y=base, summit flat from s0 to s1 at y=top
const coneD = (x0: number, x1: number, base: number, s0: number, s1: number, top: number): string =>
  `M${x0} ${base} C${x0 + (s0 - x0) * 0.5} ${base - 6} ${s0 - 6} ${top + 10} ${s0} ${top} L${s1} ${top} C${s1 + 6} ${top + 10} ${x1 - (x1 - s1) * 0.5} ${base - 6} ${x1} ${base}Z`;
const steepD = (
  x0: number,
  x1: number,
  base: number,
  s0: number,
  s1: number,
  top: number,
): string => `M${x0} ${base} L${s0} ${top} L${s1} ${top} L${x1} ${base}Z`;
const whiteArrow = (d: string): string => AR(d, "#fff", 7, false);
const mantleBox = (y = 128, h = 90): string => RR(20, y, 200, h, "var(--mantle)", "rr2");
const ocean = (x: number, y: number, w: number): string =>
  `${R(x, y, w, 14, "var(--ocean)", false)}${IL(`M${x + 6} ${y + 4} q8 -6 16 0 q8 6 16 0`, "var(--sky)", 3, 'class="dt"')}`;
const house = (x: number, y: number, s: number, roof: string): string =>
  `<g transform="translate(${x} ${y}) scale(${s})">${R(-20, -10, 40, 34, "var(--enamel)", true)}${F("M-28 -8 L0 -34 L28 -8Z", roof, s)}${R(-6, 8, 12, 16, "var(--wood)", false)}</g>`;

export const VOLCANOES: Record<string, IconDrawing> = {
  magma: {
    name: "Magma",
    svg: () => {
      const box = "M22 64 L218 64 L218 200 C218 210 210 216 200 216 L40 216 C30 216 22 210 22 200Z";
      return `${F(box, "var(--earth)")}${P("M22 56 L218 56 L218 72 L22 72Z", "var(--grass)")}
      ${CLIP(box, `${E(120, 214, 96, 46, "var(--magma)", false)}${E(120, 214, 70, 30, "var(--fire-l)", false)}`)}
      ${L("M120 172 C114 150 126 130 118 104", "var(--magma)", 16)}${IL("M120 172 C114 150 126 130 118 104", "var(--fire-l)", 6)}
      ${AR("M160 160 L160 104", "#fff", 8, false)}
      <g class="dt">${IL("M40 104 L70 104 M170 132 L204 132 M36 140 L60 140", "var(--earth-d)", 4, 'opacity=".5"')}</g>
      ${H("M36 86 L80 86", 6)}`;
    },
  },
  lava: {
    name: "Lava",
    svg: () => {
      const hill = "M18 214 C40 150 80 70 130 56 C170 46 206 70 222 110 L222 214Z";
      const flow =
        "M128 60 C120 90 96 110 92 140 C88 170 60 186 50 214 L118 214 C120 190 136 170 140 140 C144 110 150 86 146 60Z";
      return `${F(hill, "var(--rock)")}${SH(hill, "M150 50 C200 70 230 140 222 214 L170 214Z", "var(--rock-d)")}
      ${F(flow, "var(--fire)")}${CLIP(flow, `${IL("M134 64 C128 100 110 120 106 150 C102 176 86 196 80 220", "var(--fire-l)", 12)}${E(98, 172, 10, 6, "var(--rock-d)", false)}${E(126, 128, 8, 5, "var(--rock-d)", false)}`)}
      ${H("M50 170 C62 140 76 116 92 98", 8)}`;
    },
  },
  "ash-cloud": {
    name: "Ash",
    svg: () => `${F(steepD(64, 176, 220, 108, 132, 170), "var(--earth)")}
      ${cloud(
        [
          [80, 110, 40],
          [124, 82, 50],
          [170, 108, 40],
          [146, 140, 34],
          [100, 142, 34],
        ],
        "var(--smoke)",
      )}
      ${L("M120 172 L120 150", "var(--smoke)", 22)}
      ${(
        [
          [90, 100],
          [118, 70],
          [150, 96],
          [170, 118],
          [106, 134],
          [136, 128],
          [76, 124],
        ] as const
      )
        .map(([x, y]) => `<g class="dl">${C(x, y, 5, "var(--rock-d)", false)}</g>`)
        .join("")}
      ${H("M66 98 C70 86 78 78 90 74", 8)}`,
  },
  eruption: {
    name: "Eruption",
    svg: () => {
      const cone = steepD(30, 210, 216, 100, 140, 116);
      return `${cloud(
        [
          [96, 46, 24],
          [124, 34, 28],
          [154, 48, 22],
        ],
        "var(--smoke)",
      )}
      ${F("M100 118 C84 92 86 70 104 56 C104 76 112 84 120 70 C126 84 136 76 136 56 C154 70 156 92 140 118Z", "var(--fire)")}
      ${P("M108 118 C102 102 106 90 114 84 C116 96 124 96 126 86 C134 96 136 106 132 118Z", "var(--fire-l)")}
      <g class="dl">${C(72, 72, 8, "var(--fire)")}${C(170, 78, 7, "var(--fire)")}${C(60, 106, 6, "var(--fire-l)")}${C(182, 110, 6, "var(--fire-l)")}</g>
      ${F(cone, "var(--earth)")}${SH(cone, "M120 110 L220 110 L220 220 L150 220Z", "var(--earth-d)")}
      ${L("M104 120 C96 150 108 166 94 196", "var(--fire)", 12)}${L("M138 120 C146 146 136 164 152 190", "var(--fire-l)", 10)}
      ${H("M56 190 L84 140", 8)}`;
    },
  },
  "explosive-eruption": {
    name: "Explosive eruption",
    svg: () => {
      const cone = steepD(50, 190, 218, 108, 132, 140);
      return `${L("M120 140 L120 90", "var(--smoke)", 38)}
      ${cloud(
        [
          [70, 64, 34],
          [110, 40, 38],
          [156, 50, 36],
          [186, 82, 26],
          [52, 96, 22],
          [130, 82, 34],
          [94, 86, 28],
        ],
        "var(--smoke)",
      )}
      ${(
        [
          [40, 140, 8],
          [204, 130, 7],
          [30, 70, 6],
          [214, 52, 7],
          [64, 124, 5],
          [180, 138, 5],
        ] as const
      )
        .map(
          ([x, y, r]) =>
            `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" class="o dl" transform="rotate(30 ${x} ${y})" style="fill:var(--rock-d)"/>`,
        )
        .join("")}
      ${F(cone, "var(--earth)")}${SH(cone, "M120 130 L200 130 L200 220 L146 220Z", "var(--earth-d)")}
      ${P("M108 142 L132 142 L126 156 L114 156Z", "var(--fire)")}
      ${H("M70 196 L98 154", 8)}`;
    },
  },
  "gentle-eruption": {
    name: "Gentle eruption",
    svg: () => {
      const cone = coneD(14, 226, 206, 100, 140, 126);
      return `${F("M108 128 C102 104 110 84 120 70 C130 84 138 104 132 128Z", "var(--fire)")}${P("M114 128 C112 112 116 98 120 90 C124 98 128 112 126 128Z", "var(--fire-l)")}
      ${F(cone, "var(--rock)")}${SH(cone, "M120 120 L230 120 L230 210 L170 210Z", "var(--rock-d)")}
      ${L("M104 130 C80 150 60 162 30 196", "var(--fire)", 13)}${L("M136 130 C160 152 176 164 206 194", "var(--fire)", 13)}
      ${IL("M104 130 C80 150 60 162 30 196 M136 130 C160 152 176 164 206 194", "var(--fire-l)", 4)}
      ${H("M44 176 C60 160 76 148 92 140", 7)}`;
    },
  },
  "shield-volcano": {
    name: "Shield volcano",
    svg: () => {
      const cone = coneD(10, 230, 186, 96, 144, 112);
      return `${F(cone, "var(--rock)")}${SH(cone, "M120 100 L232 100 L232 190 L170 190Z", "var(--rock-d)")}
      ${P("M100 112 L140 112 L136 118 L104 118Z", "var(--fire)")}
      ${IL("M108 118 C92 136 70 152 40 172 M132 118 C150 136 170 150 200 170", "var(--fire)", 5, 'opacity=".75"')}
      ${RR(10, 186, 220, 14, "var(--grass)", "rr2")}
      ${H("M40 164 C64 148 82 134 98 122", 7)}`;
    },
  },
  "composite-volcano": {
    name: "Composite volcano",
    svg: () => {
      const cone = steepD(30, 210, 214, 108, 132, 44);
      return `${F(cone, "var(--earth)")}${CLIP(cone, `${R(120, 40, 100, 180, "var(--smoke)", false)}${[68, 96, 124, 152, 180, 206].map((y, i) => R(120, y, 100, 14, i % 2 ? "var(--rock-d)" : "var(--earth-d)", false)).join("")}`)}
      ${IL("M120 44 L120 214", "var(--icon-ink)", 3, 'opacity=".45"')}
      ${SH(cone, "M70 120 L120 40 L120 220 L60 220Z", "var(--earth-d)")}
      ${P("M108 44 L132 44 L128 52 L112 52Z", "var(--fire)")}
      ${H("M66 180 L102 82", 8)}`;
    },
  },
  "magma-chamber": {
    name: "Magma chamber",
    svg: () => {
      const cone = steepD(34, 206, 132, 108, 132, 40);
      return `${RR(14, 128, 212, 92, "var(--earth-d)", "rr2")}${F(cone, "var(--earth)")}
      ${IL("M120 44 L120 170", "var(--magma)", 9, 'opacity=".55"')}
      ${E(120, 182, 62, 26, "var(--magma)")}${E(112, 178, 38, 13, "var(--fire-l)", false)}
      ${H("M70 120 L100 70", 7)}`;
    },
    small: () =>
      `${RR(14, 120, 212, 100, "var(--earth-d)", "rr2")}${F(steepD(40, 200, 124, 108, 132, 50), "var(--earth)")}${E(120, 172, 76, 34, "var(--magma)")}`,
  },
  vent: {
    name: "Vent",
    svg: () => {
      const cone = steepD(30, 210, 150, 104, 136, 40);
      return `${RR(14, 146, 212, 74, "var(--earth-d)", "rr2")}${F(cone, "var(--earth)")}${SH(cone, "M120 30 L220 30 L220 160 L170 160Z", "var(--earth-d)")}
      ${E(120, 200, 40, 14, "var(--magma)", false, 'opacity=".6"')}
      ${L("M120 196 L120 42", "var(--magma)", 18)}${IL("M120 196 L120 42", "var(--fire-l)", 6)}
      ${AR("M150 130 L150 70", "var(--icon-ink)", 8)}
      ${H("M60 130 L92 74", 7)}`;
    },
  },
  crater: {
    name: "Crater",
    svg: () => {
      const top = "M20 214 L64 100 C80 84 160 84 176 100 L220 214Z";
      return `${F(top, "var(--earth)")}${SH(top, "M150 80 L230 80 L230 220 L170 220Z", "var(--earth-d)")}
      ${E(120, 98, 58, 18, "var(--earth-d)")}${E(120, 104, 44, 11, "var(--fire)", false)}${E(116, 104, 22, 5, "var(--fire-l)", false)}
      ${cloud(
        [
          [104, 60, 14],
          [126, 48, 18],
          [146, 62, 12],
        ],
        "var(--smoke)",
      )}
      ${H("M48 190 L72 126", 8)}`;
    },
  },
  "lava-layers": {
    name: "Layers of lava and ash",
    svg: () => {
      const cone = steepD(20, 220, 214, 104, 136, 60);
      return `${F(cone, "var(--earth)")}${CLIP(cone, [214, 188, 162, 136, 110, 84].map((y, i) => P(`M0 ${y} L120 ${y - 70} L240 ${y} L240 ${y + 30} L120 ${y - 40} L0 ${y + 30}Z`, ["var(--rock-d)", "var(--smoke)", "var(--rock)", "var(--smoke)", "var(--rock-d)", "var(--smoke)"][i] as string)).join("") + P("M0 72 L120 -2 L240 72 L240 82 L120 8 L0 82Z", "var(--fire)"))}
      ${P("M104 60 L136 60 L132 66 L108 66Z", "var(--fire)")}
      ${H("M44 196 L96 86", 7)}`;
    },
  },
  crust: {
    name: "Crust",
    svg: () => `${RR(20, 112, 200, 104, "var(--mantle)", "rr2")}${P("M26 112 L214 112 L214 216 L26 216Z", "#fff", 'opacity=".45"')}
      ${RR(14, 64, 212, 50, "var(--earth)", "rr2")}${P("M14 64 L226 64 L226 76 L14 76Z", "var(--grass)")}
      ${IL("M64 80 L72 112 M150 80 L144 112", "var(--earth-d)", 4)}
      ${AR("M120 30 L120 58", "var(--icon-ink)", 8)}
      ${H("M28 92 L60 92", 6)}`,
  },
  mantle: {
    name: "Mantle",
    svg: () => `${RR(14, 34, 212, 30, "var(--earth)", "rr2", true)}${P("M18 34 L222 34 L222 64 L18 64Z", "#fff", 'opacity=".45"')}
      ${RR(14, 66, 212, 150, "var(--mantle)", "rr2")}${SH("M14 66 L226 66 L226 216 L14 216Z", "M14 170 L226 150 L226 216 L14 216Z", "var(--mantle-d)")}
      ${AR("M70 180 C40 160 40 110 70 96", "var(--mantle-d)", 7, false)}${AR("M170 96 C200 110 200 160 170 180", "var(--mantle-d)", 7, false)}
      ${AR("M90 92 L150 92", "var(--mantle-d)", 7, false)}${AR("M150 190 L90 190", "var(--mantle-d)", 7, false)}
      ${H("M28 92 L28 150", 7)}`,
  },
  "earth-layers": {
    name: "Earth's layers",
    svg: () => {
      const cut = "M120 120 L120 0 L0 0 L0 240 L240 240 L240 120Z";
      return `${C(120, 120, 96, "var(--earth)")}${C(120, 120, 88, "var(--mantle)", false)}${C(120, 120, 50, "var(--fire-l)", false)}${C(120, 120, 26, "var(--sun)", false)}
      ${CLIP(cut, `${C(120, 120, 97, "var(--water)", false)}${P("M50 80 C70 60 100 66 104 84 C108 104 84 108 88 128 C92 148 72 166 56 154 C40 142 44 112 34 104Z", "var(--leaf)")}${P("M120 150 C140 142 166 150 176 170 C186 190 160 206 140 200 C120 194 110 170 120 150Z", "var(--leaf)")}`)}${CLIP(cut, CLIP("M24 120 A96 96 0 1 0 216 120 A96 96 0 1 0 24 120Z", P("M150 120 L240 120 L240 240 L100 240 C180 210 200 160 150 120Z", "var(--water-d)", 'class="sh"')))}
      ${IL("M120 120 L120 24 M120 120 L216 120", "var(--icon-stroke)", 3, 'class="dt"')}
      ${H("M42 96 C48 76 62 58 80 48", 8)}`;
    },
  },
  "tectonic-plates": {
    name: "Tectonic plates",
    svg: () => {
      const g = "M24 120 A96 96 0 1 0 216 120 A96 96 0 1 0 24 120Z";
      return `${F(g, "var(--water)")}${CLIP(g, `${P("M50 70 C74 52 104 58 108 80 C112 104 88 110 92 130 C96 150 78 170 60 160 C44 150 48 116 36 106Z", "var(--leaf)")}${P("M140 60 C164 54 194 70 196 98 C180 104 168 94 154 108 C140 122 156 148 146 170 C134 190 116 180 118 156 C120 134 108 122 118 100 C124 86 126 66 140 60Z", "var(--leaf)")}${P("M150 60 L230 60 L230 230 L130 230 C200 190 206 110 150 60Z", "var(--water-d)", 'class="sh"')}`)}
      ${CLIP(g, IL("M30 136 L60 128 L72 140 L104 132 L116 144 L150 136 L170 150 L214 140 M120 26 L114 56 L126 80 L118 108 L126 132 M160 140 L152 178 L166 214", "var(--fire)", 6))}
      ${H("M48 92 C54 74 68 58 86 50", 9)}`;
    },
  },
  "constructive-boundary": {
    name: "Constructive boundary",
    svg: () => `${mantleBox(132, 84)}
      ${E(120, 150, 26, 18, "var(--magma)", false)}${L("M120 156 L120 104", "var(--magma)", 16)}${IL("M120 156 L120 104", "var(--fire-l)", 5)}
      ${F("M20 100 L108 100 L112 92 L112 132 L20 132Z", "var(--rock)")}${F("M220 100 L132 100 L128 92 L128 132 L220 132Z", "var(--rock)")}
      ${ocean(20, 86, 92)}${ocean(128, 86, 92)}
      <g class="dl">${whiteArrow("M92 116 L40 116")}${whiteArrow("M148 116 L200 116")}</g>
      ${AR("M84 56 L34 56", "var(--icon-ink)", 9)}${AR("M156 56 L206 56", "var(--icon-ink)", 9)}`,
    small: () =>
      `${RR(20, 140, 200, 70, "var(--mantle)", "rr2")}${RR(20, 96, 86, 44, "var(--rock)", "rr2")}${RR(134, 96, 86, 44, "var(--rock)", "rr2")}${L("M120 170 L120 96", "var(--magma)", 18)}${AR("M80 60 L30 60", "var(--icon-ink)", 12)}${AR("M160 60 L210 60", "var(--icon-ink)", 12)}`,
  },
  "destructive-boundary": {
    name: "Destructive boundary",
    svg: () => {
      const oceanic =
        "M20 110 L112 110 C132 110 146 120 156 140 L178 204 L150 210 L132 158 C126 144 118 136 106 136 L20 136Z";
      const cont = "M112 104 L150 82 L220 82 L220 140 L162 140 C150 122 132 110 112 104Z";
      return `${mantleBox(124, 92)}
      ${F(oceanic, "var(--rock)")}${ocean(20, 96, 96)}
      ${L("M156 150 C170 130 176 104 182 60", "var(--magma)", 12)}${E(158, 152, 14, 10, "var(--magma)", false)}
      ${F(cont, "var(--earth)")}${P("M150 82 L220 82 L220 90 L150 90Z", "var(--grass)")}
      ${F(steepD(160, 206, 84, 176, 190, 46), "var(--earth)")}${P("M176 46 L190 46 L188 52 L178 52Z", "var(--fire)")}
      ${whiteArrow("M36 124 L84 124")}${whiteArrow("M206 112 L176 112")}`;
    },
    small: () =>
      `${RR(20, 130, 200, 84, "var(--mantle)", "rr2")}${F("M20 96 L116 96 L170 200 L140 206 L100 128 L20 128Z", "var(--rock)")}${F("M120 92 L220 80 L220 136 L156 136Z", "var(--earth)")}${F("M170 82 L186 46 L204 80Z", "var(--earth)")}${AR("M30 70 L80 70", "var(--icon-ink)", 12)}`,
  },
  subduction: {
    name: "Subduction",
    svg: () => {
      const slab =
        "M20 70 L104 70 C134 70 156 86 172 120 L206 204 L172 214 L142 140 C130 114 118 104 98 104 L20 104Z";
      return `${RR(20, 30, 200, 186, "var(--mantle)", "rr2")}
      ${F(slab, "var(--rock)")}${P("M20 70 L104 70 C134 70 156 86 172 120 L168 124 C152 92 130 78 104 78 L20 78Z", "var(--ocean)")}
      ${AR("M48 88 L96 88 C122 90 140 104 152 130 L176 186", "#fff", 7, false)}
      <g transform="translate(190 120) scale(.08)">${F(DROP, "var(--water)", 0.08)}</g><g transform="translate(176 92) scale(.07)">${F(DROP, "var(--water)", 0.07)}</g>
      ${E(196, 64, 14, 18, "var(--magma)")}${AR("M196 44 L196 30", "var(--magma)", 6, false)}`;
    },
  },
  "collision-boundary": {
    name: "Collision boundary",
    svg: () => {
      const mtn = "M40 126 L84 64 L104 88 L124 36 L150 82 L168 62 L200 126Z";
      return `${mantleBox(160, 56)}
      ${F(mtn, "var(--rock)")}${SH(mtn, "M124 30 L220 30 L220 130 L140 130Z", "var(--rock-d)")}
      ${P("M124 36 L114 62 L124 56 L134 62Z M84 64 L76 76 L84 72 L92 76Z", "#fff")}
      ${F("M20 120 L114 120 L120 160 L20 160Z", "var(--earth)")}${F("M220 120 L126 120 L120 160 L220 160Z", "var(--earth)")}
      <g class="dl">${IL("M108 124 C100 140 112 148 104 158 M132 124 C140 140 128 148 136 158", "var(--earth-d)", 4)}</g>
      ${whiteArrow("M30 142 L80 142")}${whiteArrow("M210 142 L160 142")}`;
    },
    small: () =>
      `${F("M20 140 L80 60 L120 100 L160 50 L220 140Z", "var(--rock)")}${RR(20, 140, 200, 50, "var(--earth)", "rr2")}${AR("M30 210 L90 210", "var(--icon-ink)", 12)}${AR("M210 210 L150 210", "var(--icon-ink)", 12)}`,
  },
  "conservative-boundary": {
    name: "Conservative boundary",
    svg: () => `${RR(20, 28, 98, 184, "var(--grass)", "rr2")}${RR(122, 28, 98, 184, "var(--leaf)", "rr2")}
      ${R(20, 86, 98, 26, "var(--rock)", false)}${R(122, 130, 98, 26, "var(--rock)", false)}
      ${IL("M24 99 L114 99", "#fff", 4, 'stroke-dasharray="10 8"')}${IL("M126 143 L216 143", "#fff", 4, 'stroke-dasharray="10 8"')}
      ${IL("M120 28 L114 60 L124 90 L116 130 L124 170 L118 212", "var(--icon-ink)", 5)}
      ${AR("M70 190 L70 140", "var(--icon-ink)", 9)}${AR("M170 50 L170 100", "var(--icon-ink)", 9)}`,
    small: () =>
      `${RR(20, 28, 96, 184, "var(--grass)", "rr2")}${RR(124, 28, 96, 184, "var(--leaf)", "rr2")}${AR("M68 190 L68 70", "var(--icon-ink)", 14)}${AR("M172 50 L172 170", "var(--icon-ink)", 14)}`,
  },
  "oceanic-plate": {
    name: "Oceanic plate",
    svg: () => `${RR(20, 120, 200, 40, "var(--rock-d)", "rr2")}${R(20, 88, 200, 34, "var(--ocean)", true)}
      ${IL("M28 96 q12 -8 24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0", "var(--sky)", 4)}
      ${IL("M20 176 L220 176", "var(--icon-ink)", 4, 'class="dt" stroke-dasharray="4 10" opacity=".35"')}
      ${H("M34 132 L80 132", 6)}`,
  },
  "continental-plate": {
    name: "Continental plate",
    svg: () => `${RR(20, 100, 200, 100, "var(--earth)", "rr2")}${SH("M20 100 L220 100 L220 200 L20 200Z", "M20 160 L220 150 L220 200 L20 200Z", "var(--earth-d)")}
      ${P("M20 100 L220 100 L220 112 L20 112Z", "var(--grass)")}
      ${F("M120 102 L156 50 L170 66 L184 46 L214 102Z", "var(--rock)")}${P("M156 50 L150 60 L162 60Z M184 46 L178 56 L190 56Z", "#fff")}
      ${L("M60 100 L60 82", "var(--wood)", 6)}${C(60, 72, 16, "var(--leaf)")}
      ${H("M34 124 L80 124", 6)}`,
  },
  "mantle-melting": {
    name: "Mantle rock melts",
    svg: () => {
      const rock = "M54 50 L170 42 L196 86 L172 120 L70 124 L40 90Z";
      return `${F(rock, "var(--mantle)")}${SH(rock, "M120 90 L200 80 L200 130 L60 130Z", "var(--mantle-d)")}
      ${F("M86 120 C86 140 96 150 96 162 C96 172 84 172 84 162 C84 150 76 140 80 120Z", "var(--magma)")}
      ${F("M124 122 C126 150 136 164 134 182 C132 198 112 198 112 182 C112 164 120 150 118 122Z", "var(--magma)")}
      ${F("M156 118 C156 134 164 142 162 152 C160 160 150 160 150 152 C150 142 152 134 150 118Z", "var(--magma)")}
      ${E(124, 206, 30, 12, "var(--magma)")}
      <g class="dl"><g transform="translate(206 150) scale(.09)">${F(DROP, "var(--water)", 0.09)}</g><g transform="translate(212 190) scale(.07)">${F(DROP, "var(--water)", 0.07)}</g></g>
      ${H("M60 84 L80 62", 7)}`;
    },
  },
  cracks: {
    name: "Cracks in the crust",
    svg: () => {
      const crack =
        "M108 30 L126 66 L110 100 L132 136 L114 170 L136 214 L104 214 L90 170 L106 136 L86 100 L100 66 L92 30Z";
      return `${RR(20, 30, 200, 186, "var(--earth)", "rr2")}${P("M20 30 L220 30 L220 44 L20 44Z", "var(--grass)")}
      ${F(crack, "var(--icon-ink)")}${CLIP(crack, `${R(70, 120, 80, 100, "var(--magma)", false)}${IL("M112 214 L112 120", "var(--fire-l)", 8)}`)}
      ${AR("M164 190 L164 130", "#fff", 7, false)}
      ${H("M34 64 L34 120", 7)}`;
    },
  },
  "igneous-rock": {
    name: "New rock",
    svg: () => {
      const rock =
        "M30 170 C26 128 56 90 100 82 C140 74 186 92 206 128 C220 154 210 196 170 202 L70 204 C46 204 32 192 30 170Z";
      return `${IL("M96 70 C90 56 102 48 96 34 M140 66 C134 52 146 44 140 30", "var(--smoke)", 6)}
      ${F(rock, "var(--rock-d)")}${SH(rock, "M150 80 C210 110 230 190 160 206 L230 206 L230 80Z", "var(--icon-ink)")}
      ${(
        [
          [80, 140, 7],
          [110, 116, 5],
          [146, 132, 8],
          [120, 170, 6],
          [176, 160, 5],
          [64, 176, 4],
        ] as const
      )
        .map(([x, y, r]) => C(x, y, r, "var(--icon-ink)", false))
        .join("")}
      ${IL("M60 196 L180 196", "var(--fire)", 5, 'opacity=".7"')}
      ${H("M52 140 C60 116 76 102 96 96", 8)}`;
    },
  },
  "volcanic-island": {
    name: "Volcanic island",
    svg: () => {
      const cone = steepD(40, 200, 168, 108, 132, 70);
      return `<g class="dl">${cloud(
        [
          [106, 46, 16],
          [126, 36, 20],
          [146, 48, 14],
        ],
        "var(--smoke)",
      )}</g>
      ${F(cone, "var(--earth)")}${SH(cone, "M120 60 L210 60 L210 180 L150 180Z", "var(--earth-d)")}${P("M108 70 L132 70 L128 76 L112 76Z", "var(--fire)")}
      ${IL("M108 76 C100 100 108 116 98 140", "var(--fire)", 7)}
      ${RR(14, 160, 212, 56, "var(--ocean)", "rr2")}<g class="dl">${IL("M30 182 q12 -8 24 0 t24 0 M130 196 q12 -8 24 0 t24 0", "var(--sky)", 5)}</g>
      ${H("M66 150 L96 100", 7)}`;
    },
  },
  earthquake: {
    name: "Earthquake",
    svg: () => `${IL("M20 70 L60 70 L72 40 L88 104 L104 22 L120 96 L134 52 L146 80 L160 70 L220 70", "var(--icon-primary)", 7)}
      ${F("M20 140 L110 140 L96 162 L120 184 L100 214 L20 214Z", "var(--earth)")}${F("M132 130 L220 130 L220 214 L122 214 L142 184 L118 162Z", "var(--earth)")}
      ${P("M20 140 L110 140 L106 148 L20 148Z M132 130 L220 130 L220 138 L128 138Z", "var(--grass)")}
      <g class="dl">${IL("M30 118 L42 126 M210 112 L198 120", "var(--icon-ink)", 5)}</g>`,
  },
  "volcanic-gas": {
    name: "Volcanic gas",
    svg: () => `${RR(20, 176, 200, 40, "var(--rock)", "rr2")}${P("M104 176 L136 176 L126 196 L114 196Z", "var(--icon-ink)")}
      ${cloud(
        [
          [120, 140, 30],
          [96, 100, 26],
          [138, 84, 30],
          [112, 50, 24],
          [150, 40, 18],
        ],
        "var(--sun)",
      )}
      ${C(110, 120, 14, "var(--smoke)", false)}${C(146, 64, 12, "var(--smoke)", false)}
      ${H("M86 92 C88 82 96 76 104 74", 6)}`,
  },
  "town-near-volcano": {
    name: "Town near a volcano",
    svg: () => {
      const cone = steepD(40, 220, 160, 116, 144, 50);
      return `<g class="dl">${cloud(
        [
          [118, 34, 14],
          [136, 26, 16],
          [154, 36, 12],
        ],
        "var(--smoke)",
      )}</g>
      ${F(cone, "var(--earth)")}${SH(cone, "M130 40 L230 40 L230 170 L170 170Z", "var(--earth-d)")}${P("M116 50 L144 50 L140 56 L120 56Z", "var(--fire)")}
      ${RR(14, 160, 212, 56, "var(--grass)", "rr2")}
      ${house(60, 168, 1, "var(--icon-primary)")}<g class="dl">${house(112, 180, 0.9, "var(--icon-secondary)")}</g>${house(164, 172, 0.95, "var(--icon-primary)")}`;
    },
  },
  hazard: {
    name: "Volcanic hazard",
    svg: () => `${F("M120 26 C128 26 132 30 136 36 L218 186 C224 198 218 208 204 208 L36 208 C22 208 16 198 22 186 L104 36 C108 30 112 26 120 26Z", "var(--sun)")}
      ${P("M58 184 L104 104 L136 104 L182 184Z", "var(--icon-ink)")}${P("M104 104 L136 104 L130 114 L110 114Z", "var(--fire)")}
      ${IL("M110 112 C104 130 112 140 104 158", "var(--fire)", 6)}
      ${C(106, 88, 10, "var(--smoke)", false)}${C(122, 78, 13, "var(--smoke)", false)}${C(138, 88, 9, "var(--smoke)", false)}
      ${H("M96 64 L112 38", 8)}`,
  },
};
