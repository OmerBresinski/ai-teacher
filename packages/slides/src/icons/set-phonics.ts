// TEACH-310 part c: phonics picture cues and the alien-word marker (pilot set-v13-phonics.js).
// v13 phonics (15 Oct): picture cues for grapheme cards and the "alien word" marker of the Phonics Screening Check.
// 240 viewBox, token colours only (#fff allowed), one shade + one gloss per silhouette, kit.js helpers.
// One object each, no setting. Read at disc size (~120-200px) on early slides.
import { C, E, F, H, IL, SH } from "./kit";
import type { IconDrawing } from "./types";

const MOON =
  "M150 34 C96 40 56 84 56 138 C56 182 92 214 138 214 C170 214 196 198 210 172 C196 178 182 180 168 180 C120 180 84 144 84 98 C84 70 112 44 150 34Z";
const HULL = "M28 150 L212 150 L190 196 C186 204 180 208 170 208 L64 208 C56 208 50 204 46 196Z";
const SAIL = "M126 40 L126 140 L54 140Z";
const SAIL2 = "M134 58 L134 140 L188 140Z";
const HEAD =
  "M120 52 C168 52 196 84 196 124 C196 170 160 204 120 204 C80 204 44 170 44 124 C44 84 72 52 120 52Z";
const STAR = (x: number, y: number, r: number) =>
  `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3}Z`;

export const PHONICS: Record<string, IconDrawing> = {
  "moon-night": {
    name: "Moon and stars (night)",
    svg: () => `${C(120, 124, 96, "var(--lapis)", false)}
      ${F(MOON, "var(--sun)")}${SH(MOON, "M60 150 C80 200 150 220 214 170 L230 230 L40 230Z", "var(--sun-d)")}
      ${F(STAR(176, 70, 20), "#fff")}${F(STAR(196, 120, 12), "#fff")}${F(STAR(118, 154, 10), "#fff")}
      ${H("M72 120 C74 96 88 72 108 58", 8)}`,
  },
  ship: {
    name: "Ship (sailing boat)",
    svg: () => `${IL("M130 26 L130 150", "var(--wood-d)", 8)}
      ${F(SAIL, "var(--enamel)")}${SH(SAIL, "M100 40 L130 40 L130 150 L90 150Z", "var(--enamel-d)")}
      ${F(SAIL2, "var(--flesh)")}
      ${F(HULL, "var(--wood)")}${SH(HULL, "M20 182 L220 182 L220 220 L20 220Z", "var(--wood-d)")}
      ${C(86, 172, 7, "var(--enamel)", false)}${C(120, 172, 7, "var(--enamel)", false)}${C(154, 172, 7, "var(--enamel)", false)}
      ${IL("M24 222 C44 212 64 212 84 222 C104 232 124 232 144 222 C164 212 184 212 216 222", "var(--water)", 8)}
      ${H("M70 128 L110 62", 7)}`,
  },
  alien: {
    name: "Alien (nonsense word marker)",
    svg: () => `${IL("M92 62 L74 26 M148 62 L166 26", "var(--leaf-d)", 7)}${C(74, 26, 11, "var(--fire-l)")}${C(166, 26, 11, "var(--fire-l)")}
      ${F(HEAD, "var(--leaf)")}${SH(HEAD, "M150 60 C214 100 210 190 120 214 L230 230 L230 60Z", "var(--leaf-d)")}
      ${E(92, 116, 22, 26, "#fff")}${E(148, 116, 22, 26, "#fff")}
      ${C(96, 122, 11, "var(--icon-ink)", false)}${C(144, 122, 11, "var(--icon-ink)", false)}
      ${IL("M96 166 C108 178 132 178 144 166", "var(--icon-ink)", 7)}
      ${H("M66 104 C70 86 82 72 98 64", 8)}`,
  },
};
