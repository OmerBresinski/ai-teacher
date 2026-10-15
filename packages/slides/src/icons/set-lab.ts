// TEACH-310 part c: steps practicals: lab apparatus, separating and crystallising, baking bread (pilot set-lab.js, 14 Oct).
// Practical steps: lab apparatus, separating and crystallising, and baking bread (14 Oct, steps-honest misses).
// 240 viewBox, medium level is the base drawing. Same kit and rules as set-plants.js: token colours only, #fff allowed.
// Real things keep natural colours (glass, sand, porcelain, bread); only man-made objects with no fixed colour
// (scales, bowl, tea towel stripes, acid label) take the theme slots.
import { C, CLIP, E, F, H, IL, id, L, P, R, RR, SH } from "./kit";
import type { IconDrawing } from "./types";

// glass vessel: glass fill, a pale-blue shade on the right so it still reads with no outline (secondary)
const glass = (sil: string, shade: string) =>
  `${F(sil, "var(--glass)")}${SH(sil, shade, "var(--sky)")}`;
const steam = (xs: number[], y0: number, c = "var(--smoke)") =>
  xs
    .map((x, i) =>
      IL(
        `M${x} ${y0} C${x - 12} ${y0 - 14} ${x + 12} ${y0 - 26} ${x} ${y0 - 40 - (i % 2) * 8}`,
        c,
        7,
      ),
    )
    .join("");
const grains = (pts: [number, number][], c: string, r = 4) =>
  pts.map(([x, y]) => C(x, y, r, c, false)).join("");

const BEAKER = "M64 44 L176 44 L176 194 C176 206 168 214 156 214 L84 214 C72 214 64 206 64 194Z";
const FUNNEL = "M34 44 L206 44 L134 128 L134 196 L124 218 L116 218 L106 196 L106 128Z";
const DISH = "M28 112 C30 170 70 202 120 202 C170 202 210 170 212 112Z";
const BOWL = "M24 100 L216 100 C212 168 172 208 120 208 C68 208 28 168 24 100Z";
const _KIDNEY =
  "M40 118 C36 78 76 54 112 64 C130 70 136 86 154 86 C186 84 210 106 206 140 C202 178 160 196 110 190 C70 186 42 160 40 118Z";
const DOUGH = "M34 172 C24 126 66 88 118 86 C172 84 216 118 206 170 C202 190 40 192 34 172Z";
const ROLL = "M22 166 C18 116 64 76 120 76 C176 76 222 116 218 166 C216 194 24 194 22 166Z";

// the v1 pilot flask (icons.js `flask`), reused as the conical flask in the pilot's library.js REUSE
const FLASK =
  "M98 50 L98 104 L54 190 C47 204 55 214 70 214 L170 214 C185 214 193 204 186 190 L142 104 L142 50Z";

export const LAB: Record<string, IconDrawing> = {
  sand: {
    name: "Sand",
    svg: () => {
      const pile = "M22 200 C50 150 84 92 120 90 C156 92 190 150 218 200Z";
      return `${F(pile, "var(--sand)")}${SH(pile, "M120 80 C150 100 180 150 230 210 L120 210Z", "var(--clay)")}
      ${grains(
        [
          [96, 140],
          [130, 120],
          [150, 160],
          [86, 178],
          [120, 168],
          [170, 186],
          [106, 110],
          [64, 188],
        ],
        "var(--clay-d)",
        4,
      )}
      <g class="dt">${grains(
        [
          [112, 148],
          [140, 140],
          [72, 170],
          [160, 174],
          [190, 196],
          [52, 196],
        ],
        "var(--earth)",
        3,
      )}</g>
      ${grains(
        [
          [32, 214],
          [48, 220],
          [196, 218],
          [210, 212],
        ],
        "var(--sand)",
        5,
      )}
      ${H("M76 168 C88 140 100 120 112 108", 8)}`;
    },
  },
  "filter-paper": {
    name: "Filter paper",
    svg: () => {
      const disc = "M20 92 A70 70 0 1 0 160 92 A70 70 0 1 0 20 92Z";
      const cone = "M84 104 C118 86 172 86 206 104 L148 222 Z";
      return `${F(disc, "var(--natron)")}${SH(disc, "M90 10 L170 10 L170 170 L90 170Z", "var(--natron-d)")}
      ${IL("M22 92 L158 92 M90 24 L90 160", "var(--alabaster-d)", 4)}
      ${F(cone, "var(--linen)")}${SH(cone, "M148 80 L214 80 L148 222Z", "var(--linen-d)")}
      ${IL("M148 222 L122 92", "var(--alabaster-d)", 4)}
      ${H("M36 72 C44 54 58 40 74 32", 8)}`;
    },
  },
  funnel: {
    name: "Funnel",
    svg: () => `${glass(FUNNEL, "M120 40 L210 40 L140 130 L140 220 L120 220Z")}
      ${CLIP(FUNNEL, P("M58 52 L182 52 L124 120 L116 120Z", "var(--linen)") + P("M120 52 L182 52 L124 120Z", "var(--linen-d)", 'class="sh"') + R(100, 132, 40, 90, "var(--water)", false))}
      ${L("M30 44 L210 44", "var(--glass)", 10)}
      ${C(120, 230, 6, "var(--water)", false)}
      ${H("M60 58 L104 108", 8)}`,
  },
  beaker: {
    name: "Beaker",
    svg: () => `${glass(BEAKER, "M150 40 L190 40 L190 220 L150 220Z")}
      ${CLIP(BEAKER, R(60, 130, 120, 90, "var(--water)", false) + R(60, 130, 120, 8, "var(--sky)", false))}
      ${L("M56 38 L64 48 L180 48", "var(--glass)", 10)}
      ${IL("M64 84 L94 84 M64 112 L84 112 M64 140 L94 140 M64 168 L84 168", "var(--wire)", 4)}
      ${H("M156 66 L156 186", 8)}`,
  },
  "evaporating-dish": {
    name: "Evaporating dish",
    svg: () => `<g class="dt">${steam([92, 122, 152], 92)}</g>
      ${F(DISH, "var(--enamel)")}${SH(DISH, "M140 100 L220 100 L220 210 L120 210Z", "var(--enamel-d)")}
      ${E(120, 112, 92, 18, "var(--enamel)")}${E(120, 114, 78, 11, "var(--water)", false)}${E(120, 112, 60, 5, "var(--sky)", false)}
      ${L("M26 108 L14 102", "var(--enamel)", 10)}
      ${grains(
        [
          [60, 116],
          [176, 118],
          [70, 120],
        ],
        "#fff",
        4,
      )}
      ${H("M50 140 C60 168 80 184 102 190", 8)}`,
  },
  crystals: {
    name: "Crystals",
    svg: () => {
      const gem = (x: number, y: number, w: number, h: number, a: number) => {
        const d = `M${x - w} ${y} L${x - w} ${y - h} L${x} ${y - h - w * 1.1} L${x + w} ${y - h} L${x + w} ${y}Z`;
        return `<g transform="rotate(${a} ${x} ${y})">${F(d, "var(--chem)")}${P(`M${x - w} ${y} L${x - w} ${y - h} L${x} ${y - h - w * 1.1} L${x} ${y}Z`, "var(--chem-l)")}
        ${SH(d, `M${x + w * 0.4} ${y - h - 60} L${x + w + 4} ${y - h - 60} L${x + w + 4} ${y + 4} L${x + w * 0.4} ${y + 4}Z`, "var(--water-d)")}
        ${H(`M${x - w * 0.55} ${y - 16} L${x - w * 0.55} ${y - h + 4}`, 6)}</g>`;
      };
      return `${gem(78, 206, 26, 70, -22)}${gem(166, 206, 26, 78, 20)}${gem(120, 210, 34, 108, 0)}
      ${RR(36, 200, 168, 18, "var(--rock)", "rr2")}`;
    },
  },
  bean: {
    name: "Bean",
    svg: () => {
      const k =
        "M-70 0 C-72 -34 -44 -50 -18 -42 C-6 -38 4 -30 18 -34 C46 -46 76 -30 72 0 C68 34 34 50 0 50 C-36 50 -68 34 -70 0Z";
      const one = (
        x: number,
        y: number,
        a: number,
        s: number,
        c: string,
        d: string,
      ) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})">${F(k, c, s)}${SH(k, "M-80 18 C-30 40 40 38 80 4 L80 60 L-80 60Z", d)}
        ${IL("M-8 -33 L22 -35", "var(--eye)", 6 / s)}${H("M-52 -8 C-50 -22 -40 -32 -26 -34", 8 / s)}</g>`;
      return `${one(84, 92, -24, 0.86, "var(--sand)", "var(--clay)")}${one(140, 156, 14, 1.12, "var(--earth)", "var(--earth-d)")}
      <g class="dt">${grains(
        [
          [116, 160],
          [158, 170],
          [132, 182],
          [174, 150],
        ],
        "var(--sand-l)",
        4,
      )}</g>`;
    },
  },
  acid: {
    name: "Acid",
    svg: () => {
      const bottle =
        "M96 30 L144 30 L144 64 C178 74 192 98 192 128 L192 196 C192 208 184 216 172 216 L68 216 C56 216 48 208 48 196 L48 128 C48 98 62 74 96 64Z";
      return `${glass(bottle, "M160 20 L200 20 L200 220 L160 220Z")}
      ${CLIP(bottle, R(40, 150, 160, 70, "var(--chem-l)", false) + R(40, 150, 160, 6, "#fff", false))}
      ${RR(88, 14, 64, 26, "var(--metal-d)", "rr2")}
      ${RR(70, 108, 100, 84, "#fff", "rr2")}
      <g transform="rotate(45 120 150)">${R(96, 126, 48, 48, "#fff", false)}${IL("M96 126 L144 126 L144 174 L96 174Z", "var(--flesh)", 7)}</g>
      ${P("M120 132 C128 144 132 150 132 156 C132 164 126 168 120 168 C114 168 108 164 108 156 C108 150 112 144 120 132Z", "var(--icon-ink)")}
      ${H("M62 120 C64 102 74 88 88 80", 8)}`;
    },
  },
  "copper-oxide": {
    name: "Copper oxide",
    svg: () => {
      const heap = "M50 170 C70 120 96 96 120 96 C146 96 170 120 190 170Z";
      return `${E(120, 176, 100, 26, "var(--glass)")}${E(120, 172, 84, 18, "var(--sky)", false, 'class="sh"')}
      ${F(heap, "var(--rock-d)")}${SH(heap, "M126 90 C160 110 180 140 200 180 L126 180Z", "var(--eye)")}
      <g class="dt">${grains(
        [
          [96, 140],
          [134, 126],
          [150, 152],
          [112, 116],
        ],
        "var(--rock)",
        4,
      )}</g>
      ${L("M148 80 L214 30", "var(--metal-d)", 10)}${E(140, 88, 22, 12, "var(--metal)", true, 'transform="rotate(-36 140 88)"')}
      ${H("M78 150 C88 130 100 116 112 108", 7)}`;
    },
  },
  "glass-rod": {
    name: "Glass rod",
    svg: () => {
      const b = "M50 112 L190 112 L190 196 C190 208 182 216 170 216 L70 216 C58 216 50 208 50 196Z";
      return `${glass(b, "M160 100 L200 100 L200 220 L160 220Z")}
      ${CLIP(b, R(40, 140, 160, 80, "var(--chem)", false) + R(40, 140, 160, 8, "var(--chem-l)", false))}
      ${L("M46 108 L194 108", "var(--glass)", 9)}
      <g class="dt">${IL("M78 178 C96 192 144 192 162 178", "#fff", 5, 'opacity=".8"')}</g>
      ${L("M100 196 L176 20", "var(--glass)", 18)}${IL("M106 182 L170 34", "var(--sky)", 6)}
      ${H("M70 132 L70 190", 7)}`;
    },
  },
  "bunsen-burner": {
    name: "Bunsen burner",
    svg: () => {
      const flame =
        "M120 18 C134 44 148 66 148 92 C148 112 136 124 120 124 C104 124 92 112 92 92 C92 66 106 44 120 18Z";
      const inner =
        "M120 60 C128 76 134 88 134 100 C134 112 128 118 120 118 C112 118 106 112 106 100 C106 88 112 76 120 60Z";
      return `${F(flame, "var(--chem-l)")}${P(inner, "var(--chem)")}
      ${L("M148 206 C190 206 200 190 222 186", "var(--fire)", 12)}
      ${RR(104, 120, 32, 84, "var(--metal)", "rr2")}${SH("M104 120 L136 120 L136 204 L104 204Z", "M124 116 L140 116 L140 208 L124 208Z", "var(--metal-d)")}
      ${RR(98, 160, 44, 18, "var(--metal-d)", "rr2")}${C(120, 169, 5, "var(--icon-ink)", false)}
      ${RR(56, 198, 128, 24, "var(--metal-d)", "rr2")}
      ${H("M112 132 L112 154", 6)}`;
    },
  },
  "tripod-gauze": {
    name: "Tripod and gauze",
    svg: () => {
      const g = "M22 108 L218 108 L218 130 L22 130Z";
      const bk = "M84 40 L156 40 L156 96 C156 104 150 108 142 108 L98 108 C90 108 84 104 84 96Z";
      return `${L("M120 132 L120 204", "var(--rock-d)", 8)}${L("M56 130 L30 218 M184 130 L210 218", "var(--wire)", 10)}
      ${glass(bk, "M136 30 L166 30 L166 112 L136 112Z")}${CLIP(bk, R(80, 70, 80, 40, "var(--water)", false))}${L("M80 40 L160 40", "var(--glass)", 7)}
      ${RR(22, 108, 196, 22, "var(--metal)", "rr2")}
      ${CLIP(g, IL(Array.from({ length: 14 }, (_, i) => `M${20 + i * 16} 108 L${36 + i * 16} 130 M${36 + i * 16} 108 L${20 + i * 16} 130`).join(" "), "var(--metal-d)", 3) + E(120, 119, 40, 12, "var(--natron)", false))}
      ${H("M36 114 L76 114", 5)}`;
    },
  },
  "paper-towel": {
    name: "Paper towel",
    svg: () => {
      const sheet =
        "M68 120 L188 120 L188 206 L176 196 L164 210 L150 198 L138 212 L124 200 L110 212 L96 198 L82 210 L68 200Z";
      return `${F(sheet, "var(--linen)")}${SH(sheet, "M160 110 L200 110 L200 220 L160 220Z", "var(--linen-d)")}
      <g class="dt">${grains(
        [
          [90, 140],
          [120, 140],
          [150, 140],
          [105, 162],
          [135, 162],
          [165, 162],
          [90, 184],
          [120, 184],
          [150, 184],
        ],
        "var(--linen-d)",
        3.5,
      )}</g>
      ${RR(40, 48, 160, 76, "var(--linen)", "rr")}${SH("M40 48 L200 48 L200 124 L40 124Z", "M40 100 L200 100 L200 130 L40 130Z", "var(--linen-d)")}
      ${E(200, 86, 16, 38, "var(--linen)")}${E(200, 86, 8, 18, "var(--earth)", false)}
      ${H("M62 64 L150 64", 8)}`;
    },
  },
  flour: {
    name: "Flour",
    svg: () => {
      const bag = "M62 58 L178 58 L188 204 C188 212 182 216 174 216 L66 216 C58 216 52 212 52 204Z";
      return `${F(bag, "var(--linen)")}${SH(bag, "M146 50 L196 50 L196 222 L146 222Z", "var(--linen-d)")}
      ${RR(56, 36, 128, 30, "var(--linen-d)", "rr2")}
      ${C(120, 138, 40, "#fff", false)}
      ${L("M120 166 L120 112", "var(--sun-d)", 6)}
      ${[0, 1, 2].map((i) => `${E(108, 152 - i * 16, 7, 11, "var(--sun)", false, `transform="rotate(-30 108 ${152 - i * 16})"`)}${E(132, 152 - i * 16, 7, 11, "var(--sun)", false, `transform="rotate(30 132 ${152 - i * 16})"`)}`).join("")}
      ${E(120, 108, 6, 10, "var(--sun)", false)}
      ${F("M150 216 C158 192 176 184 196 184 C214 186 226 202 228 216Z", "var(--natron)")}
      ${H("M70 84 L66 190", 8)}`;
    },
  },
  "kitchen-scales": {
    name: "Kitchen scales",
    svg: () => {
      const body =
        "M62 96 L178 96 L196 206 C196 212 192 216 186 216 L54 216 C48 216 44 212 44 206Z";
      return `${E(120, 64, 86, 22, "var(--metal)")}${P("M38 62 C46 86 194 86 202 62Z", "var(--metal-d)", 'class="sh"')}
      ${RR(110, 80, 20, 22, "var(--metal-d)", "rr2")}
      ${F(body, "var(--icon-primary)")}${SH(body, "M150 90 L210 90 L210 220 L150 220Z", "var(--icon-primary-dark)")}
      ${C(120, 152, 44, "#fff")}
      ${IL("M90 140 L96 142 M98 120 L103 125 M120 110 L120 117 M142 120 L137 125 M150 140 L144 142", "var(--icon-ink)", 4)}
      ${L("M120 156 L140 124", "var(--flesh)", 6)}${C(120, 156, 7, "var(--icon-ink)", false)}
      ${H("M60 112 L54 190", 7)}`;
    },
  },
  "mixing-bowl": {
    name: "Mixing bowl",
    svg: () => `${L("M150 104 L186 44", "var(--wood)", 12)}${E(190, 38, 13, 20, "var(--wood)", true, 'transform="rotate(30 190 38)"')}
      ${F(BOWL, "var(--icon-secondary)")}${SH(BOWL, "M150 96 L230 96 L230 214 L120 214Z", "var(--icon-secondary-dark)")}
      ${E(120, 100, 96, 20, "var(--icon-secondary-dark)")}${E(120, 104, 84, 13, "var(--sand-l)", false)}
      ${L("M150 104 L164 78", "var(--wood)", 12)}
      ${H("M44 124 C52 156 70 178 94 190", 9)}`,
  },
  dough: {
    name: "Dough",
    svg: () => `${RR(14, 168, 212, 40, "var(--wood)", "rr2")}${P("M20 196 L220 196 L220 208 L20 208Z", "var(--wood-d)", 'class="sh"')}
      ${F(DOUGH, "var(--sand-l)")}${SH(DOUGH, "M60 150 C110 170 170 168 214 128 L230 200 L30 200Z", "var(--sand)")}
      ${IL("M92 122 C112 112 136 112 154 124", "var(--sand)", 6)}
      <g class="dt">${grains(
        [
          [40, 158],
          [196, 156],
          [70, 180],
          [184, 182],
          [120, 70],
          [100, 76],
        ],
        "#fff",
        4,
      )}</g>
      ${H("M58 140 C64 120 80 106 100 98", 9)}`,
  },
  yeast: {
    name: "Yeast",
    svg: () => {
      const pack = "M44 80 L154 80 L154 206 L44 206Z";
      return `${F(pack, "var(--sun)")}${SH(pack, "M124 70 L164 70 L164 216 L124 216Z", "var(--sun-d)")}
      ${IL("M44 86 L154 86 M44 200 L154 200", "var(--sun-d)", 5, 'stroke-dasharray="6 6"')}
      ${C(99, 143, 30, "#fff", false)}
      ${grains(
        [
          [86, 140],
          [100, 132],
          [112, 146],
          [94, 154],
          [108, 160],
          [88, 126],
        ],
        "var(--earth)",
        5,
      )}
      ${grains(
        [
          [170, 206],
          [184, 198],
          [198, 210],
          [184, 214],
          [212, 202],
        ],
        "var(--earth)",
        5,
      )}
      ${C(186, 140, 16, "var(--glass)")}${C(204, 98, 12, "var(--glass)")}${C(180, 64, 9, "var(--glass)")}
      ${H("M60 100 L60 180", 7)}`;
    },
  },
  oven: {
    name: "Oven",
    svg: () => `${RR(30, 26, 180, 196, "var(--metal)", "rr")}${SH("M30 26 L210 26 L210 222 L30 222Z", "M170 20 L216 20 L216 228 L170 228Z", "var(--metal-d)")}
      ${RR(30, 26, 180, 40, "var(--wire)", "rr")}${P("M30 50 L210 50 L210 66 L30 66Z", "var(--wire)")}
      ${C(58, 46, 9, "var(--metal)", false)}${C(86, 46, 9, "var(--metal)", false)}${C(114, 46, 9, "var(--metal)", false)}${RR(146, 38, 46, 16, "var(--fire-l)", "rr2", false)}
      ${L("M64 92 L176 92", "var(--metal-d)", 10)}
      ${RR(54, 108, 132, 92, "var(--rock-d)", "rr2")}
      ${CLIP("M54 108 L186 108 L186 200 L54 200Z", E(120, 214, 90, 46, "var(--fire)", false) + E(120, 214, 60, 28, "var(--fire-l)", false))}
      ${E(120, 166, 34, 16, "var(--clay-l)", false)}${P("M86 166 C88 148 152 148 154 166Z", "var(--clay-l)")}
      ${H("M66 120 L94 120", 6)}`,
  },
  "tea-towel": {
    name: "Tea towel",
    svg: () => {
      const cloth = "M48 54 L192 54 L192 196 C168 210 146 196 120 208 C94 220 72 204 48 212Z";
      return `${L("M28 50 L212 50", "var(--wood)", 12)}
      ${F(cloth, "var(--natron)")}${CLIP(cloth, R(40, 70, 170, 14, "var(--icon-primary)", false) + R(40, 92, 170, 6, "var(--icon-primary)", false) + R(40, 166, 170, 14, "var(--icon-primary)", false) + R(40, 152, 170, 6, "var(--icon-primary)", false))}
      ${SH(cloth, "M150 40 L200 40 L200 220 L150 220Z", "var(--linen-d)")}
      ${H("M62 112 L62 140", 7)}`;
    },
  },
  "bread-roll": {
    name: "Bread roll",
    svg: () => `${F(ROLL, "var(--clay)")}${CLIP(ROLL, E(100, 106, 92, 54, "var(--clay-l)", false))}${SH(ROLL, "M30 164 C80 186 170 184 214 150 L220 200 L20 200Z", "var(--clay-d)")}
      ${IL("M70 132 L104 92 M108 142 L146 98 M150 148 L180 112", "var(--sand-l)", 9)}
      <g class="dt">${grains(
        [
          [86, 104],
          [130, 88],
          [164, 128],
          [60, 150],
          [122, 120],
        ],
        "#fff",
        3.5,
      )}</g>
      ${H("M44 146 C48 124 62 106 82 94", 9)}`,
  },
  "conical-flask": {
    name: "Conical flask (copper sulfate solution)",
    svg: () => {
      const c = id();
      return `${F(FLASK, "var(--glass)")}<clipPath id="${c}"><path d="${FLASK}"/></clipPath>
      <g clip-path="url(#${c})">${R(30, 150, 180, 80, "var(--chem)", false)}${R(30, 150, 180, 8, "var(--chem-l)", false)}</g>
      <rect x="90" y="38" width="60" height="16" class="o rr2" style="fill:var(--glass)"/>
      ${C(108, 186, 6, "#fff", false)}${C(130, 172, 4, "#fff", false)}${C(140, 196, 5, "#fff", false)}
      ${H("M108 62 L108 104 L72 176", 7)}`;
    },
  },
};
