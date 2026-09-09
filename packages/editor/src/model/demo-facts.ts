import type { LessonFacts } from "@tj/domain/documents";

/**
 * The `LessonFacts` for the seeded water cycle lesson (`demo-water-cycle`): what Plan would have
 * written for a Year 4 science hour. The recipe tests build from it, and the picker's miniatures
 * show it when the sheet's lesson has no facts of its own. Ids follow the worker's scheme
 * (`o1`, `v3`, `q2`, `m1`, `w1`) and the outline adds up to `durationMin`.
 */
export const DEMO_LESSON_FACTS: LessonFacts = {
  objectives: [
    { id: "o1", text: "Name the four stages of the water cycle in order." },
    { id: "o2", text: "Explain how heat from the sun drives evaporation and condensation." },
    { id: "o3", text: "Describe where the water in a river has been and where it goes next." },
  ],
  vocabulary: [
    { id: "v1", term: "evaporation", definition: "Liquid water turning into water vapour." },
    {
      id: "v2",
      term: "condensation",
      definition: "Water vapour cooling and turning back into liquid water droplets.",
    },
    {
      id: "v3",
      term: "precipitation",
      definition: "Water falling from clouds as rain, snow, sleet or hail.",
    },
    {
      id: "v4",
      term: "collection",
      definition: "Water gathering in rivers, lakes and oceans after it falls.",
    },
    { id: "v5", term: "water vapour", definition: "Water as a gas, which you cannot see." },
    {
      id: "v6",
      term: "transpiration",
      definition: "Plants giving off water vapour through their leaves.",
    },
  ],
  workedExamples: [
    {
      id: "w1",
      problem: "A puddle in the playground has gone by the afternoon. Where did the water go?",
      steps: [
        "The sun warmed the puddle.",
        "The warm water turned into water vapour, which is evaporation.",
        "The vapour rose into the air, where it is too small to see.",
      ],
      answer: "It evaporated into the air as water vapour.",
    },
    {
      id: "w2",
      problem: "Why are there drops of water on the outside of a cold can on a warm day?",
      steps: [
        "The air around the can holds water vapour.",
        "The can cools the air next to it.",
        "Cold air cannot hold as much vapour, so it condenses into drops on the can.",
      ],
      answer: "Water vapour in the air condensed on the cold surface.",
    },
  ],
  questions: [
    {
      id: "q1",
      stem: "What is the name for liquid water turning into a gas?",
      answer: "Evaporation.",
      reasoning: "Recall of the first stage; the term is in the vocabulary list.",
    },
    {
      id: "q2",
      stem: "Explain why clouds form high in the sky and not at ground level.",
      answer: "The air is colder higher up, so water vapour condenses into droplets there.",
      reasoning: "Links condensation to cooling; tests objective o2.",
    },
    {
      id: "q3",
      stem: "Give two forms of precipitation other than rain.",
      answer: "Any two of snow, sleet and hail.",
      reasoning: "Recall from the definition of precipitation.",
    },
    {
      id: "q4",
      stem: "Describe what happens to rainwater after it lands on a hillside.",
      answer:
        "It runs downhill into streams and rivers, collects in lakes or the sea, and evaporates again.",
      reasoning: "Collection and the return to evaporation; tests objective o3.",
    },
    {
      id: "q5",
      stem: "The sun disappears for a year. Explain what would happen to the water cycle.",
      answer:
        "Without heat there would be little evaporation, so fewer clouds and less precipitation; the cycle would slow almost to a stop.",
      reasoning: "Applies the role of the sun as the cycle's energy source.",
    },
  ],
  misconceptions: [
    { id: "m1", text: "Clouds are made of water vapour." },
    { id: "m2", text: "Water disappears when a puddle dries up." },
    { id: "m3", text: "Rain comes from the sea being pulled up into the sky." },
    { id: "m4", text: "The water cycle only happens when it is sunny." },
  ],
  outline: [
    { id: "s1", kind: "title", minutes: 2, factRefs: [] },
    { id: "s2", kind: "objectives", minutes: 3, factRefs: ["o1", "o2", "o3"] },
    { id: "s3", kind: "starter", minutes: 5, factRefs: ["m2", "w1"] },
    { id: "s4", kind: "vocabulary", minutes: 8, factRefs: ["v1", "v2", "v3", "v4", "v5", "v6"] },
    { id: "s5", kind: "content", minutes: 10, factRefs: ["o1", "v1", "v2", "v3", "v4"] },
    { id: "s6", kind: "worked-example", minutes: 8, factRefs: ["w1", "w2", "o2"] },
    { id: "s7", kind: "true-false", minutes: 6, factRefs: ["m1", "m2", "m3", "m4"] },
    { id: "s8", kind: "fill-gap", minutes: 6, factRefs: ["v1", "v2", "v3", "v4"] },
    { id: "s9", kind: "open-response", minutes: 7, factRefs: ["q2", "q4", "o3"] },
    { id: "s10", kind: "exit-ticket", minutes: 5, factRefs: ["q1", "q3", "q5"] },
  ],
  durationMin: 60,
};

/**
 * A small facts set for the seeded "Fractions of amounts" lesson (`demo-fractions`): enough that
 * Kind and the Add block sections show real fractions on the dev seed. One worked example and
 * two misconceptions, so the suggestion rule picks Misconception check here too.
 */
export const DEMO_FRACTIONS_FACTS: LessonFacts = {
  objectives: [
    { id: "o1", text: "Find a unit fraction of an amount by dividing by the denominator." },
    { id: "o2", text: "Find a non-unit fraction of an amount: divide, then multiply." },
    { id: "o3", text: "Check an answer by putting the parts back together." },
  ],
  vocabulary: [
    { id: "v1", term: "numerator", definition: "The top number: how many parts we take." },
    { id: "v2", term: "denominator", definition: "The bottom number: how many equal parts." },
    { id: "v3", term: "unit fraction", definition: "A fraction with a numerator of one." },
    { id: "v4", term: "whole", definition: "The full amount before any of it is taken." },
  ],
  workedExamples: [
    {
      id: "w1",
      problem: "Find 3/4 of 20.",
      steps: [
        "Divide 20 by the denominator, 4, to get one quarter: 5.",
        "Multiply one quarter by the numerator, 3: 15.",
      ],
      answer: "15",
    },
  ],
  questions: [
    { id: "q1", stem: "What is 1/5 of 30?", answer: "6", reasoning: "Unit fraction: 30 ÷ 5." },
    {
      id: "q2",
      stem: "What is 2/3 of 24?",
      answer: "16",
      reasoning: "24 ÷ 3 = 8, then 8 × 2.",
    },
    {
      id: "q3",
      stem: "Sam says 3/8 of 40 is 5. Is Sam right? Explain.",
      answer: "No. 40 ÷ 8 = 5 is one eighth; three eighths is 15.",
      reasoning: "Targets the divide-only misconception.",
    },
    {
      id: "q4",
      stem: "A bag holds 36 sweets. Priya eats 5/6 of them. How many are left?",
      answer: "6",
      reasoning: "36 ÷ 6 = 6, 6 × 5 = 30 eaten, 36 − 30 = 6 left.",
    },
  ],
  misconceptions: [
    { id: "m1", text: "To find a fraction of an amount you only divide by the bottom number." },
    { id: "m2", text: "A bigger denominator means a bigger share." },
  ],
  outline: [
    { id: "s1", kind: "title", minutes: 2, factRefs: [] },
    { id: "s2", kind: "objectives", minutes: 3, factRefs: ["o1", "o2", "o3"] },
    { id: "s3", kind: "vocabulary", minutes: 5, factRefs: ["v1", "v2", "v3", "v4"] },
    { id: "s4", kind: "worked-example", minutes: 10, factRefs: ["w1", "o2"] },
    { id: "s5", kind: "true-false", minutes: 5, factRefs: ["m1", "m2"] },
    { id: "s6", kind: "open-response", minutes: 10, factRefs: ["q1", "q2", "q3", "q4"] },
    { id: "s7", kind: "exit-ticket", minutes: 5, factRefs: ["q3", "q4"] },
  ],
  durationMin: 40,
};
