import type { Stage, TemplateInput } from "./index";

/** The v12 gold's cases (NOTES worked: Y8, Y8 with its panel, Y6 percent, the 6-row stress, KS4 moles). */
export const WORKED_CASES: Record<string, { input: TemplateInput; stage: Stage }> = {
  y8: {
    stage: "ks3",
    input: {
      template: "worked",
      heading: "Solve 3x + 5 = 20",
      lines: [
        { eq: "3x + 5 = 20" },
        { move: "Subtract 5 from both sides", eq: "3x = 15" },
        { move: "Divide both sides by 3", eq: "x = 5", answer: true },
      ],
      check: "3 × *5* + 5 = 20",
    },
  },
  "y8-panel": {
    stage: "ks3",
    input: {
      template: "worked",
      heading: "Solve 3x + 5 = 20",
      lines: [
        { eq: "3x + 5 = 20" },
        { move: "Subtract 5 from both sides", eq: "3x = 15" },
        { move: "Divide both sides by 3", eq: "x = 5", answer: true },
      ],
      check: "3 × *5* + 5 = 20",
      barPanel: { model: "algebra-bar", a: 3, b: 5, c: 20 },
    },
  },
  "y6-panel": {
    stage: "ks2",
    input: {
      template: "worked",
      heading: "Find 35% of 80",
      vars: [],
      lines: [
        { eq: "10% of 80 = 8" },
        { move: "Multiply by 3", eq: "30% of 80 = 24" },
        { move: "Halve the 10%", eq: "5% of 80 = 4" },
        { move: "Add 24 and 4", eq: "35% of 80 = 28", answer: true },
      ],
      barPanel: { model: "percent-bar", amount: 80, percent: 35 },
    },
  },
  stress: {
    stage: "ks3",
    input: {
      template: "worked",
      heading: "Solve 4(x - 3) = 2x + 6",
      lines: [
        { eq: "4(x - 3) = 2x + 6" },
        { move: "Expand the bracket", eq: "4x - 12 = 2x + 6" },
        { move: "Subtract 2x from both sides", eq: "2x - 12 = 6" },
        { move: "Add 12 to both sides", eq: "2x = 18" },
        { move: "Divide both sides by 2", eq: "x = 9", answer: true },
      ],
      check: "4(*9* - 3) = 24 = 2 × *9* + 6",
    },
  },
  moles: {
    stage: "ks4",
    input: {
      template: "worked",
      heading: "How many moles are in 22 g of CO₂?",
      vars: ["n", "m"],
      lines: [
        { eq: "n = m ÷ M_r" },
        { move: "Work out M_r of CO₂", eq: "M_r = 12 + 2 × 16 = 44" },
        { move: "Put in the numbers", eq: "n = 22 ÷ 44" },
        { move: "Divide", eq: "n = 0.5 mol", answer: true },
      ],
      check: "*0.5* × 44 = 22 g",
    },
  },
};
