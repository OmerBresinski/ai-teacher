// TEACH-310 part c: task set-up: alone, pairs, groups, goggles (pilot set-v13-task.js).
// v13 task set-up (15 Oct): how the class works (alone, pairs, groups) and two lab things the practical list lacked.
// 240 viewBox, token colours only (#fff allowed), kit.js helpers, one shade + one gloss per silhouette.
// Reusable things, not scenes. People are plain pictogram figures (no faces), so they read at chip size (~60px).
import { C, E, F, H, IL, L, P, SH } from "./kit";
import type { IconDrawing } from "./types";

// one standing figure, head at (x, y), scale s, colour c
const person = (x: number, y: number, s: number, c: string) => {
  const w = 22 * s,
    b = (n: number) => n * s;
  return `${F(`M${x - b(34)} ${y + b(128)} C${x - b(34)} ${y + b(66)} ${x - b(24)} ${y + b(44)} ${x} ${y + b(44)} C${x + b(24)} ${y + b(44)} ${x + b(34)} ${y + b(66)} ${x + b(34)} ${y + b(128)}Z`, c)}${C(x, y, w * 1.05, c)}`;
};
const GOG_L =
  "M30 92 C30 76 42 68 60 68 L104 68 C114 68 120 76 120 88 L120 124 C120 142 108 152 92 152 L64 152 C44 152 30 140 30 122Z";
const GOG_R =
  "M210 92 C210 76 198 68 180 68 L136 68 C126 68 120 76 120 88 L120 124 C120 142 132 152 148 152 L176 152 C196 152 210 140 210 122Z";

export const TASK: Record<string, IconDrawing> = {
  "work-alone": {
    name: "On your own",
    svg: () => `${person(120, 74, 1.25, "var(--icon-primary)")}
      ${SH("M78 234 C78 156 96 128 120 128 C144 128 162 156 162 234Z", "M136 120 L180 120 L180 236 L136 236Z", "var(--icon-primary-dark)")}
      ${H("M92 186 C92 166 98 150 108 142", 8)}`,
  },
  "work-pairs": {
    name: "In pairs",
    svg: () => `${person(78, 86, 1.05, "var(--icon-secondary)")}${person(162, 86, 1.05, "var(--icon-primary)")}
      ${H("M54 180 C54 162 60 150 68 144", 7)}${H("M138 180 C138 162 144 150 152 144", 7)}`,
  },
  "work-group": {
    name: "In groups",
    svg: () => `${person(72, 70, 0.82, "var(--icon-secondary-dark)")}${person(168, 70, 0.82, "var(--icon-secondary)")}
      ${person(92, 112, 0.9, "var(--icon-primary)")}${person(150, 112, 0.9, "var(--icon-primary-dark)")}
      ${H("M72 204 C72 186 78 174 86 168", 7)}`,
  },
  "finish-flag": {
    name: "What you finish with",
    svg: () => {
      const flag =
        "M70 34 C104 22 130 50 164 40 C182 35 196 30 206 26 L206 120 C190 128 178 132 164 134 C130 142 104 114 70 126Z";
      return `${L("M62 30 L62 222", "var(--icon-ink)", 14)}${F(flag, "var(--icon-primary)")}
      ${SH(flag, "M150 20 L214 20 L214 140 L150 140Z", "var(--icon-primary-dark)")}
      ${C(62, 24, 13, "var(--gold)")}${E(62, 222, 36, 10, "var(--icon-ink)", false)}
      ${H("M84 52 C100 44 116 46 128 52", 8)}`;
    },
  },
  "safety-goggles": {
    name: "Safety goggles",
    svg: () => `${IL("M30 104 C12 104 8 118 14 130 M210 104 C228 104 232 118 226 130", "var(--icon-ink)", 12)}
      ${F(GOG_L, "var(--glass)")}${F(GOG_R, "var(--glass)")}
      ${SH(GOG_L, "M84 60 L124 60 L124 160 L84 160Z", "var(--sky)")}${SH(GOG_R, "M174 60 L214 60 L214 160 L174 160Z", "var(--sky)")}
      ${P("M106 152 C112 136 128 136 134 152Z", "var(--icon-ink)")}
      ${IL("M30 92 C30 76 42 68 60 68 L180 68 C198 68 210 76 210 92", "var(--icon-secondary)", 14)}
      ${H("M48 120 C46 104 52 92 64 88", 8)}${H("M150 120 C148 104 154 92 166 88", 8)}`,
  },
  spatula: {
    name: "Spatula",
    svg: () => `${L("M58 182 L182 58", "var(--metal-d)", 30)}${L("M58 182 L182 58", "var(--metal)", 18, 1, "round")}
      ${F("M30 222 C18 210 22 184 40 170 L70 200 C56 218 42 232 30 222Z", "var(--metal)")}
      ${F("M210 18 C222 30 218 56 200 70 L170 40 C184 22 198 8 210 18Z", "var(--metal)")}
      ${SH("M30 222 C18 210 22 184 40 170 L70 200 C56 218 42 232 30 222Z", "M50 180 L80 210 L40 240Z", "var(--metal-d)")}
      ${H("M190 48 C196 40 202 34 206 30", 6)}`,
  },
};
