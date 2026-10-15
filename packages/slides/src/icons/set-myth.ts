// TEACH-310 part c: myth and fact (pilot set-v12-myth.js); the helmet is redrawn here (Greg's reasons sign-off, 15 Oct).
// v12 myth-and-fact icons (library style, 240 viewBox, token colours only).
// hammer, bird-feather, willow-tub: moved from northstars-v11/myth/d2/icons-d2.js. helmet: new (plain rounded helmet with a nose guard).
import { C, F, H, IL, L, RR, SH } from "./kit";
import type { IconDrawing } from "./types";

export const MYTH: Record<string, IconDrawing> = {
  hammer: {
    name: "Hammer",
    svg: () => {
      const head =
        "M36 82 L96 62 L178 62 C190 62 198 70 198 82 L198 96 C198 108 190 116 178 116 L96 116 L36 98 C30 96 30 84 36 82Z";
      return `<g transform="rotate(-24 120 120)">
      ${RR(106, 104, 28, 124, "var(--wood)", "rr2")}${SH("M106 104 L134 104 L134 228 L106 228Z", "M122 100 L140 100 L140 230 L122 230Z", "var(--wood-d)")}
      ${F(head, "var(--metal)")}${SH(head, "M20 92 L210 92 L210 130 L20 130Z", "var(--metal-d)")}
      ${RR(176, 58, 26, 62, "var(--metal-d)", "rr2")}
      ${H("M100 74 L168 74", 7)}${H("M114 128 L114 196", 6)}</g>`;
    },
  },
  "bird-feather": {
    name: "Feather",
    svg: () => {
      const vane =
        "M178 20 C206 40 198 94 172 130 C152 158 122 178 94 188 L84 178 C80 150 84 116 98 88 C116 56 144 30 178 20Z";
      return `${F(vane, "var(--enamel)")}${SH(vane, "M150 40 C200 50 210 100 176 136 C156 160 124 180 94 192 L210 210 L210 20Z", "var(--enamel-d)")}
      <g class="dt">${IL("M112 136 L96 124 M124 112 L106 100 M140 88 L124 72 M128 150 L152 152 M144 128 L172 124 M160 104 L186 96", "var(--enamel-d)", 3.5)}</g>
      ${L("M60 222 C92 172 130 112 178 26", "var(--metal-d)", 6)}
      ${H("M112 92 C122 70 136 54 152 42", 6)}`;
    },
  },
  "willow-tub": {
    name: "Willow in a tub",
    svg: () => {
      const tub = "M76 170 L164 170 L156 224 L84 224Z";
      const crown =
        "M120 18 C166 18 200 44 200 80 C200 100 188 112 170 116 L70 116 C52 112 40 100 40 80 C40 44 74 18 120 18Z";
      return `${F("M112 172 L114 100 C114 92 126 92 126 100 L128 172Z", "var(--wood)")}
      ${L("M46 96 C40 120 40 146 44 168 M66 108 C62 128 62 146 64 160 M174 108 C178 128 178 146 176 160 M194 96 C200 120 200 146 196 168 M92 112 C90 124 90 134 92 144 M148 112 C150 124 150 134 148 144", "var(--leaf)", 9)}
      ${F(crown, "var(--leaf)")}${SH(crown, "M150 16 C214 34 214 120 160 124 L214 124 L214 16Z", "var(--leaf-d)")}
      <g class="dt">${IL("M70 70 C76 84 76 96 72 106 M104 50 C110 66 110 86 106 104 M140 52 C146 68 146 88 142 106 M174 66 C180 80 180 94 176 106", "var(--leaf-d)", 4, 'opacity=".55"')}</g>
      ${F(tub, "var(--clay)")}${SH(tub, "M128 160 L176 160 L168 232 L120 232Z", "var(--clay-d)")}
      ${RR(68, 162, 104, 16, "var(--earth)", "rr2")}
      ${H("M62 60 C70 44 86 34 104 30", 8)}`;
    },
  },

  helmet: {
    // Redrawn 15 Oct (Greg, reasons sign-off: the plain dome read as a sign at chip size). An
    // early medieval spangenhelm: bronze bands on an iron dome, a dark face opening either side
    // of the nose guard so it reads as a helmet someone wears, no horns.
    name: "Helmet (early medieval, nose guard)",
    svg: () => {
      const dome = "M38 152 C38 86 74 36 120 28 C166 36 202 86 202 152Z";
      const face = "M54 158 L186 158 C186 190 174 212 156 220 L84 220 C66 212 54 190 54 158Z";
      return `${F(face, "var(--wire)")}
      ${F(dome, "var(--metal)")}${SH(dome, "M134 20 C196 44 220 110 210 160 L220 160 L220 20Z", "var(--metal-d)")}
      ${L("M120 32 L120 144", "var(--gold-d)", 14)}${L("M76 62 C64 88 58 116 58 144 M164 62 C176 88 182 116 182 144", "var(--gold-d)", 10)}
      ${RR(30, 138, 180, 28, "var(--gold)", "rr2")}${SH("M30 138 L210 138 L210 166 L30 166Z", "M30 154 L210 154 L210 170 L30 170Z", "var(--gold-d)")}
      ${RR(108, 150, 24, 70, "var(--gold)", "rr2")}${SH("M108 150 L132 150 L132 220 L108 220Z", "M122 146 L136 146 L136 224 L122 224Z", "var(--gold-d)")}
      <g class="dt">${[52, 84, 156, 188].map((x) => C(x, 152, 5, "var(--gold-d)", false)).join("")}${C(120, 40, 6, "var(--gold-d)", false)}</g>
      ${H("M66 116 C70 90 84 68 102 54", 9)}`;
    },
  },
};
