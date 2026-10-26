import { describe, expect, test } from "bun:test";
import { textFaults } from "./lint";
import { layoutTemplate, type Stage, type TemplateInput } from "./templates/index";
import { atKeyStage, getTheme, THEMES } from "./themes";

/*
 * TEACH-247 part ap: Great Fire Y2 verify6 (genlab 20261026-114322). The job laid s10 and s12 in
 * Splash and the teacher's Crayon Box drew them: a sort card broke "Firebreak/s" and question 1's
 * second line ran into question 2. Laid in the theme they are drawn in, neither happens, and
 * `textFaults` catches both when the faces differ.
 */
const S12: TemplateInput = {
  template: "question-set",
  heading: "Remember the facts",
  questions: [
    "In which year did the fire begin?",
    "Which river supplied water for the leather buckets?",
    "What happened to the wind by Wednesday 5 September?",
  ],
  answers: ["1666", "River Thames", "It dropped"],
  quick: true,
} as TemplateInput;
const S10: TemplateInput = {
  template: "sequence",
  heading: "Put events in order",
  lead: "Put these events in order from the first to last.",
  cards: ["Firebreaks made", "Fire slows", "Fire spreads", "Bakery burns"].map((text) => ({
    text,
  })),
} as TemplateInput;
const STAGES: Stage[] = ["ks1", "ks2"];

describe("text faults: words on words and words broken inside (TEACH-247 part ap)", () => {
  test("s10 and s12 laid in each theme have none, in every theme at KS1 and KS2", () => {
    const faults: string[] = [];
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const input of [S10, S12]) {
          const r = layoutTemplate(input, theme, stage);
          const f = textFaults(r.slide as never, atKeyStage(theme, stage));
          if (f.length) faults.push(`${theme.id} ${stage} ${input.template}: ${f.join("; ")}`);
          if (r.over.length) faults.push(`${theme.id} ${stage} ${input.template}: over ${r.over}`);
        }
    expect(faults).toEqual([]);
  });
  test("laid in Splash and drawn in Crayon Box, both faults are caught", () => {
    const crayon = atKeyStage(getTheme("crayon"), "ks1");
    const q = layoutTemplate(S12, getTheme("splash"), "ks1").slide;
    expect(textFaults(q as never, crayon).some((f) => f.startsWith("text-runs-into:"))).toBe(true);
    const s = layoutTemplate(
      { ...S10, cards: S10.cards?.map((c, i) => (i === 0 ? { ...c, figure: undefined } : c)) },
      getTheme("splash"),
      "ks1",
    ).slide;
    const words = textFaults(s as never, crayon);
    expect(words.some((f) => f.includes('"Firebreaks"'))).toBe(true);
  });
});
