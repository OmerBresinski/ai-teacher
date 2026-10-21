// TEACH-310 part c: discussion fallback (pilot set-v13-discussion.js).
// v13 discussion (15 Oct): fallback icon for a picture discussion whose AI picture fails.
// 240 viewBox, token colours only (#fff allowed), one shade + one gloss per silhouette, kit.js helpers. One object, no setting.
import { C, E, F, H, L, P, SH } from "./kit";
import type { IconDrawing } from "./types";

const BODY =
  "M58 146 C58 108 88 92 122 96 C128 74 146 58 166 60 C186 62 196 80 192 98 C189 112 180 120 178 132 C196 138 206 156 202 176 C196 204 164 216 126 214 C88 212 58 190 58 146Z";
const TAIL = "M66 150 C40 132 30 100 40 66 C58 82 70 88 92 96 C80 110 72 128 66 150Z";
const WING =
  "M96 150 C104 128 128 120 152 128 C166 134 168 152 156 166 C140 182 110 182 98 170 C94 164 94 156 96 150Z";

export const DISCUSSION: Record<string, IconDrawing> = {
  hen: {
    name: "Hen (farm chicken)",
    svg: () => `${L("M112 210 L108 232 M100 232 L118 232 M144 210 L146 232 M136 232 L156 232", "var(--gold-d)", 7)}
      ${F(TAIL, "var(--earth-d)")}
      ${F(BODY, "var(--clay)")}${SH(BODY, "M150 120 C220 140 220 230 120 236 L240 236 L240 120Z", "var(--clay-d)")}
      ${P(WING, "var(--earth)", 'opacity=".9"')}
      ${C(160, 58, 9, "var(--flesh)", false)}${C(172, 54, 10, "var(--flesh)", false)}${C(184, 60, 8, "var(--flesh)", false)}
      ${E(186, 112, 7, 10, "var(--flesh)", false)}
      ${P("M190 84 L214 92 L190 100Z", "var(--gold)")}
      ${C(174, 82, 5.5, "var(--eye)", false)}
      ${H("M76 140 C80 120 94 108 112 104", 8)}`,
  },
};
