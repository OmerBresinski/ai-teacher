import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { getTheme, THEMES } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { checkSlide, GROUND_OPACITY } from "./checks";
import { LAYOUT_FAULT, layoutGate } from "./layout-gate";
import { materialise, type Plan } from "./materialise";

/*
 * TEACH-247 part cb (replay v5 Plants, slide 3): the hook's words sit on its scrim over the
 * full-bleed photo by design (ruling 203), but the overlap check read them as words over the
 * picture, so the layout gate dropped the photo and the hook shipped as a bare prompt. Words on a
 * ground drawn between them and the picture are on that ground; words straight on a picture, or
 * on a faint tint, still fault. The hook keeps its photo in every theme, stage and photo shape.
 */
type S = Record<string, unknown>;
const plants: S = {
  template: "hook",
  heading: "Plants in a Garden",
  lead: "What do plants need to grow?",
  picture: { shows: "plant growing in a garden", must_see: ["plant"], subject: "generic" },
};
const STAGES = ["ks1", "ks2"] as const;
const ASPECTS = [16 / 9, 4 / 3, 1, 3 / 4, 3];

const lay = (theme: string, stage: string, aspect: number) =>
  materialise(plants, {
    brief: { ...sampleBriefLesson().brief, keyStage: stage.toUpperCase() } as never,
    theme: getTheme(theme, stage as never),
    stage: stage as never,
    index: 2,
    plan: { slides: [] } as unknown as Plan,
    visual: () => ({
      status: "photo",
      photo: { src: "https://x.test/garden.jpg", alt: "a plant in a garden", aspect },
    }),
  });
const layoutFaults = (elements: SlideElement[]) =>
  checkSlide({
    index: 2,
    slide: { elements },
    over: [],
    questions: [],
    answers: undefined,
    notesChecked: true,
    words: "",
  }).faults.filter((f) => LAYOUT_FAULT.test(f));

describe("the hook keeps its photo through the layout gate (TEACH-247 part cb)", () => {
  for (const t of THEMES)
    for (const stage of STAGES)
      test(`${t.id} ${stage}: no layout fault at any photo shape, the photo kept`, () => {
        for (const aspect of ASPECTS) {
          const m = lay(t.id, stage, aspect);
          expect(m.slide.elements.some((e) => e.name === "Hook photo")).toBe(true);
          const gate = layoutGate({
            faults: () => layoutFaults(m.slide.elements),
            split: () => false,
            undoSplit: () => {},
          });
          expect({ aspect, ...gate }).toEqual({ aspect, outcome: "clean", faults: [] });
        }
      });

  test("words straight on the photo, or on a faint tint, are still an overlap", () => {
    const els = lay(THEMES[0]?.id ?? "", "ks2", 16 / 9).slide.elements;
    const bare = els.filter((e) => e.name !== "Scrim");
    expect(layoutFaults(bare)).toContain('overlap: "Plants in a Garden" over a picture');
    const faint = els.map((e) =>
      e.name === "Scrim" ? ({ ...e, opacity: GROUND_OPACITY / 3 } as SlideElement) : e,
    );
    expect(layoutFaults(faint)).toContain('overlap: "What do plants need to grow?" over a picture');
    // A ground drawn under the photo (in front of nothing) does not count.
    const under = [
      ...els.filter((e) => e.name === "Scrim"),
      ...els.filter((e) => e.name !== "Scrim"),
    ];
    expect(layoutFaults(under).some((f) => f.endsWith("over a picture"))).toBe(true);
  });
});
