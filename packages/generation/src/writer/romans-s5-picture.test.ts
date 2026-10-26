import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { materialise } from "./materialise";

/*
 * TEACH-247 part ao: Romans Y4 verify5 s5, as the writer wrote it (genlab 20261026-104025): a
 * lead, two points and a key card beside a real photo of a gateway. A key card never sits beside
 * points, so the slide was flagged over, keepPic could not put the photo back, and it shipped
 * text-only. The card now folds into a point beside the photo, every word kept.
 */
const S5 = {
  template: "visual-text",
  heading: "Why build a guarded wall?",
  icon: "roman shield",
  lead: "The Romans wanted to defend their frontier and control movement.",
  points: [
    "The wall made raids into Roman Britain harder for groups living north of it.",
    "Gates let Roman soldiers check travellers and goods crossing the frontier.",
  ],
  cards: [
    {
      num: null,
      kind: "word",
      term: "Frontier",
      unit: null,
      label: "Meaning",
      meaning: "The edge of land an empire controls.",
      examples: null,
    },
  ],
  figure: {
    shows: "Reconstruction of a guarded gateway through Hadrian’s Wall",
    subject: "generic",
    must_see: ["Continuous stone barrier", "Narrow gateway opening"],
  },
};
const ctx = (theme: string, aspect: number) =>
  ({
    brief: { id: "t", topic: "Romans", subject: "history", yearGroup: "Year 4", year: 4 },
    theme: getTheme(theme),
    stage: "ks2",
    index: 4,
    plan: { flow: [{ slide: 5 }], slides: [] },
    visual: () => ({
      status: "photo",
      photo: { src: "/files/gateway.jpg", alt: "A gateway", aspect, request: "" },
    }),
  }) as never;

describe("Romans s5: a placed photo is kept over the key card's look (TEACH-247 part ao)", () => {
  for (const theme of ["treehouse", "crayon", "splash", "paper"])
    test(`${theme}: the photo, every word, nothing over`, () => {
      for (const aspect of [4 / 3, 3 / 2]) {
        const m = materialise(S5, ctx(theme, aspect));
        expect(m.over).toEqual([]);
        const json = JSON.stringify(m.slide.elements);
        expect(json).toContain("/files/gateway.jpg");
        for (const w of [
          "defend their frontier",
          "groups living north of it",
          "goods crossing the frontier",
          "Frontier: the edge of land an empire controls.",
        ])
          expect(json).toContain(w);
      }
    });
});
