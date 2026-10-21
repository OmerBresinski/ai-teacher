// TEACH-310 part c: MFL vocabulary: animals and cafe food (pilot set-v13-vocab.js).
// v13 vocab (15 Oct): things for MFL vocabulary sets (KS2 animals, KS3 food at the café).
// 240 viewBox, token colours only (#fff allowed), one shade + one gloss per silhouette, kit.js helpers.
// One object each, no setting. Read at disc size (~70px), so few details.
import { C, CLIP, E, F, H, IL, P, SH } from "./kit";
import type { IconDrawing } from "./types";

const DOG =
  "M58 128 C58 88 86 66 120 66 C154 66 182 88 182 128 C182 176 154 206 120 206 C86 206 58 176 58 128Z";
const MOUSE =
  "M40 172 C40 128 76 96 124 96 C172 96 206 128 206 172 C206 190 196 198 180 198 L66 198 C50 198 40 190 40 172Z";
const HORSE =
  "M92 40 C130 30 172 60 180 110 C186 150 176 190 150 210 L102 210 C110 180 106 156 88 140 C68 150 46 146 38 128 C30 110 44 92 60 80 C68 62 78 46 92 40Z";
const CROISSANT =
  "M24 150 C34 104 74 78 120 78 C166 78 206 104 216 150 C196 140 176 142 160 154 C148 136 134 130 120 130 C106 130 92 136 80 154 C64 142 44 140 24 150Z";
const CREPE = "M48 196 L48 60 A136 136 0 0 1 184 196Z";
const CAKE = "M40 120 L200 120 L200 196 C200 204 194 208 186 208 L54 208 C46 208 40 204 40 196Z";
const EGG =
  "M120 30 C166 30 192 104 192 148 C192 190 160 216 120 216 C80 216 48 190 48 148 C48 104 74 30 120 30Z";
const CUP = "M52 96 L176 96 L168 168 C166 190 148 204 126 204 L102 204 C80 204 62 190 60 168Z";
const LEMON =
  "M30 124 C38 84 78 62 120 62 C162 62 202 84 210 124 C202 164 162 186 120 186 C78 186 38 164 30 124Z";
const APPLE =
  "M120 76 C150 56 200 66 204 120 C208 170 172 214 140 210 C130 208 126 204 120 204 C114 204 110 208 100 210 C68 214 32 170 36 120 C40 66 90 56 120 76Z";
const CHICKEN =
  "M44 150 C40 112 76 84 120 84 C164 84 196 108 196 142 C196 176 164 198 120 198 C80 198 48 182 44 150Z";
const CONE = "M80 116 L160 116 L124 224 L116 224Z";

export const VOCAB: Record<string, IconDrawing> = {
  dog: {
    name: "Dog (face)",
    svg: () => `${F("M66 82 C40 84 26 120 34 156 C50 150 62 134 70 112Z", "var(--earth-d)")}
      ${F("M174 82 C200 84 214 120 206 156 C190 150 178 134 170 112Z", "var(--earth-d)")}
      ${F(DOG, "var(--clay-l)")}${SH(DOG, "M150 70 C214 110 212 196 128 222 L230 230 L230 70Z", "var(--clay)")}
      ${E(120, 168, 40, 30, "var(--enamel)", false)}
      ${E(96, 124, 9, 12, "var(--eye)", false)}${E(144, 124, 9, 12, "var(--eye)", false)}
      ${E(120, 156, 16, 11, "var(--eye)", false)}
      ${IL("M120 166 L120 178 M120 178 C114 186 104 186 98 180 M120 178 C126 186 136 186 142 180", "var(--eye)", 5)}
      ${H("M76 112 C80 96 90 84 104 78", 8)}`,
  },
  mouse: {
    name: "Mouse",
    svg: () => `${IL("M204 180 C224 176 230 154 214 140", "var(--pink-d)", 6)}
      ${C(94, 96, 30, "var(--smoke)")}${C(94, 96, 16, "var(--pink)", false)}
      ${F(MOUSE, "var(--smoke)")}${SH(MOUSE, "M40 182 C100 196 170 196 206 170 L220 220 L30 220Z", "var(--stone)")}
      ${C(54, 168, 7, "var(--pink-d)", false)}${C(80, 146, 7, "var(--eye)", false)}
      ${IL("M50 172 L22 164 M50 176 L24 182", "var(--stone)", 3)}
      ${H("M84 118 C98 108 116 104 134 104", 7)}`,
  },
  horse: {
    name: "Horse (head)",
    svg: () => `${F("M96 44 L104 14 L120 46Z", "var(--earth)")}
      ${F(HORSE, "var(--earth)")}${SH(HORSE, "M150 56 C196 110 192 190 150 220 L230 230 L230 56Z", "var(--earth-d)")}
      ${P("M100 42 C130 40 150 70 156 110 C162 150 160 186 150 210 L168 210 C186 180 190 140 184 108 C176 64 142 34 100 42Z", "var(--earth-d)")}
      ${E(52, 120, 16, 14, "var(--clay-l)", false)}${C(48, 116, 4, "var(--eye)", false)}
      ${C(96, 84, 8, "var(--eye)", false)}${C(98, 81, 3, "#fff", false)}
      ${H("M70 78 C76 66 84 58 94 54", 7)}`,
  },
  croissant: {
    name: "Croissant",
    svg: () => `${F(CROISSANT, "var(--mito)")}${SH(CROISSANT, "M20 150 C80 120 160 120 220 150 L220 200 L20 200Z", "var(--mito-d)")}
      ${IL("M84 90 C92 110 94 126 92 146 M120 80 L120 128 M156 90 C148 110 146 126 148 146", "var(--mito-d)", 6)}
      ${H("M60 104 C74 92 90 86 106 84", 8)}`,
  },
  crepe: {
    name: "Crêpe (folded in four)",
    svg: () => `${E(116, 200, 98, 16, "var(--enamel-d)")}
      ${F(CREPE, "var(--sand)")}${SH(CREPE, "M48 150 C100 160 150 150 190 120 L200 210 L40 210Z", "var(--mito)")}
      ${IL("M64 84 C100 92 130 116 150 150", "var(--earth-d)", 9)}
      ${C(76, 120, 7, "var(--mito-d)", false)}${C(112, 168, 6, "var(--mito-d)", false)}${C(70, 170, 5, "var(--mito-d)", false)}
      ${H("M60 76 C70 90 76 110 76 130", 8)}`,
  },
  cake: {
    name: "Cake (slice of sponge)",
    svg: () => `${F(CAKE, "var(--sand-l)")}${SH(CAKE, "M160 110 L210 110 L210 216 L150 216Z", "var(--sand)")}
      ${P("M40 156 L200 156 L200 170 L40 170Z", "var(--pink-d)")}
      ${F("M34 122 C34 98 70 86 120 86 C170 86 206 98 206 122 C206 132 196 134 188 128 C178 140 166 140 156 130 C146 142 134 142 124 130 C112 142 100 142 90 130 C80 140 66 140 56 128 C46 134 34 132 34 122Z", "var(--enamel)")}
      ${C(120, 70, 18, "var(--flesh)")}${IL("M120 52 C122 44 128 38 136 36", "var(--leaf-d)", 5)}
      ${H("M56 106 C70 98 88 94 106 92", 7)}`,
  },
  egg: {
    name: "Egg",
    svg: () => `${F(EGG, "var(--clay-l)")}${SH(EGG, "M150 40 C214 100 206 196 126 224 L230 230 L230 40Z", "var(--clay)")}
      ${H("M80 104 C84 82 94 62 108 50", 9)}`,
  },
  fries: {
    name: "Chips / fries (carton)",
    svg: () => `${["M70 120 L62 46 L80 44 L88 120Z", "M92 120 L94 34 L112 34 L110 120Z", "M116 120 L124 40 L142 42 L134 120Z", "M138 120 L156 52 L172 58 L154 120Z", "M80 120 L84 64 L100 64 L98 120Z"].map((d) => F(d, "var(--sun)")).join("")}
      ${F("M52 110 L188 110 L174 216 L66 216Z", "var(--flesh)")}${SH("M52 110 L188 110 L174 216 L66 216Z", "M150 100 L200 100 L200 230 L140 230Z", "var(--flesh-d)")}
      ${P("M60 132 L180 132 L178 146 L62 146Z", "#fff")}
      ${H("M74 160 C74 180 76 196 80 206", 7)}`,
  },
  "ice-cream": {
    name: "Ice cream (cone)",
    svg: () => `${F(CONE, "var(--sand)")}${CLIP(CONE, IL("M70 120 L150 220 M110 116 L170 190 M170 120 L90 220 M130 116 L74 186", "var(--mito-d)", 4))}
      ${F("M64 120 C52 96 66 70 92 68 C98 44 122 34 142 44 C164 50 178 72 172 94 C188 104 184 126 168 126 L72 126 C68 126 66 124 64 120Z", "var(--pink)")}
      ${SH("M64 120 C52 96 66 70 92 68 C98 44 122 34 142 44 C164 50 178 72 172 94 C188 104 184 126 168 126 L72 126 C68 126 66 124 64 120Z", "M60 108 C100 124 150 124 190 100 L190 140 L60 140Z", "var(--pink-d)")}
      ${C(118, 36, 9, "var(--flesh)")}
      ${H("M80 88 C86 74 98 64 112 60", 8)}`,
  },
  "roast-chicken": {
    name: "Roast chicken",
    svg: () => `${F("M168 112 C190 96 214 100 220 116 C226 130 214 142 198 138 C190 146 176 144 172 134Z", "var(--mito-d)")}
      ${C(220, 108, 9, "var(--enamel)")}${C(224, 128, 9, "var(--enamel)")}
      ${F(CHICKEN, "var(--mito)")}${SH(CHICKEN, "M40 160 C100 196 170 190 200 150 L210 220 L30 220Z", "var(--mito-d)")}
      ${E(120, 210, 96, 12, "var(--metal)")}
      ${IL("M70 150 C90 130 120 124 150 132", "var(--mito-d)", 6)}
      ${H("M70 122 C82 104 100 96 120 94", 9)}`,
  },
  teacup: {
    name: "Cup (tea / coffee)",
    svg: () => `${E(116, 206, 84, 14, "var(--enamel-d)")}
      ${IL("M170 116 C206 110 212 156 168 162", "var(--water)", 14)}
      ${F(CUP, "var(--water)")}${SH(CUP, "M140 90 L190 90 L190 216 L120 216Z", "var(--water-d)")}
      ${E(114, 98, 62, 12, "var(--clay)", true)}
      ${IL("M96 72 C88 60 104 52 96 38 M128 72 C120 60 136 52 128 38", "var(--smoke)", 6)}
      ${H("M76 118 C76 140 80 162 88 180", 8)}`,
  },
  lemon: {
    name: "Lemon",
    svg: () => `${F(LEMON, "var(--sun)")}${F("M22 124 L36 112 L36 136Z", "var(--sun)")}${F("M218 124 L204 112 L204 136Z", "var(--sun)")}
      ${SH(LEMON, "M30 140 C80 190 170 190 210 130 L220 200 L20 200Z", "var(--sun-d)")}
      ${F("M120 64 C130 40 156 34 176 42 C168 62 146 70 120 64Z", "var(--leaf)")}
      ${H("M62 106 C74 90 92 80 112 78", 9)}`,
  },
  apple: {
    name: "Apple",
    svg: () => `${IL("M120 78 C120 60 124 44 134 34", "var(--earth-d)", 8)}
      ${F("M128 62 C140 38 170 32 188 42 C180 64 154 72 128 62Z", "var(--leaf)")}
      ${F(APPLE, "var(--flesh)")}${SH(APPLE, "M150 70 C226 110 210 200 140 222 L230 230 L230 70Z", "var(--flesh-d)")}
      ${H("M62 112 C66 94 78 82 94 78", 9)}`,
  },
};
