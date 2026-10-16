import type { Stage, TemplateInput } from "./index";
import type { MythInput } from "./myth";

/**
 * The myth-c gold's cases (`northstars-v12/myth-c/content.json`), word for word, at their year
 * group's key stage, plus the shots the gold rendered (the reveal step each shows).
 */
export type MythCase = { name: string; stage: Stage; steps: number[]; input: TemplateInput };

const at = (
  name: string,
  stage: Stage,
  steps: number[],
  heading: string,
  myth: MythInput,
): MythCase => ({ name, stage, steps, input: { template: "myth", heading, myth } });

const falling: MythInput = {
  claim: "Heavier objects fall faster.",
  fact: "Without air resistance, all objects fall at the same rate.",
  factEm: "the same rate.",
  proof: {
    icons: ["hammer", "bird-feather"],
    line: "On the Moon, a hammer and a feather **land together.**",
  },
};

export const MYTH_CASES: MythCase[] = [
  at("y6-falling", "ks2", [0, 1, 2], "How things fall", {
    ...falling,
    verdict: "myth",
    opening: "vote",
  }),
  at("y6-falling-straight", "ks2", [0, 1], "How things fall", { ...falling, opening: "straight" }),
  at("y8-plants", "ks3", [2], "Where a plant’s food comes from", {
    verdict: "myth",
    opening: "vote",
    claim: "Plants get their food from the soil.",
    fact: "Plants make their own food from carbon dioxide and water, using light.",
    factEm: "make their own food",
    proof: { line: "Van Helmont’s willow gained 74 kg. **The soil lost only 57 g.**" },
  }),
  at("y7-vikings", "ks3", [2], "Viking helmets", {
    verdict: "myth",
    opening: "vote",
    claim: "Vikings wore helmets with horns.",
    fact: "Viking helmets were plain and rounded. The horns came from 1800s paintings and operas.",
    factEm: "plain and rounded.",
    proof: { line: "The only near-complete Viking helmet ever found **has no horns.**" },
  }),
  at("y7-deserts", "ks3", [2], "What makes a desert", {
    verdict: "myth",
    opening: "vote",
    claim: "Every desert is hot and sandy.",
    fact: "A desert is any place with very little rain or snow, even icy Antarctica.",
    factEm: "very little rain or snow,",
    proof: {
      picture: {
        photo: "https://images.test/myth.jpg",
        alt: "Antarctic plateau: flat ice and bare rock under a clear sky",
      },
      line: "Antarctica is **the largest desert on Earth.**",
    },
  }),
  at("y7-deserts-nopic", "ks3", [2], "What makes a desert", {
    verdict: "myth",
    opening: "vote",
    claim: "Every desert is hot and sandy.",
    fact: "A desert is any place with very little rain or snow, even icy Antarctica.",
    factEm: "very little rain or snow,",
    proof: { picture: null, line: "Antarctica is **the largest desert on Earth.**" },
  }),
  at("y5-honey-true", "ks2", [0, 1, 2], "How honey is made", {
    verdict: "true",
    opening: "vote",
    claim: "A teaspoon of honey is the life’s work of about 12 bees.",
    fact: "A worker bee lives only about six weeks in summer, and spends it gathering nectar.",
    factEm: "six weeks",
    proof: { icons: ["bee"], line: "Its whole life’s work: **about one twelfth of a teaspoon.**" },
  }),
  at("y6-caps", "ks2", [0, 2], "Seeing Earth from space", {
    verdict: "myth",
    opening: "vote",
    claim: "You can see the Great Wall of China from space.",
    fact: "The wall is far too narrow to spot from orbit by eye, though big city lights are easy.",
    factEm: "far too narrow",
    proof: {
      line: "China’s first astronaut looked for it in 2003. **He could not see it.**",
    },
  }),
  // Early (no gold render; NOTES "age: from the year group"): the falling slide at KS1.
  at("y2-falling", "ks1", [0, 1, 2], "How things fall", {
    verdict: "myth",
    opening: "vote",
    claim: "Heavy things fall faster.",
    fact: "Without air, all things fall at the same speed.",
    factEm: "the same speed.",
    proof: {
      icons: ["hammer", "bird-feather"],
      line: "On the Moon, a hammer and a feather **land together.**",
    },
  }),
];
