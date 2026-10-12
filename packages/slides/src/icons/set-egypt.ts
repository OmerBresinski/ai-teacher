// Y4 Egyptian mummification. 240 viewBox, medium level is the base drawing.
// Accuracy rules: canopic jars held liver, lungs, stomach, intestines; the heart stayed in the body;
// natron is a white salt; coffins are human-shaped; Anubis is a black jackal-headed god.

import { HEART_BODY, LUNG } from "./core";
import { AR, C, CLIP, E, F, H, IL, L, P, R, RR, SH } from "./kit";
import type { IconDrawing } from "./types";

const miniHeart = (x: number, y: number, s: number): string =>
  `<g transform="translate(${x} ${y}) scale(${s})">${F(HEART_BODY, "var(--flesh)", s)}</g>`;
const LIVER =
  "M26 112 C24 72 92 56 156 64 C200 70 216 92 206 114 C194 142 150 168 110 176 C66 184 28 150 26 112Z";
const STOMACH =
  "M86 40 L104 40 L106 76 C130 62 176 70 186 110 C196 150 168 196 120 200 C96 202 82 188 70 178 L48 186 L44 168 L66 160 C82 168 100 180 122 176 C150 172 164 144 156 118 C148 96 124 92 110 104 C100 112 92 106 90 92Z";
const ankh = (s: number): string =>
  `<g transform="translate(120 128) scale(${s})">${L("M0 -24 C-40 -30 -44 -96 0 -98 C44 -96 40 -30 0 -24", "var(--gold)", 22, s)}${L("M-56 -16 L56 -16 M0 -22 L0 96", "var(--gold)", 26, s)}${IL("M0 -22 L0 96", "var(--gold-d)", 8, 'class="sh"')}</g>`;
const scales = (
  left: string,
  right: string,
): string => `${L("M120 40 L120 206 M84 210 L156 210", "var(--gold-d)", 10)}${L("M44 70 L196 70", "var(--gold)", 10)}${C(120, 40, 10, "var(--gold)")}
  ${IL("M50 72 L34 140 M50 72 L66 140 M190 72 L174 140 M190 72 L206 140", "var(--gold-d)", 3)}
  ${F("M24 140 L76 140 C72 158 28 158 24 140Z", "var(--gold)")}${F("M164 140 L216 140 C212 158 168 158 164 140Z", "var(--gold)")}${left}${right}`;
const featherD =
  "M120 28 C150 30 156 56 140 66 C150 86 154 140 140 190 L124 214 L116 214 C104 160 104 100 112 60 C100 46 104 30 120 28Z";

export const EGYPT: Record<string, IconDrawing> = {
  mummy: {
    name: "Mummy",
    svg: () => {
      const body =
        "M120 20 C142 20 152 36 150 58 C170 66 176 84 172 110 C168 150 156 190 150 212 C146 222 94 222 90 212 C84 190 72 150 68 110 C64 84 70 66 90 58 C88 36 98 20 120 20Z";
      return `${F(body, "var(--linen)")}${CLIP(body, IL("M60 46 L180 30 M60 70 L180 56 M60 96 L180 80 M60 120 L180 108 M60 146 L180 132 M60 170 L180 158 M60 194 L180 182 M60 210 L180 204 M60 60 L180 76 M60 134 L180 150", "var(--linen-d)", 4))}
      ${SH(body, "M140 10 C190 60 180 170 150 230 L200 230 L200 10Z", "var(--linen-d)")}
      ${H("M84 90 C82 110 84 132 88 150", 8)}`;
    },
  },
  mummification: {
    name: "Mummification",
    svg: () => {
      const body =
        "M62 104 C90 92 156 92 190 100 C206 104 214 112 214 122 C214 132 206 140 190 144 C156 152 90 152 62 140Z";
      return `${RR(18, 154, 204, 18, "var(--wood)", "rr2")}${L("M36 172 L36 208 M204 172 L204 208", "var(--wood-d)", 12)}
      ${F(body, "var(--linen)")}${C(46, 120, 24, "var(--linen)")}
      ${CLIP(body, IL("M150 92 L140 152 M170 94 L160 152 M190 96 L180 152 M210 100 L200 150 M120 92 L110 152", "var(--linen-d)", 4))}
      ${IL("M36 108 L58 132 M34 126 L52 142", "var(--linen-d)", 4)}
      ${L("M100 146 C104 176 120 188 140 190", "var(--linen)", 14)}${C(150, 190, 16, "var(--linen)")}${C(150, 190, 6, "var(--linen-d)", false)}
      ${H("M70 108 L130 100", 6)}`;
    },
  },

  "canopic-jar": {
    name: "Canopic jar",
    svg: () => {
      const jar = "M74 100 C58 128 60 180 84 212 L156 212 C180 180 182 128 166 100Z";
      const wig =
        "M80 104 C70 54 92 24 120 24 C148 24 170 54 160 104 L146 104 L144 78 L96 78 L94 104Z";
      return `${F(jar, "var(--alabaster)")}${SH(jar, "M134 96 L184 96 L184 216 L134 216 C158 176 158 130 134 96Z", "var(--alabaster-d)")}
      ${RR(70, 94, 100, 14, "var(--alabaster)", "rr2")}
      ${F(wig, "var(--lapis)")}${CLIP(wig, IL("M86 40 L86 104 M98 32 L98 104 M142 32 L142 104 M154 40 L154 104", "var(--gold)", 4))}
      ${F("M98 46 C98 40 142 40 142 46 L142 82 C142 98 130 106 120 106 C110 106 98 98 98 82Z", "var(--alabaster)")}
      ${IL("M104 64 L114 64 M126 64 L136 64", "var(--icon-ink)", 5)}${IL("M120 70 L118 84 L122 84", "var(--alabaster-d)", 3)}${IL("M112 92 L128 92", "var(--clay-d)", 3)}
      <g class="dt">${R(108, 128, 24, 70, "var(--alabaster-d)", false, 'opacity=".35"')}${IL("M114 140 L126 140 M114 156 L126 156 M114 172 L126 172 M114 188 L126 188", "var(--icon-ink)", 3, 'opacity=".5"')}</g>
      ${H("M80 128 C74 150 76 176 84 196", 8)}`;
    },
  },
  "remove-organs": {
    name: "Remove organs",
    svg: () => `<g transform="translate(-6 -10) scale(.62)">${F(STOMACH, "var(--stomach)", 0.62)}${SH(STOMACH, "M190 110 C200 160 160 210 100 206 L200 210 L200 100Z", "var(--stomach-d)")}</g>
      ${AR("M60 128 C66 160 86 174 112 174", "var(--icon-ink)", 8)}
      <g transform="translate(92 98) scale(.56)">${F("M74 100 C58 128 60 180 84 212 L156 212 C180 180 182 128 166 100Z", "var(--alabaster)", 0.56)}${F("M80 104 C70 54 92 24 120 24 C148 24 170 54 160 104Z", "var(--lapis)", 0.56)}${F("M98 46 C98 40 142 40 142 46 L142 82 C142 98 130 106 120 106 C110 106 98 98 98 82Z", "var(--alabaster)", 0.56)}</g>
      ${H("M36 40 C40 32 48 28 56 28", 5)}`,
  },

  organs: {
    name: "Organs",
    svg: () => `<g transform="translate(6 10) scale(.46)">${F(LIVER, "var(--liver)", 0.46)}</g>
      <g transform="translate(118 2) scale(.46)">${F(STOMACH, "var(--stomach)", 0.46)}</g>
      <g transform="translate(14 112) scale(.46)">${F(LUNG, "var(--pink)", 0.46)}<g transform="translate(240 0) scale(-1 1)">${F(LUNG, "var(--pink)", 0.46)}</g></g>
      <g transform="translate(130 126) scale(.42)">${L("M30 40 L200 40 L200 200 M30 40 L30 200", "var(--gut-d)", 30, 0.42)}${L("M60 80 L170 80 C186 80 186 110 170 110 L70 110 C54 110 54 140 70 140 L170 140 C186 140 186 170 170 170 L80 170", "var(--gut)", 24, 0.42)}</g>`,
  },
  liver: {
    name: "Liver",
    svg: () => `${F(LIVER, "var(--liver)")}${SH(LIVER, "M30 140 C80 170 160 170 210 110 L210 190 L30 190Z", "var(--liver-d)")}
      ${IL("M128 66 C122 96 112 130 104 176", "var(--liver-d)", 5, 'opacity=".7"')}
      ${E(120, 170, 14, 10, "var(--leaf)")}
      ${H("M44 104 C50 86 72 76 96 72", 9)}`,
  },
  stomach: {
    name: "Stomach",
    svg: () => `${F(STOMACH, "var(--stomach)")}${SH(STOMACH, "M190 110 C200 160 160 210 100 206 L200 210 L200 100Z", "var(--stomach-d)")}
      <g class="dt">${IL("M118 126 C130 140 150 140 160 150 M110 150 C122 164 140 168 150 176", "var(--stomach-d)", 4, 'opacity=".5"')}</g>
      ${H("M116 86 C134 80 156 84 170 98", 8)}`,
  },
  intestines: {
    name: "Intestines",
    svg: () => `${L("M44 200 L44 60 C44 44 56 40 70 40 L170 40 C184 40 196 44 196 60 L196 200", "var(--gut-d)", 30)}
      ${L("M80 80 L160 80 C176 80 176 108 160 108 L82 108 C66 108 66 136 82 136 L160 136 C176 136 176 164 160 164 L84 164 C68 164 68 192 84 192 L120 192 L120 214", "var(--gut)", 22)}
      <g class="dt">${IL("M44 200 L44 60 C44 44 56 40 70 40 L170 40 C184 40 196 44 196 60 L196 200", "var(--stomach-d)", 4, 'stroke-dasharray="3 12" opacity=".6"')}</g>
      ${H("M74 74 L130 74", 5)}`,
  },
  "heart-left-inside": {
    name: "Heart left inside",
    svg: () => {
      const body =
        "M120 22 C142 22 152 38 150 60 C176 66 196 84 196 110 L196 222 L44 222 L44 110 C44 84 64 66 90 60 C88 38 98 22 120 22Z";
      return `${F(body, "var(--linen)")}${CLIP(body, IL("M30 80 L210 70 M30 104 L210 96 M30 180 L210 170 M30 204 L210 196", "var(--linen-d)", 4))}
      ${C(118, 142, 40, "var(--glow)", false)}${miniHeart(118, 140, 0.28)}
      ${H("M60 112 C60 100 66 92 76 88", 8)}`;
    },
  },
  "brain-removal": {
    name: "Remove the brain",
    svg: () => {
      const brain =
        "M40 120 C30 90 50 60 82 60 C92 42 126 40 140 56 C164 48 192 66 190 94 C206 110 200 142 180 150 C176 172 150 182 132 172 C118 186 90 186 80 170 C54 172 34 150 40 120Z";
      return `${F(brain, "var(--pink)")}${SH(brain, "M120 150 C160 150 190 130 200 100 L210 190 L100 190Z", "var(--pink-d)")}
      ${IL("M116 60 C110 90 124 120 114 172 M66 96 C78 92 88 100 86 112 M150 80 C140 90 146 104 160 104 M70 140 C82 132 96 138 96 148 M148 136 C140 146 150 158 164 152", "var(--pink-d)", 5)}
      ${L("M150 214 L216 132 C222 124 218 116 210 118", "var(--metal-d)", 8)}
      ${H("M56 102 C60 86 72 74 88 72", 7)}`;
    },
  },
  natron: {
    name: "Natron",
    svg: () => `${(
      [
        [70, 112],
        [96, 96],
        [124, 88],
        [150, 100],
        [176, 116],
        [86, 128],
        [116, 118],
        [146, 126],
        [104, 140],
        [134, 140],
        [160, 138],
        [120, 74],
      ] as const
    )
      .map(
        ([x, y], i) =>
          `<rect x="${x - 15}" y="${y - 15}" width="30" height="30" class="o rr2" transform="rotate(${(i * 23) % 60} ${x} ${y})" style="fill:${i % 3 ? "var(--natron)" : "var(--natron-d)"}"/>`,
      )
      .join("")}
      ${F("M30 140 L210 140 C206 186 170 206 120 206 C70 206 34 186 30 140Z", "var(--wood)")}${SH("M30 140 L210 140 C206 186 170 206 120 206 C70 206 34 186 30 140Z", "M140 140 L214 140 L214 210 L120 210 C170 190 190 170 140 140Z", "var(--wood-d)")}
      ${H("M48 156 C56 176 72 188 92 194", 7)}`,
  },
  linen: {
    name: "Linen",
    svg: () => `${F("M110 120 L214 140 L206 196 L104 176Z", "var(--linen)")}${IL("M122 134 L206 150 M118 160 L202 176", "var(--linen-d)", 3, 'class="dt"')}
      ${E(84, 120, 58, 58, "var(--linen)")}${E(84, 120, 40, 40, "var(--linen-d)", false, 'opacity=".5"')}${E(84, 120, 22, 22, "var(--linen)", false)}${C(84, 120, 9, "var(--linen-d)", false)}
      ${H("M44 104 C50 86 62 74 78 68", 8)}`,
  },
  coffin: {
    name: "Coffin",
    svg: () => {
      const shape =
        "M120 14 C154 14 170 40 168 74 C168 92 176 104 176 124 C176 162 160 200 152 222 L88 222 C80 200 64 162 64 124 C64 104 72 92 72 74 C70 40 86 14 120 14Z";
      return `${F(shape, "var(--gold)")}${SH(shape, "M140 10 C190 60 190 170 150 230 L200 230 L200 10Z", "var(--gold-d)")}
      ${P("M76 66 C76 34 96 20 120 20 C144 20 164 34 164 66 L164 106 L150 106 L148 72 L92 72 L90 106 L76 106Z", "var(--lapis)")}
      ${IL("M84 50 L84 104 M156 50 L156 104", "var(--gold)", 4)}
      ${E(120, 74, 26, 30, "var(--gold)", false)}${IL("M106 70 L116 70 M124 70 L134 70", "var(--icon-ink)", 5)}${IL("M120 76 L118 88 L122 88", "var(--gold-d)", 3)}
      ${RR(114, 102, 12, 20, "var(--lapis)", "rr2", false)}
      ${IL("M80 124 C100 140 140 140 160 124 M84 136 C102 152 138 152 156 136", "var(--lapis)", 6)}
      ${IL("M120 156 L120 214", "var(--lapis)", 10)}${IL("M96 170 L144 170", "var(--lapis)", 6)}
      ${H("M80 140 C80 160 86 180 92 196", 7)}`;
    },
  },
  embalmer: {
    name: "Embalmer",
    svg: () => {
      const torso = "M48 222 C48 176 70 150 120 150 C170 150 192 176 192 222Z";
      return `${F(torso, "var(--linen)")}${P("M78 160 C96 178 144 178 162 160 C156 154 140 150 120 150 C100 150 84 154 78 160Z", "var(--lapis)")}${IL("M80 166 C98 184 142 184 160 166", "var(--gold)", 4)}
      ${L("M120 150 L120 132", "var(--clay)", 26)}${E(120, 96, 38, 46, "var(--clay)")}
      ${IL("M104 94 L112 94 M128 94 L136 94", "var(--icon-ink)", 5)}${IL("M112 120 C116 124 124 124 128 120", "var(--clay-d)", 4)}
      ${H("M92 84 C94 72 100 64 108 60", 6)}`;
    },
  },
  anubis: {
    name: "Anubis",
    svg: () => {
      const head =
        "M60 200 C54 160 62 120 84 104 L76 30 L110 84 L120 30 L136 92 C150 96 164 104 178 110 L214 122 C222 126 220 142 210 146 L170 152 C160 170 150 190 148 210Z";
      return `${F(head, "var(--icon-ink)")}${IL("M84 104 L88 60 M120 92 L122 58", "var(--rock)", 6)}
      ${E(138, 112, 10, 6, "var(--gold)", false)}${C(140, 112, 3, "var(--icon-ink)", false)}
      ${IL("M150 120 L172 124", "var(--gold)", 4)}
      ${F("M52 196 C80 186 130 190 160 206 L156 226 C126 214 80 210 48 216Z", "var(--gold)")}${IL("M54 206 C84 198 126 202 156 216", "var(--lapis)", 6)}
      ${H("M78 140 C80 126 86 116 94 110", 5)}`;
    },
  },
  afterlife: {
    name: "Afterlife",
    svg: () => `${[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => `<g transform="rotate(${a} 120 110)">${IL("M120 22 L120 6", "var(--sun-d)", 6, 'class="dt"')}</g>`).join("")}
      ${C(120, 110, 88, "var(--glow)", false)}${ankh(1)}
      ${H("M96 50 C100 40 108 34 118 32", 6)}`,
  },
  "weighing-heart": {
    name: "Weighing of the heart",
    svg: () =>
      scales(
        miniHeart(50, 126, 0.12),
        `<g transform="translate(190 132) scale(.3) translate(-120 -120)">${F(featherD, "var(--enamel)", 0.3)}</g>`,
      ),
  },
  feather: {
    name: "Feather of Maat",
    svg: () => `<g transform="translate(120 0) scale(1.5 1) translate(-120 0)">${F(featherD, "var(--enamel)", 1.2)}${SH(featherD, "M130 50 C150 100 150 160 130 214 L200 214 L200 50Z", "var(--enamel-d)")}
      ${IL("M120 214 C116 160 116 100 124 62", "var(--metal-d)", 4)}
      <g class="dt">${IL("M122 100 L144 88 M120 130 L146 118 M120 160 L144 150 M122 100 L108 92 M120 130 L106 124", "var(--enamel-d)", 3)}</g>
      ${H("M112 70 C108 90 108 120 110 150", 6)}</g>`,
  },
  amulet: {
    name: "Amulet",
    svg: () => {
      const body =
        "M120 82 C156 82 176 110 176 146 C176 186 150 212 120 212 C90 212 64 186 64 146 C64 110 84 82 120 82Z";
      return `${L("M66 120 L36 104 M64 152 L32 156 M70 180 L42 200 M174 120 L204 104 M176 152 L208 156 M170 180 L198 200", "var(--icon-ink)", 7)}
      ${E(120, 62, 30, 22, "var(--lapis)")}${E(120, 46, 22, 10, "var(--gold)", false)}
      ${F(body, "var(--lapis)")}${SH(body, "M130 80 C190 110 190 200 120 214 L200 214 L200 80Z", "var(--lapis-d)")}
      ${IL("M120 96 L120 210 M76 120 C96 110 144 110 164 120", "var(--gold)", 5)}
      ${H("M82 132 C86 116 94 106 104 100", 7)}`;
    },
  },
  "death-mask": {
    name: "Death mask",
    svg: () => {
      const nemes =
        "M120 16 C164 16 186 40 186 80 L200 196 L154 196 L150 120 L90 120 L86 196 L40 196 L54 80 C54 40 76 16 120 16Z";
      return `${F(nemes, "var(--gold)")}${CLIP(nemes, IL("M40 70 L200 70 M40 92 L200 92 M40 140 L200 140 M40 162 L200 162 M40 184 L200 184 M60 48 L180 48", "var(--lapis)", 10))}
      ${E(120, 108, 40, 50, "var(--gold)")}${SH("M80 108 a40 50 0 1 0 80 0 a40 50 0 1 0 -80 0", "M130 50 C170 80 170 150 120 160 L170 160 L170 50Z", "var(--gold-d)")}
      ${IL("M98 100 L112 100 M128 100 L142 100", "var(--icon-ink)", 6)}${IL("M92 92 L112 90 M128 90 L148 92", "var(--lapis)", 5)}
      ${IL("M120 106 L116 124 L124 124", "var(--gold-d)", 4)}${IL("M110 138 L130 138", "var(--clay-d)", 4)}
      ${RR(112, 158, 16, 40, "var(--lapis)", "rr2")}${P("M112 20 L128 20 L124 42 L116 42Z", "var(--lapis)")}
      ${H("M60 96 C62 70 72 50 88 38", 7)}`;
    },
  },
  tomb: {
    name: "Tomb",
    svg: () => {
      const cliff =
        "M14 216 L20 90 C40 70 60 80 80 64 C110 40 150 52 170 40 C196 32 214 52 220 80 L226 216Z";
      return `${F(cliff, "var(--sand)")}${SH(cliff, "M150 30 L230 30 L230 220 L180 220Z", "var(--clay)")}
      ${RR(84, 108, 72, 18, "var(--sand-l)", "rr2")}${P("M92 126 L148 126 L148 216 L92 216Z", "var(--icon-ink)")}
      ${IL("M100 116 L106 116 M114 116 L118 116 M126 116 L132 116 M138 116 L142 116", "var(--clay-d)", 4)}
      ${H("M34 110 C44 96 56 88 70 84", 7)}`;
    },
  },
  pyramid: {
    name: "Pyramid",
    svg: () => `${C(184, 52, 22, "var(--sun)")}
      ${F("M138 186 L176 120 L214 186Z", "var(--sand)")}${P("M176 120 L214 186 L182 186Z", "var(--clay)", 'class="sh"')}
      ${F("M24 192 L104 56 L184 192Z", "var(--sand)")}${P("M104 56 L184 192 L120 192Z", "var(--clay)", 'class="sh"')}
      <g class="dt">${IL("M60 154 L112 154 M78 122 L118 122", "var(--clay)", 3, 'opacity=".55"')}</g>
      ${RR(14, 188, 212, 26, "var(--sand-l)", "rr2")}${H("M58 160 L94 98", 7)}`,
  },
  pharaoh: {
    name: "Pharaoh",
    svg: () => `<g transform="rotate(-24 120 120)">${L("M120 214 L120 70 C120 34 156 30 162 56", "var(--gold)", 16)}${CLIP("M100 70 L140 70 L140 214 L100 214Z", IL("M120 90 L120 104 M120 124 L120 138 M120 158 L120 172 M120 192 L120 206", "var(--lapis)", 18))}</g>
      <g transform="rotate(24 120 120)">${L("M120 214 L120 70", "var(--gold)", 16)}${CLIP("M100 70 L140 70 L140 214 L100 214Z", IL("M120 96 L120 110 M120 130 L120 144 M120 164 L120 178", "var(--lapis)", 18))}
      ${L("M120 70 L96 46 M120 70 L120 36 M120 70 L144 46", "var(--fire)", 10)}</g>`,
  },
  papyrus: {
    name: "Book of the Dead",
    svg: () => `${RR(46, 52, 148, 136, "var(--sand-l)", "rr2")}${L("M40 52 L40 188 M200 52 L200 188", "var(--sand)", 22)}
      ${IL("M74 72 L74 90 M70 104 C74 98 80 98 84 104 M74 116 L74 126 M66 140 L82 140 M74 154 L74 172", "var(--icon-ink)", 5)}
      ${IL("M104 72 L104 90 M100 106 L108 106 M104 118 L104 136 M96 152 L112 152 M104 162 L104 172", "var(--flesh-d)", 5)}
      ${miniHeart(150, 96, 0.12)}${IL("M138 132 L170 132 M150 142 L150 176", "var(--icon-ink)", 5)}
      ${H("M36 72 L36 160", 6)}`,
  },
  hieroglyphs: {
    name: "Hieroglyphs",
    svg: () => `${RR(58, 18, 124, 196, "var(--sand-l)", "rr")}${L("M60 206 L180 206", "var(--gold-d)", 8)}
      ${L("M98 46 L98 70 M98 46 C80 46 80 26 98 26 C116 26 116 46 98 46 M86 54 L110 54", "var(--gold-d)", 6)}
      ${IL("M128 34 L136 50 L144 34 L152 50", "var(--water)", 5)}
      ${F("M84 104 C84 90 96 84 108 88 L118 80 L120 92 C128 98 124 116 110 118 L96 132 L88 132 L94 116 C88 114 84 110 84 104Z", "var(--icon-ink)")}
      ${IL("M140 92 C130 100 132 120 150 120 C160 120 162 108 154 104", "var(--lapis)", 6)}
      ${E(98, 168, 22, 10, "#fff")}${C(98, 168, 6, "var(--icon-ink)", false)}
      ${IL("M140 150 L140 190 M128 160 L152 160", "var(--flesh-d)", 6)}`,
  },
  "oils-resin": {
    name: "Oils and resin",
    svg: () => {
      const jar = "M70 70 L106 70 L104 86 C128 100 132 150 120 182 L56 182 C44 150 48 100 72 86Z";
      return `${F(jar, "var(--alabaster)")}${SH(jar, "M96 80 L140 80 L140 190 L100 190 C116 150 116 110 96 80Z", "var(--alabaster-d)")}${RR(64, 60, 48, 14, "var(--alabaster)", "rr2")}
      ${F("M130 180 C130 154 210 154 210 180 C210 196 130 196 130 180Z", "var(--clay)")}${E(170, 172, 34, 10, "var(--sun-d)", false)}
      ${F("M166 110 C176 126 182 136 182 144 C182 154 170 158 164 150 C158 144 160 132 166 110Z", "var(--sun-d)")}
      ${RR(30, 186, 180, 18, "var(--sand)", "rr2")}
      ${H("M62 110 C58 130 58 150 62 168", 7)}`;
    },
  },
  "river-nile": {
    name: "River Nile",
    svg: () => {
      const land =
        "M20 40 L220 40 L220 200 C220 210 212 216 200 216 L40 216 C28 216 20 210 20 200Z";
      return `${F(land, "var(--sand)")}${CLIP(land, `${L("M150 30 C120 70 170 100 130 140 C96 174 120 196 96 230", "var(--leaf)", 64)}${L("M150 30 C120 70 170 100 130 140 C96 174 120 196 96 230", "var(--water)", 32)}`)}
      ${IL("M140 70 C146 66 152 66 156 70 M120 160 C126 156 132 156 136 160", "var(--sky)", 4)}
      ${L("M44 200 L50 130 M60 200 L60 120 M76 200 L70 136", "var(--leaf-d)", 5)}${(
        [
          [50, 128],
          [60, 116],
          [70, 132],
        ] as const
      )
        .map(([x, y]) => E(x, y, 9, 7, "var(--leaf)"))
        .join("")}
      ${H("M34 60 L80 60", 6)}`;
    },
  },
  "eye-of-horus": {
    name: "Eye of Horus",
    svg: () => `${C(120, 120, 96, "var(--gold)")}
      ${IL("M44 82 C80 64 140 60 196 72", "var(--lapis-d)", 12)}
      ${F("M48 116 C76 88 150 84 192 116 C150 138 86 140 48 116Z", "#fff")}${C(116, 114, 20, "var(--lapis-d)", false)}
      ${IL("M48 116 C76 88 150 84 192 116 C150 138 86 140 48 116Z", "var(--lapis-d)", 8)}
      ${IL("M192 116 L218 116", "var(--lapis-d)", 8)}
      ${IL("M118 134 L118 196", "var(--lapis-d)", 9)}
      ${IL("M140 134 C150 170 186 168 190 194 C192 210 170 212 166 198", "var(--lapis-d)", 9)}`,
  },
  decay: {
    name: "Decay",
    svg: () => {
      const apple =
        "M120 84 C96 66 50 74 50 124 C50 176 86 210 110 204 C116 202 124 202 130 204 C154 210 190 176 190 124 C190 74 144 66 120 84Z";
      return `${L("M120 84 C120 66 122 58 128 50", "var(--earth-d)", 8)}
      ${F(apple, "var(--clay-l)")}${CLIP(apple, `${E(150, 150, 40, 34, "var(--earth)", false)}${E(84, 116, 22, 18, "var(--earth)", false)}${C(144, 152, 10, "var(--earth-d)", false)}${C(162, 140, 6, "var(--earth-d)", false)}`)}
      ${E(70, 50, 9, 6, "var(--icon-ink)", false)}${E(66, 42, 7, 4, "var(--glass)", false)}${E(186, 70, 9, 6, "var(--icon-ink)", false)}${E(190, 62, 7, 4, "var(--glass)", false)}
      ${IL("M80 52 C90 58 92 66 88 72 M176 72 C166 78 166 86 172 92", "var(--icon-ink)", 2, 'stroke-dasharray="3 5"')}`;
    },
  },
};
