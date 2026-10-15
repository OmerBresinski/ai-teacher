// TEACH-310 part c: table first-column discs: animals (pilot set-v13-table.js).
// v13 table (15 Oct): animals for first-column icon discs (mammals tick table, KS1 "where animals live").
// 240 viewBox, token colours only (#fff allowed), one shade + one gloss per silhouette, kit.js helpers.
// Faces or whole bodies, one object each, no setting. Read at disc size (~70px), so few details.
import { C, E, F, H, IL, P, SH } from "./kit";
import type { IconDrawing } from "./types";

const CAT =
  "M48 134 C48 94 80 72 120 72 C160 72 192 94 192 134 C192 180 160 208 120 208 C80 208 48 180 48 134Z";
const FROG =
  "M28 152 C28 114 70 102 120 102 C170 102 212 114 212 152 C212 192 170 212 120 212 C70 212 28 192 28 152Z";
const PENGUIN =
  "M120 26 C162 26 178 70 180 120 C184 172 166 212 120 212 C74 212 56 172 60 120 C62 70 78 26 120 26Z";
const BAT_L =
  "M104 112 C74 80 38 78 12 98 C30 106 34 122 28 142 C44 132 60 136 68 152 C78 138 92 140 104 150Z";
const BAT_R =
  "M136 112 C166 80 202 78 228 98 C210 106 206 122 212 142 C196 132 180 136 172 152 C162 138 148 140 136 150Z";
const BIRD =
  "M46 128 C46 88 80 64 118 64 C162 64 190 96 190 136 C190 180 158 206 118 206 C78 206 46 172 46 128Z";

export const TABLE: Record<string, IconDrawing> = {
  cat: {
    name: "Cat (face)",
    svg: () => `${F("M56 116 L64 34 L114 78Z", "var(--mito)")}${F("M184 116 L176 34 L126 78Z", "var(--mito)")}
      ${P("M70 98 L74 56 L100 82Z", "var(--pink)")}${P("M170 98 L166 56 L140 82Z", "var(--pink)")}
      ${F(CAT, "var(--mito)")}${SH(CAT, "M150 60 C224 104 220 200 128 222 L230 230 L230 60Z", "var(--mito-d)")}
      ${IL("M108 84 L110 102 M120 80 L120 100 M132 84 L130 102", "var(--mito-d)", 7)}
      ${E(92, 132, 10, 14, "var(--eye)", false)}${E(148, 132, 10, 14, "var(--eye)", false)}
      ${P("M108 156 L132 156 L120 170Z", "var(--pink-d)")}
      ${IL("M120 170 C116 180 106 182 100 176 M120 170 C124 180 134 182 140 176", "var(--eye)", 5)}
      ${IL("M36 152 L80 160 M38 174 L80 168 M204 152 L160 160 M202 174 L160 168", "var(--mito-d)", 4)}
      ${H("M68 112 C74 98 84 88 96 82", 8)}`,
  },
  bat: {
    name: "Bat (wings spread)",
    svg: () => `${F(BAT_L, "var(--earth)")}${F(BAT_R, "var(--earth)")}
      ${IL("M100 116 C78 106 54 102 32 104 M100 128 C82 126 66 132 54 142", "var(--earth-d)", 4)}
      ${IL("M140 116 C162 106 186 102 208 104 M140 128 C158 126 174 132 186 142", "var(--earth-d)", 4)}
      ${F("M104 72 L98 44 L118 62Z", "var(--earth-d)")}${F("M136 72 L142 44 L122 62Z", "var(--earth-d)")}
      ${E(120, 132, 24, 42, "var(--earth-d)")}${C(120, 86, 24, "var(--earth-d)")}
      ${C(111, 86, 5, "#fff", false)}${C(129, 86, 5, "#fff", false)}
      ${H("M106 112 C104 124 104 136 106 148", 6)}`,
  },
  penguin: {
    name: "Penguin",
    svg: () => `${F("M64 104 C40 128 36 160 48 180 C60 164 66 142 70 122Z", "var(--rock-d)")}
      ${F("M176 104 C200 128 204 160 192 180 C180 164 174 142 170 122Z", "var(--rock-d)")}
      ${E(98, 212, 20, 9, "var(--sun-d)")}${E(142, 212, 20, 9, "var(--sun-d)")}
      ${F(PENGUIN, "var(--rock-d)")}
      ${P("M120 80 C148 80 158 112 158 142 C158 182 146 204 120 204 C94 204 82 182 82 142 C82 112 92 80 120 80Z", "#fff")}
      ${C(104, 64, 8, "#fff", false)}${C(136, 64, 8, "#fff", false)}${C(105, 65, 4, "var(--eye)", false)}${C(135, 65, 4, "var(--eye)", false)}
      ${P("M106 80 L134 80 L120 98Z", "var(--sun-d)")}
      ${H("M76 82 C80 66 88 52 98 44", 8)}`,
  },
  frog: {
    name: "Frog (face)",
    svg: () => `${C(78, 98, 36, "var(--leaf)")}${C(162, 98, 36, "var(--leaf)")}
      ${F(FROG, "var(--leaf)")}${SH(FROG, "M30 176 C80 206 160 206 214 176 L214 230 L30 230Z", "var(--leaf-d)")}
      ${C(78, 96, 23, "#fff", false)}${C(162, 96, 23, "#fff", false)}${C(80, 98, 11, "var(--eye)", false)}${C(160, 98, 11, "var(--eye)", false)}
      ${IL("M66 160 C96 184 144 184 174 160", "var(--leaf-d)", 7)}
      ${E(56, 158, 13, 8, "var(--pink)", false)}${E(184, 158, 13, 8, "var(--pink)", false)}
      ${C(110, 134, 3.5, "var(--leaf-d)", false)}${C(130, 134, 3.5, "var(--leaf-d)", false)}
      ${H("M54 86 C58 76 64 70 72 66", 6)}`,
  },
  rabbit: {
    name: "Rabbit (face)",
    svg: () => `${E(92, 70, 20, 54, "var(--smoke)")}${E(148, 70, 20, 54, "var(--smoke)")}
      ${E(92, 76, 9, 38, "var(--pink)", false)}${E(148, 76, 9, 38, "var(--pink)", false)}
      ${C(120, 150, 64, "var(--smoke)")}${SH("M56 150 A64 64 0 1 1 184 150 A64 64 0 1 1 56 150Z", "M150 80 C210 120 210 200 130 222 L230 230 L230 80Z", "var(--stone)")}
      ${E(120, 176, 32, 24, "#fff", false)}
      ${C(98, 140, 8, "var(--eye)", false)}${C(142, 140, 8, "var(--eye)", false)}
      ${P("M110 160 L130 160 L120 172Z", "var(--pink-d)")}
      ${IL("M120 172 L120 182", "var(--eye)", 4)}
      ${P("M112 184 L128 184 L128 198 L112 198Z", "#fff", 'style="fill:#fff;stroke:var(--stone);stroke-width:2px"')}
      ${H("M76 130 C80 116 88 106 98 100", 8)}`,
  },
  bird: {
    name: "Bird (robin)",
    svg: () => `${F("M176 140 L224 112 L216 166Z", "var(--earth-d)")}
      ${IL("M104 200 L100 226 M132 200 L136 226", "var(--sun-d)", 7)}
      ${F(BIRD, "var(--earth)")}
      ${P("M52 150 C48 118 66 98 92 96 C112 116 114 166 82 194 C66 186 56 170 52 150Z", "var(--mito)")}
      ${IL("M118 118 C150 112 176 130 182 158", "var(--earth-d)", 7)}
      ${P("M50 104 L22 116 L52 126Z", "var(--sun-d)")}
      ${C(78, 98, 9, "var(--eye)", false)}${C(80, 95, 3, "#fff", false)}
      ${H("M70 82 C80 72 94 66 108 66", 7)}`,
  },
};
