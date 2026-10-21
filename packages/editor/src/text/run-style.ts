import { Extension } from "@tiptap/core";
import { safeHighlightSlot, safeRunFont, safeStrikeStep } from "@tj/domain/documents";

/**
 * The run attributes `textStyle` carries beyond `color` (TEACH-205 part c; `@tj/domain`
 * `rich-text.ts`): `font` (the theme's quote face), `highlight` (a colour slot's wash) and
 * `strikeStep` (the myth strike, from that reveal step). Each is written as a data attribute only,
 * never a style, so `serialize.ts` can match it byte for byte and `slide.css` owns the look.
 */
export const RunStyle = Extension.create({
  name: "runStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          font: {
            default: null,
            parseHTML: (el) => safeRunFont(el.getAttribute("data-font")),
            renderHTML: (attrs) => {
              const font = safeRunFont(attrs.font);
              return font ? { "data-font": font } : {};
            },
          },
          highlight: {
            default: null,
            parseHTML: (el) => safeHighlightSlot(Number(el.getAttribute("data-hl"))),
            renderHTML: (attrs) => {
              const slot = safeHighlightSlot(attrs.highlight);
              return slot === null ? {} : { "data-hl": String(slot) };
            },
          },
          strikeStep: {
            default: null,
            parseHTML: (el) =>
              el.hasAttribute("data-strike")
                ? safeStrikeStep(Number(el.getAttribute("data-strike")))
                : null,
            renderHTML: (attrs) => {
              const step = safeStrikeStep(attrs.strikeStep);
              return step === null ? {} : { "data-strike": String(step) };
            },
          },
        },
      },
    ];
  },
});
