import type { PaletteFormId } from "../palette";
import { VOCABULARY_ENTRIES } from "../palette";
import type { SlideSpec } from "../specs";

/*
 * The palette drift test's fills (`palette.test.ts`): each slide form with every unit at the top
 * of its range, in realistic, long-ish classroom text from the fit-lab briefs (Weimar 1923,
 * electrolysis, plants, ratio).
 */
/** Each slide form at its maximum: every unit the form holds, at the top of its range. */
export const PALETTE_MAX: Partial<Record<PaletteFormId, SlideSpec>> = {
  explain: {
    kind: "content",
    factRefs: [],
    heading: "Hyperinflation wiped out the savings of the middle classes",
    body: "By November 1923 a loaf of bread cost 200 billion marks, and prices doubled every few days. Families who had saved for years found their money would not buy a stamp.",
  },
  "explain-callout": {
    kind: "content",
    factRefs: [],
    heading: "Hyperinflation wiped out the savings of the middle classes",
    body: "By November 1923 prices doubled every few days, so a lifetime of savings could not buy a loaf of bread.",
    callout: {
      kind: "watch-out",
      text: "Hyperinflation did not hurt everyone. People with large debts, including many landowners and industrialists, paid them off with worthless marks.",
    },
  },
  list: {
    kind: "content",
    factRefs: [],
    heading: "Two factors change the rate of electrolysis",
    body: "The products form faster or slower depending on the conditions in the cell.",
    points: [
      "Current: a larger current discharges more ions every second.",
      "Concentration: a stronger solution puts more ions near each electrode.",
    ],
  },
  compare: {
    kind: "content",
    factRefs: [],
    heading: "Weather is not the same as climate",
    body: "Both describe the air around us, but over very different lengths of time.",
    compare: {
      left: {
        label: "Weather",
        points: ["Conditions today or this week", "Can change from day to day"],
      },
      right: {
        label: "Climate",
        points: ["The usual pattern over 30 years", "Changes slowly, over decades"],
      },
    },
  },
  sequence: {
    kind: "content",
    factRefs: [],
    heading: "Water moves round the Earth in a cycle",
    body: "The same water is used again and again as it changes state.",
    steps: [
      "The sun heats water in seas and lakes until it evaporates.",
      "The vapour rises, cools and condenses into tiny droplets in clouds.",
      "The droplets join, grow heavy and fall back to the ground as rain.",
    ],
  },
  photo: {
    kind: "content",
    factRefs: [],
    heading: "Root hairs take in water from the soil",
    body: "Look at the fine hairs growing along each root. They give the root a huge surface for soaking up water and minerals.",
  },
  figure: {
    kind: "diagram",
    factRefs: [],
    heading: "Find the length of the missing side",
    body: "The two shorter sides meet at the right angle. Use Pythagoras' theorem to find the hypotenuse x.",
    figure: {
      template: "right-triangle",
      values: {
        base: { length: 6, label: "6 cm" },
        height: { length: 8, label: "8 cm" },
        hypotenuse: { label: "x" },
      },
    },
  },
  "diagram-slot": {
    kind: "content",
    factRefs: [],
    heading: "A flower has male and female parts",
    body: "The stamen makes pollen grains in its anther. The carpel holds the ovules that become seeds after fertilisation.",
    diagram:
      "A flower cut in half, labelled petal, sepal, stamen, anther, filament, carpel, stigma, style and ovary.",
  },
  "worked-example": {
    kind: "worked-example",
    factRefs: [],
    heading: "Sharing an amount in a given ratio",
    question: "Share £45 between Amy and Ben in the ratio 2 : 3.",
    steps: [
      "Add the parts: 2 + 3 = 5 parts",
      "Find one part: £45 ÷ 5 = £9",
      "Amy gets 2 × £9 = £18, Ben gets 3 × £9 = £27",
    ],
  },
  hinge: {
    kind: "multiple-choice",
    factRefs: [],
    stem: "Why did prices in Germany rise so quickly during 1923?",
    options: [
      { text: "The government printed money to pay its debts", correct: true },
      { text: "Factories stopped making goods to sell", correct: false },
      { text: "The Allies set the price of bread", correct: false },
      { text: "People refused to use paper money", correct: false },
    ],
    explanation:
      "Printing more money meant each mark bought less, so prices rose to match the extra money in circulation.",
  },
  "true-false": {
    kind: "true-false",
    factRefs: [],
    statement: "In electrolysis, the current is carried through the solution by electrons.",
    correct: false,
    explanation:
      "Electrons flow in the wires, but in the solution the current is carried by ions moving to the electrodes.",
  },
  matching: {
    kind: "matching",
    factRefs: [],
    stem: "Match each electrode word to its meaning.",
    pairs: [
      { left: "Anode", right: "The positive electrode" },
      { left: "Cathode", right: "The negative electrode" },
      { left: "Electrolyte", right: "A liquid that conducts electricity" },
    ],
  },
  "fill-gap": {
    kind: "fill-gap",
    factRefs: [],
    stem: "Complete the sentence with the correct words.",
    sentence: "Positive ions move to the ___, where they gain electrons and are ___.",
    answers: ["cathode", "discharged"],
  },
  sort: {
    kind: "sort",
    factRefs: [],
    stem: "Put the events of 1923 in the order they happened.",
    steps: ["Ruhr occupied", "General strike", "Money printed", "Rentenmark issued"],
  },
  "open-response": {
    kind: "open-response",
    factRefs: [],
    stem: "Explain why a plant kept in a dark cupboard for two weeks will die.",
    modelAnswer:
      "Without light the plant cannot photosynthesise, so it cannot make glucose. It uses up its stored food and then has no energy for its cells.",
  },
  discussion: {
    kind: "discussion",
    factRefs: [],
    prompt: "Was the Treaty of Versailles the main reason for the crisis of 1923?",
    footnote: "I think the main reason was… because… / Another reason was…",
  },
  vocabulary: {
    kind: "vocabulary",
    factRefs: [],
    entries: [
      { term: "electrolysis", definition: "Splitting a compound using an electric current." },
      { term: "electrolyte", definition: "A molten or dissolved ionic compound that conducts." },
      { term: "anode", definition: "The positive electrode, where negative ions are discharged." },
      {
        term: "cathode",
        definition: "The negative electrode, where positive ions are discharged.",
      },
      { term: "ion", definition: "An atom or group of atoms with an electric charge." },
      { term: "discharge", definition: "When an ion gains or loses electrons at an electrode." },
    ].slice(0, VOCABULARY_ENTRIES),
  },
};
