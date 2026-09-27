import { describe, expect, test } from "bun:test";
import packs from "../fixtures/lab-pack-sections.json";
import { matchPackSections } from "./pack-map";

/*
 * Lab l6kp2 E53: the pack-section match on real objectives (E51 and E52, both arms) against the
 * packs they ran with. Demand sec 2 is total revenue and indirect tax: only an objective about
 * revenue or tax may map to it.
 */

const map = (sections: { outcome: string; text: string }[], objectives: string[]) =>
  matchPackSections(
    objectives.map((text) => ({ text })),
    sections,
  ).map((m) => m.section);

describe("matchPackSections on the E51/E52 objectives", () => {
  test("demand: no objective maps to the revenue-and-tax section unless it is about revenue or tax", () => {
    expect(
      map(packs["y12-demand"], [
        "Explain what price elasticity of demand values show about how responsive quantity demanded is to price changes",
        "Explain how the percentage-change method calculates price elasticity of demand",
        "Explain how substitutes, budget share and time affect price elasticity of demand",
      ]),
    ).toEqual([1, 0, 1]);
    expect(
      map(packs["y12-demand"], [
        "Explain how percentage changes in price and quantity demanded determine PED and its interpretation",
        "Explain how availability of substitutes, proportion of income spent and time affect PED",
        "Explain how PED predicts the effect of a price change on total revenue",
        "Explain how price elasticity of demand informs government indirect tax decisions.",
      ]),
    ).toEqual([0, 1, 2, 2]);
  });

  test("tempest: an objective the pack does not cover maps to nothing", () => {
    expect(
      map(packs["y10-tempest"], [
        "Explain how threats and promises maintain Prospero’s control over Ariel and Caliban.",
        "Explain how Prospero’s account of Milan’s history supports his claim to authority.",
        "Explain how dependence and social rank shape Prospero’s relationships with others",
        "Explain how Shakespeare uses language and stagecraft to present Prospero’s power",
      ]),
    ).toEqual([0, null, null, 1]);
  });

  test("two objectives may share a section and scores are 0..1", () => {
    const m = matchPackSections(
      [
        { text: "Explain how PED affects total revenue" },
        { text: "Explain how PED informs indirect tax" },
      ],
      packs["y12-demand"],
    );
    expect(m.map((x) => x.section)).toEqual([2, 2]);
    for (const x of m) for (const s of x.scores) expect(s >= 0 && s <= 1).toBe(true);
  });
});
