// TEACH-310 part c: reasons slides: sweating, the fall of Rome, the Great Fire (pilot set-v13-reasons.js).
// v13 reasons (15 Oct): reusable THINGS for "why?" slides (sweating, the fall of Rome, the Great Fire of London).
// 240 viewBox, token colours only (#fff allowed), one shade + one gloss per silhouette, kit.js helpers.
// Each drawing is ONE object with no setting.
import { C, E, F, H, IL, L, P, RR, SH } from "./kit";
import type { IconDrawing } from "./types";

const DROP =
  "M120 26 C150 74 188 112 188 152 C188 192 158 220 120 220 C82 220 52 192 52 152 C52 112 90 74 120 26Z";
const SHIELD =
  "M54 40 C98 30 142 30 186 40 C196 92 196 148 186 200 C142 210 98 210 54 200 C44 148 44 92 54 40Z";
const FLAME =
  "M120 222 C72 222 46 192 46 152 C46 112 74 92 82 52 C102 72 108 92 108 108 C122 88 132 56 126 20 C170 48 194 104 194 152 C194 192 168 222 120 222Z";
const INNER =
  "M120 222 C96 222 82 206 82 184 C82 160 100 148 106 124 C116 138 120 150 120 160 C130 150 136 136 136 120 C152 138 158 162 158 184 C158 206 144 222 120 222Z";

export const REASONS: Record<string, IconDrawing> = {
  "sweat-drop": {
    name: "Sweat drop",
    svg: () => `${F(DROP, "var(--water)")}${SH(DROP, "M140 20 C214 90 214 200 150 230 L230 230 L230 20Z", "var(--water-d)")}
      ${IL("M84 156 C84 178 98 194 120 198", "#fff", 9, 'opacity=".55"')}
      ${H("M100 92 C92 108 84 122 80 136", 9)}`,
  },
  thermometer: {
    name: "Thermometer (hot)",
    svg: () => {
      const tube =
        "M100 54 C100 30 140 30 140 54 L140 150 C158 160 168 178 168 196 C168 224 146 240 120 240 C94 240 72 224 72 196 C72 178 82 160 100 150Z";
      return `<g transform="translate(120 122) scale(.92) translate(-120 -136)">${F(tube, "var(--enamel)")}${SH(tube, "M128 20 L200 20 L200 250 L128 250Z", "var(--enamel-d)")}
      ${RR(110, 70, 20, 120, "var(--flesh)", "rr2", false)}${C(120, 198, 30, "var(--flesh)", false)}
      ${IL("M150 72 L164 72 M150 98 L164 98 M150 124 L164 124", "var(--enamel-d)", 6)}
      ${H("M108 186 C104 194 104 202 108 208", 6)}</g>`;
    },
  },
  coin: {
    name: "Coin (gold)",
    svg: () => `${C(120, 120, 88, "var(--gold)")}${SH("M120 32 A88 88 0 1 1 119 32Z", "M150 20 C230 60 230 190 140 226 L230 226 L230 20Z", "var(--gold-d)")}
      <circle cx="120" cy="120" r="64" style="fill:none;stroke:var(--gold-d);stroke-width:7px;opacity:.7"/>
      ${E(120, 108, 22, 26, "var(--gold-d)", false, 'opacity=".75"')}${P("M84 166 C90 142 104 132 120 132 C136 132 150 142 156 166Z", "var(--gold-d)", 'opacity=".75"')}
      ${H("M62 96 C68 78 80 64 96 56", 8)}`,
  },
  shield: {
    name: "Shield (Roman, curved)",
    svg: () => `${F(SHIELD, "var(--roman)")}${SH(SHIELD, "M132 20 L220 20 L220 220 L132 220Z", "var(--roman-d)")}
      ${IL("M120 44 L120 196 M62 120 L178 120", "var(--gold)", 8)}${C(120, 120, 22, "var(--gold)")}${C(120, 120, 9, "var(--gold-d)", false)}
      ${H("M66 60 C64 84 64 106 66 128", 8)}`,
  },
  wind: {
    name: "Wind (strong gust)",
    svg: () => `${L("M30 92 L146 92 C172 92 184 74 176 56 C168 40 144 40 136 58", "var(--sky)", 18)}
      ${L("M30 132 L182 132 C206 132 218 150 210 168 C202 184 178 184 170 166", "var(--water)", 18)}
      ${L("M52 172 L118 172", "var(--sky)", 18)}`,
  },
  flame: {
    name: "Flame",
    svg: () => `${F(FLAME, "var(--fire)")}${SH(FLAME, "M138 10 C214 70 214 200 140 230 L230 230 L230 10Z", "var(--magma-d)")}
      ${P(INNER, "var(--fire-l)")}${H("M74 144 C74 124 84 108 94 94", 8)}`,
  },
};
