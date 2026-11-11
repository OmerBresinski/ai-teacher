/*
 * STUB CONTENT, hand-written (T7, 11 Nov 2026): one valid model answer per fixture lesson
 * (`@tj/slides/worksheet/fixtures`), for tests and the sample renders. Not model output: no paid
 * call has been made with the T7 prompts yet. Slide numbers are the fixtures' taught slides.
 */

import type { ExamOutput, PracticeOutput } from "../worksheet/sheet-items";

/** Year 2 maths, halves and quarters; 10 minutes → 6 items (2 warm-up, 3 core, 1 challenge; core floor 3). */
export const STUB_PRACTICE_HALVES: PracticeOutput = {
  warmUp: [
    {
      slides: [3],
      builds: "new-context",
      question: "Draw a circle. Split it into two equal parts and colour one half.",
      working: null,
      answer: "A circle in two equal parts, one part coloured",
    },
    {
      slides: [6],
      builds: "same-skill-new-numbers",
      question: "Share 6 counters equally into two groups. How many are in each group?",
      working: null,
      answer: "3 counters",
    },
  ],
  core: [
    {
      slides: [8],
      builds: "same-skill-new-numbers",
      question: "Share 24 counters equally into four groups. Write how many are in one group.",
      working: null,
      answer: "6 counters",
    },
    {
      slides: [4],
      builds: "new-context",
      question: "Draw a square. Split it into four equal parts and shade one quarter.",
      working: null,
      answer: "A square in four equal parts, one part shaded",
    },
    {
      slides: [6],
      builds: "same-skill-new-numbers",
      question: "Share 16 shells equally into two groups. Write how many are in each group.",
      working: null,
      answer: "8 shells",
    },
  ],
  challenge: {
    slides: [6, 10],
    builds: "combine",
    question: "A baker has 12 buns. Half go in one box. Write how many buns are in the box.",
    working: null,
    answer: "6 buns",
  },
};

/** Year 4 history, Hadrian's Wall; 15 minutes → 8 items (2 warm-up, 5 core, 1 challenge). */
export const STUB_PRACTICE_ROMANS: PracticeOutput = {
  warmUp: [
    {
      slides: [3],
      builds: "same-skill-new-numbers",
      question: "Which emperor ordered a wall to be built across northern Britain?",
      working: null,
      answer: "Emperor Hadrian",
    },
    {
      slides: [4],
      builds: "new-context",
      question: "The wall ran from one coast to another. Which two coasts did it join?",
      working: null,
      answer: "The west coast and the east coast",
    },
  ],
  core: [
    {
      slides: [5],
      builds: "explain",
      question: "What is a frontier?",
      working: null,
      answer: "A boundary: the wall marked the frontier of Roman Britain.",
    },
    {
      slides: [6],
      builds: "new-context",
      question:
        "A farmer wants to take sheep across the wall to sell them. Where would the farmer have to cross, and what might happen there?",
      working: null,
      answer: "At a guarded gate, where soldiers could check the farmer and the sheep.",
    },
    {
      slides: [5],
      builds: "explain",
      question: "Give two ways the wall helped the soldiers who guarded it.",
      working: null,
      answer: "It made crossings harder. It helped soldiers watch for attacks.",
    },
    {
      slides: [8, 9],
      builds: "combine",
      question: "Name the three kinds of structure soldiers used along the wall.",
      working: null,
      answer: "Forts, milecastles and gates",
    },
    {
      slides: [3],
      builds: "same-skill-new-numbers",
      question: "In which year did Hadrian order the wall to be built?",
      working: null,
      answer: "AD 122",
    },
  ],
  challenge: {
    slides: [5, 6, 9],
    builds: "explain",
    question:
      "Why was it better for the Romans to make people cross only at gates than to let everyone cross freely? Use what you know about the gates and the soldiers.",
    working: null,
    answer:
      "Soldiers at the gates could check people and goods before they crossed. If everyone crossed freely, nobody could be checked, and attacks would be harder to watch for.",
  },
};

/** Year 9 geography, meanders; 15 minutes → 8 items (2 warm-up, 5 core, 1 challenge). */
export const STUB_PRACTICE_RIVERS: PracticeOutput = {
  warmUp: [
    {
      slides: [3],
      builds: "new-context",
      question:
        "Name the erosion process in which the force of moving water attacks a river's banks.",
      working: null,
      answer: "Hydraulic action",
    },
    {
      slides: [4],
      builds: "new-context",
      question: "On which bank of a river bend does the water flow faster?",
      working: null,
      answer: "The outer bank",
    },
  ],
  core: [
    {
      slides: [4],
      builds: "explain",
      question: "Explain how a river cliff forms on a bend.",
      working: null,
      answer:
        "Water flows faster near the outer bank. The faster water erodes the outer bank, which creates a steep river cliff.",
    },
    {
      slides: [3],
      builds: "new-context",
      question:
        "A geographer finds pebbles on a riverbed that are smooth and round. Which erosion process made them that way?",
      working: null,
      answer: "Attrition",
    },
    {
      slides: [5, 7],
      builds: "combine",
      question: "Put these stages in order: cut-off, migration, isolation, neck narrows.",
      working: null,
      answer: "Migration, neck narrows, cut-off, isolation",
    },
    {
      slides: [4],
      builds: "explain",
      question: "Describe what happens on the inner bank of a meander, and why.",
      working: null,
      answer: "Sediment is deposited, because the water flows more slowly there.",
    },
    {
      slides: [3],
      builds: "new-context",
      question: "Chalk on a riverbed slowly dissolves in the water. Which erosion process is this?",
      working: null,
      answer: "Solution",
    },
  ],
  challenge: {
    slides: [4, 5, 7],
    builds: "combine",
    question:
      "Explain why erosion on the outer banks and deposition on the inner banks together lead to an oxbow lake.",
    working: null,
    answer:
      "Erosion on the outer banks makes the bend grow and the neck narrow until the water cuts through it. Deposition then seals the old bend off from the channel, leaving it isolated as an oxbow lake.",
  },
};

/** Year 11 chemistry, rates; 15 minutes → 8 items. */
export const STUB_PRACTICE_RATES: PracticeOutput = {
  warmUp: [
    {
      slides: [3],
      builds: "new-context",
      question: "State the equipment used to collect and measure the volume of hydrogen.",
      working: null,
      answer: "A gas syringe",
    },
    {
      slides: [4],
      builds: "same-skill-new-numbers",
      question: "Calculate the mean rate when 40 cm³ of gas forms in 20 s.",
      working: "Mean rate = gas volume ÷ time; 40 cm³ ÷ 20 s = 2 cm³/s",
      answer: "2 cm³/s",
    },
  ],
  core: [
    {
      slides: [4],
      builds: "same-skill-new-numbers",
      question: "Calculate the mean rate when 90 cm³ of hydrogen forms in 18 s.",
      working: "Mean rate = gas volume ÷ time; 90 cm³ ÷ 18 s = 5 cm³/s",
      answer: "5 cm³/s",
    },
    {
      slides: [6],
      builds: "explain",
      question: "State three variables to keep the same when comparing acid concentrations.",
      working: null,
      answer: "Acid volume, magnesium mass and temperature",
    },
    {
      slides: [7, 8],
      builds: "explain",
      question: "Explain why a more concentrated acid reacts faster with magnesium.",
      working: null,
      answer:
        "There are more acid particles per volume, so there are more frequent collisions with magnesium, so the reaction is faster.",
    },
    {
      slides: [4],
      builds: "new-context",
      question:
        "Work out the mean rate when 66 cm³ of gas forms in 30 s. Give your answer to one decimal place.",
      working: "Mean rate = gas volume ÷ time; 66 cm³ ÷ 30 s = 2.2 cm³/s",
      answer: "2.2 cm³/s",
    },
    {
      slides: [6],
      builds: "new-context",
      question: "Why is the investigation repeated at each concentration?",
      working: null,
      answer: "To make the results more reliable.",
    },
  ],
  challenge: {
    slides: [4, 8],
    builds: "combine",
    question:
      "Acid A gives 60 cm³ in 20 s. Acid B gives 60 cm³ in 30 s. Calculate both mean rates and explain which acid is more concentrated.",
    working: "60 cm³ ÷ 30 s = 2 cm³/s; 60 cm³ ÷ 20 s = 3 cm³/s",
    answer:
      "3 cm³/s for acid A and 2 cm³/s for acid B. Acid A is more concentrated: more particles per volume cause more frequent collisions, so it reacts faster.",
  },
};

/** Year 11 chemistry Exam practice, marks plan 1, 1, 2, 2, 3, 3, 4 (16). */
export const STUB_EXAM_RATES: ExamOutput = {
  items: [
    {
      slides: [3],
      command: "Name",
      marks: 1,
      question: "Name the gas produced when magnesium reacts with hydrochloric acid.",
      working: null,
      markScheme: ["Hydrogen"],
    },
    {
      slides: [3],
      command: "State",
      marks: 1,
      question: "State the equipment used to measure the volume of gas produced.",
      working: null,
      markScheme: ["A gas syringe"],
    },
    {
      slides: [4],
      command: "Calculate",
      marks: 2,
      question: "Calculate the mean rate of reaction when 50 cm³ of gas forms in 25 s.",
      working: "Mean rate = gas volume ÷ time; 50 cm³ ÷ 25 s = 2 cm³/s",
      markScheme: ["50 ÷ 25", "2 cm³/s"],
    },
    {
      slides: [6],
      command: "Give",
      marks: 2,
      question:
        "Give two variables that must be kept the same when investigating the effect of acid concentration.",
      working: null,
      markScheme: ["Acid volume", "Magnesium mass (or temperature)"],
    },
    {
      slides: [7, 8],
      command: "Explain",
      marks: 3,
      question:
        "Explain, in terms of particles, how a more concentrated acid changes how often particles collide with the magnesium.",
      working: null,
      markScheme: [
        "More acid particles per volume",
        "More frequent collisions with magnesium",
        "So the rate of reaction increases",
      ],
    },
    {
      slides: [6],
      command: "Describe",
      marks: 3,
      question: "Describe how to measure the volume of gas produced over time in this reaction.",
      working: null,
      markScheme: [
        "Connect the flask to a gas syringe",
        "Add the magnesium, fit the bung and start the timer",
        "Record the gas volume at regular time intervals",
      ],
    },
    {
      slides: [4, 8],
      command: "Compare",
      marks: 4,
      question:
        "Compare the mean rates of two reactions: 72 cm³ in 24 s and 72 cm³ in 36 s. Calculate each rate and explain the difference in terms of concentration.",
      working: "72 cm³ ÷ 24 s = 3 cm³/s; 72 cm³ ÷ 36 s = 2 cm³/s",
      markScheme: [
        "72 ÷ 24 = 3 cm³/s for the first reaction",
        "The faster reaction has the more concentrated acid",
        "More particles per volume, so more frequent collisions",
        "2 cm³/s for the second reaction",
      ],
    },
  ],
};
