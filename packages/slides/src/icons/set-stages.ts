// TEACH-310 part c: stages strips: fossil, bread, river, a bill in Parliament (pilot set-v12-stages.js).
// v12 stages (15 Oct): reusable THINGS for process strips (fossil, bread, river, a bill in Parliament).
// Replaces the v11 stage "scenes" (dead fish on the seabed, fish under layers, fossil under a magnifier).
// 240 viewBox, token colours only (#fff allowed), one shade + one gloss per silhouette, kit.js helpers.
// Rule for this set: each drawing is ONE object with no setting (no seabed, sky or field around it).
import { C, CLIP, E, F, H, IL, L, P, RR, SH } from "./kit";
import type { IconDrawing } from "./types";

const FISH = "M-74 2 C-52 -40 22 -46 56 -8 L88 -36 C96 -12 96 14 88 38 L56 8 C22 46 -52 42 -74 2Z";
const FIN = "M-18 -32 C-8 -58 24 -56 34 -28Z";
const bones = (c: string, w = 6) => {
  const ribs = [-34, -18, -2, 14, 30]
    .map((x) => `M${x} -22 C${x + 6} -10 ${x + 6} 10 ${x} 22`)
    .join(" ");
  return `${IL(`M-50 0 L58 0 ${ribs} M58 0 L82 -24 M58 0 L82 24`, c, w)}
    ${IL("M-74 2 C-68 -16 -54 -24 -42 -22 C-46 -8 -46 10 -42 24 C-54 26 -68 18 -74 2Z", c, w)}`;
};
const gem = (x: number, y: number, s: number, c: string, cd: string) =>
  `${F(`M${x} ${y - 12 * s} L${x + 8 * s} ${y} L${x} ${y + 12 * s} L${x - 8 * s} ${y}Z`, c)}${P(`M${x} ${y - 12 * s} L${x + 8 * s} ${y} L${x} ${y + 12 * s}Z`, cd, 'class="sh"')}`;
const SLAB =
  "M30 78 C58 52 176 48 208 74 C222 108 224 146 210 176 C176 204 64 206 28 178 C16 146 18 108 30 78Z";
const ear = (x: number, y: number, h: number, c: string, cd: string) => {
  const g: string[] = [];
  for (let i = 0; i < 4; i++) {
    const yy = y - h + 10 + i * 13;
    g.push(
      E(x - 7, yy, 6, 10, c, true, `transform="rotate(-28 ${x - 7} ${yy})"`),
      E(x + 7, yy, 6, 10, c, true, `transform="rotate(28 ${x + 7} ${yy})"`),
    );
  }
  return `${L(`M${x} ${y} L${x} ${y - h + 50}`, cd, 6)}${g.join("")}${E(x, y - h, 6, 11, c)}`;
};

export const STAGES: Record<string, IconDrawing> = {
  fish: {
    name: "Fish",
    svg: () => `<g transform="translate(116 122) scale(1.18)">
      ${F(FIN, "var(--mito-d)")}${F(FISH, "var(--mito)")}${SH(FISH, "M-90 10 C-40 30 40 30 100 4 L100 60 L-90 60Z", "var(--mito-d)")}
      ${C(-46, -6, 8, "#fff")}${C(-46, -6, 3.5, "var(--eye)", false)}
      ${IL("M-22 -20 C-14 -8 -14 10 -22 22", "var(--mito-d)", 5)}
      ${H("M-48 -20 C-34 -32 -16 -36 4 -34", 7)}</g>`,
  },
  "fish-skeleton": {
    name: "Fish skeleton",
    svg: () => `<g transform="translate(112 120) scale(1.3)">${bones("var(--rock-d)", 19)}${bones("var(--alabaster)", 11)}</g>
      ${H("M44 98 C52 90 60 86 70 84", 6)}`,
  },
  "rock-layers": {
    name: "Rock layers (sediment)",
    svg: () => {
      const blk = "M30 58 L210 58 L210 206 L30 206Z";
      return `<rect x="30" y="58" width="180" height="148" class="o rr" style="fill:var(--sand-l)"/>
      ${CLIP(
        "M30 58 L210 58 L210 206 L30 206Z",
        `<rect x="30" y="58" width="180" height="148" class="rr" style="fill:var(--sand-l)"/>
        ${P("M20 88 C70 80 160 96 220 84 L220 120 C160 130 80 114 20 124Z", "var(--earth)")}
        ${P("M20 124 C80 114 160 130 220 120 L220 152 C150 160 80 146 20 156Z", "var(--sand)")}
        ${P("M20 156 C80 146 150 160 220 152 L220 180 C150 188 80 176 20 184Z", "var(--clay)")}
        ${P("M20 184 C80 176 150 188 220 180 L220 214 L20 214Z", "var(--earth-d)")}`,
      )}
      ${SH(blk, "M176 50 L218 50 L218 214 L176 214Z", "var(--earth-d)")}
      ${H("M46 70 L84 70", 7)}`;
    },
  },
  fossil: {
    name: "Fossil in stone",
    svg: () => `${F(SLAB, "var(--stone)")}${SH(SLAB, "M20 150 C80 176 170 170 230 140 L230 220 L10 220Z", "var(--rock)")}
      <g transform="translate(116 128) scale(.98)">${bones("var(--rock-d)", 11)}${bones("var(--alabaster)", 6)}</g>
      ${gem(62, 186, 1, "var(--chem-l)", "var(--chem)")}${gem(186, 82, 0.8, "var(--chem-l)", "var(--chem)")}
      ${H("M44 92 C58 76 80 68 104 64", 8)}`,
  },
  "magnifying-glass": {
    name: "Magnifying glass",
    svg: () => `${L("M150 150 L206 206", "var(--wire)", 26)}
      ${C(104, 104, 70, "var(--glass)")}${SH("M34 104 A70 70 0 1 0 174 104 A70 70 0 1 0 34 104Z", "M104 20 L190 20 L190 190 L104 190Z", "var(--sky)")}
      ${IL("M104 104 m-70 0 a70 70 0 1 0 140 0 a70 70 0 1 0 -140 0", "var(--icon-primary)", 16)}
      ${H("M62 82 C70 64 84 54 100 50", 9)}`,
  },
  wheat: {
    name: "Wheat (ripe ears)",
    svg: () => `<g transform="rotate(-20 120 222)">${ear(120, 222, 186, "var(--sun)", "var(--sun-d)")}</g>
      <g transform="rotate(20 120 222)">${ear(120, 222, 186, "var(--sun)", "var(--sun-d)")}</g>
      ${ear(120, 222, 206, "var(--gold)", "var(--sun-d)")}
      ${RR(100, 168, 40, 18, "var(--clay)", "rr2")}`,
  },
  "combine-harvester": {
    name: "Combine harvester",
    svg: () => {
      const body = "M74 92 L192 92 C202 92 210 100 210 110 L210 170 L74 170Z";
      const spokes = [0, 60, 120]
        .map((a) => {
          const r = (a * Math.PI) / 180;
          return `M${44 - 26 * Math.cos(r)} ${132 - 26 * Math.sin(r)} L${44 + 26 * Math.cos(r)} ${132 + 26 * Math.sin(r)}`;
        })
        .join(" ");
      return `${L("M196 70 L226 44", "var(--icon-primary-dark)", 13)}
      ${RR(140, 58, 64, 40, "var(--icon-primary-dark)", "rr2")}
      ${F(body, "var(--icon-primary)")}${SH(body, "M70 146 L214 146 L214 174 L70 174Z", "var(--icon-primary-dark)")}
      ${RR(84, 30, 54, 64, "var(--glass)", "rr2")}${IL("M84 62 L138 62", "var(--metal-d)", 4)}
      ${L("M78 162 L46 168", "var(--metal-d)", 12)}
      ${IL(spokes, "var(--sun-d)", 6)}${IL("M44 132 m-28 0 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0", "var(--sun-d)", 7)}
      ${RR(14, 156, 76, 34, "var(--sun)", "rr2")}${IL("M24 168 L80 168 M24 178 L80 178", "var(--sun-d)", 4)}
      ${C(118, 178, 40, "var(--wire)")}${C(118, 178, 16, "var(--metal)", false)}
      ${C(190, 192, 24, "var(--wire)")}${C(190, 192, 9, "var(--metal)", false)}
      ${H("M92 106 L172 106", 8)}`;
    },
  },
  bakery: {
    name: "Bakery (shop)",
    svg: () => {
      const wall = "M36 92 L204 92 L204 214 L36 214Z";
      const stripes = [0, 1, 2, 3, 4, 5]
        .map(
          (i) =>
            `<path d="M${30 + i * 30} 74 L${60 + i * 30} 74 L${60 + i * 30} 104 C${60 + i * 30} 116 ${30 + i * 30} 116 ${30 + i * 30} 104Z" style="fill:${i % 2 ? "#fff" : "var(--icon-primary)"}" class="o"/>`,
        )
        .join("");
      return `${F(wall, "var(--enamel)")}${SH(wall, "M168 80 L210 80 L210 220 L168 220Z", "var(--enamel-d)")}
      ${RR(24, 34, 192, 42, "var(--icon-primary-dark)", "rr2")}${stripes}
      ${RR(50, 128, 70, 64, "var(--glass)", "rr2")}
      ${E(70, 172, 14, 10, "var(--clay)")}${E(100, 172, 14, 10, "var(--clay)")}${E(85, 154, 15, 10, "var(--clay-l)")}
      ${RR(140, 128, 48, 86, "var(--wood)", "rr2")}${C(178, 172, 4, "var(--gold)", false)}
      ${H("M40 46 L96 46", 7)}`;
    },
  },
  "mountain-spring": {
    name: "Mountain spring (river source)",
    svg: () => {
      const back = "M110 200 L170 70 L232 200Z";
      const peak = "M8 206 L100 36 L192 206Z";
      const snow = "M70 92 L100 36 L130 92 L116 84 L100 98 L86 84Z";
      return `${F(back, "var(--stone)")}${F(peak, "var(--rock)")}${SH(peak, "M100 30 L200 30 L200 210 L100 210Z", "var(--rock-d)")}
      ${F(snow, "var(--enamel)")}
      ${L("M104 132 C92 150 120 168 100 190 C92 198 96 204 104 206", "var(--water)", 12)}
      ${C(104, 128, 9, "var(--water)")}
      ${H("M74 112 L92 78", 7)}`;
    },
  },
  waterfall: {
    name: "Waterfall",
    svg: () => {
      const cliff = "M18 66 C18 58 24 52 32 52 L150 52 L150 214 L18 214Z";
      const fall = "M118 58 L164 58 L164 192 L118 192Z";
      return `${F(cliff, "var(--rock)")}${SH(cliff, "M18 120 L150 120 L150 214 L18 214Z", "var(--rock-d)")}
      ${IL("M18 120 L150 120 M18 168 L150 168", "var(--rock-d)", 5)}
      ${F("M18 52 L150 52 L150 70 L18 70Z", "var(--water)")}
      ${F(fall, "var(--water)")}${IL("M130 72 L130 176 M146 86 L146 186", "#fff", 5)}
      ${E(158, 200, 66, 18, "var(--water)")}${E(158, 196, 36, 6, "var(--sky)", false)}
      ${H("M30 62 L70 62", 6)}`;
    },
  },
  meander: {
    name: "Meander (river bend, from above)",
    svg: () => {
      const land =
        "M24 60 C24 36 44 22 68 22 L172 22 C196 22 216 36 216 60 L216 180 C216 204 196 218 172 218 L68 218 C44 218 24 204 24 180Z";
      const river = "M20 56 C140 40 206 70 168 112 C134 150 52 112 60 166 C64 200 150 210 220 196";
      return `${F(land, "var(--grass)")}${SH(land, "M150 10 L230 10 L230 230 L150 230Z", "var(--leaf)")}
      ${CLIP(
        land,
        `${E(146, 84, 22, 12, "var(--sand)", false)}${E(92, 156, 22, 12, "var(--sand)", false)}
        <path d="${river}" style="fill:none;stroke:var(--water);stroke-width:30px;stroke-linecap:round"/>
        ${IL("M40 52 C110 44 160 52 178 70", "#fff", 5)}`,
      )}
      ${H("M38 50 C40 40 48 34 58 32", 6)}`;
    },
  },
  estuary: {
    name: "Estuary (river mouth, from above)",
    svg: () => {
      const land = "M24 60 C24 36 44 22 68 22 L172 22 C196 22 216 36 216 60 L216 150 L24 150Z";
      const sea =
        "M24 140 L216 140 L216 180 C216 204 196 218 172 218 L68 218 C44 218 24 204 24 180Z";
      const river = "M110 22 L130 22 C134 72 166 118 216 150 L24 150 C74 118 106 72 110 22Z";
      return `${F(land, "var(--grass)")}${SH(land, "M150 10 L230 10 L230 160 L150 160Z", "var(--leaf)")}
      ${F(sea, "var(--ocean)")}${P(river, "var(--water)")}
      ${E(84, 136, 16, 7, "var(--sand)", false)}${E(156, 138, 18, 7, "var(--sand)", false)}
      ${IL("M50 184 C66 176 82 192 98 184 M138 196 C154 188 170 204 186 196", "#fff", 5)}
      ${H("M38 50 C40 40 48 34 58 32", 6)}`;
    },
  },
  scroll: {
    name: "Scroll (a written bill or document)",
    svg: () => `${RR(54, 44, 132, 154, "var(--linen)", "rr2")}${SH("M54 44 L186 44 L186 198 L54 198Z", "M156 40 L192 40 L192 202 L156 202Z", "var(--linen-d)")}
      ${RR(40, 26, 160, 30, "var(--alabaster)", "rr2")}${RR(40, 186, 160, 30, "var(--alabaster)", "rr2")}
      ${IL("M74 80 L166 80 M74 104 L166 104 M74 128 L150 128 M74 152 L124 152", "var(--alabaster-d)", 7)}
      ${C(156, 168, 18, "var(--icon-primary)")}${C(156, 168, 7, "var(--icon-primary-dark)", false)}
      ${H("M50 36 L100 36", 6)}`,
  },
  "speech-bubbles": {
    name: "Speech bubbles (debate)",
    svg: () => {
      const a =
        "M20 52 C20 38 30 30 44 30 L132 30 C146 30 156 38 156 52 L156 104 C156 118 146 126 132 126 L72 126 L42 152 L48 126 L44 126 C30 126 20 118 20 104Z";
      const b =
        "M220 112 C220 98 210 90 196 90 L108 90 C94 90 84 98 84 112 L84 164 C84 178 94 186 108 186 L168 186 L198 212 L192 186 L196 186 C210 186 220 178 220 164Z";
      return `${F(a, "var(--icon-secondary)")}${SH(a, "M10 100 L160 100 L160 160 L10 160Z", "var(--icon-secondary-dark)")}
      ${F(b, "var(--icon-primary)")}${SH(b, "M80 160 L230 160 L230 220 L80 220Z", "var(--icon-primary-dark)")}
      ${C(122, 138, 9, "#fff", false)}${C(152, 138, 9, "#fff", false)}${C(182, 138, 9, "#fff", false)}
      ${H("M36 48 L80 48", 7)}`;
    },
  },
  pen: {
    name: "Pen (writing changes)",
    svg: () => `<g transform="rotate(40 120 120)">
      ${RR(98, 14, 44, 140, "var(--icon-secondary)", "rr2")}${SH("M98 14 L142 14 L142 154 L98 154Z", "M126 10 L146 10 L146 158 L126 158Z", "var(--icon-secondary-dark)")}
      ${RR(96, 128, 48, 22, "var(--gold)", "rr2")}
      ${F("M102 150 L138 150 L120 214Z", "var(--gold)")}${IL("M120 168 L120 200", "var(--gold-d)", 4)}
      ${L("M136 30 L136 92", "var(--gold-d)", 6)}
      ${H("M108 30 L108 100", 7)}</g>`,
  },
  "ballot-box": {
    name: "Ballot box (a vote)",
    svg: () => `${RR(86, 24, 68, 100, "var(--enamel)", "rr2")}${IL("M100 52 L140 84 M140 52 L100 84", "var(--icon-primary)", 9)}
      ${RR(34, 110, 172, 108, "var(--icon-secondary)", "rr")}${SH("M34 110 L206 110 L206 218 L34 218Z", "M168 104 L212 104 L212 224 L168 224Z", "var(--icon-secondary-dark)")}
      ${L("M80 112 L160 112", "var(--icon-ink)", 10)}
      ${RR(84, 146, 72, 34, "#fff", "rr2", false)}
      ${H("M48 128 L48 190", 7)}`,
  },
  portcullis: {
    name: "Portcullis (Parliament)",
    svg: () => {
      const bars = [64, 96, 128, 160].map((x) => `M${x + 8} 70 L${x + 8} 196`).join(" ");
      const rails = [92, 124, 156].map((y) => `M44 ${y} L196 ${y}`).join(" ");
      const spikes = [56, 88, 120, 152, 184]
        .map((x) => `M${x - 8} 190 L${x + 8} 190 L${x} 214Z`)
        .join(" ");
      return `${IL("M50 66 C30 60 22 40 30 26 M190 66 C210 60 218 40 210 26", "var(--gold-d)", 7)}
      ${F(spikes, "var(--gold)")}
      ${L(bars, "var(--gold)", 12)}${L(rails, "var(--gold)", 12)}
      ${L("M40 60 L200 60 M40 60 L40 196 M200 60 L200 196", "var(--gold)", 16)}
      ${H("M52 52 L110 52", 6)}`;
    },
  },
  crown: {
    name: "Crown",
    svg: () => {
      const crown = "M40 176 L28 74 L80 122 L120 50 L160 122 L212 74 L200 176Z";
      return `${F(crown, "var(--gold)")}${SH(crown, "M120 40 L220 40 L220 180 L120 180Z", "var(--gold-d)")}
      ${C(28, 70, 11, "var(--gold)")}${C(120, 44, 12, "var(--gold)")}${C(212, 70, 11, "var(--gold)")}
      ${RR(34, 168, 172, 40, "var(--icon-primary)", "rr2")}
      ${C(80, 188, 9, "#fff", false)}${C(120, 188, 11, "var(--icon-secondary)")}${C(160, 188, 9, "#fff", false)}
      ${H("M54 160 L44 98", 7)}`;
    },
  },
};
