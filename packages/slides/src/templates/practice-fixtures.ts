/**
 * The v13 gold's cases (`northstars-v13/practice-exit/cases.js`) as template inputs, for the tests
 * and the render check (TEACH-230 part b). `where` is the input's `instruction` (kept, not drawn);
 * a failed picture is `tile: true`; the gold's bar chart is the repo's `bar-chart` diagram.
 */
import type { Stage, TemplateInput } from "./index";

export type WorkCase = { name: string; stage: Stage; input: TemplateInput };

const PHOTO = "https://images.test/cow.jpg";
const RAIN = {
  kind: "bar-chart",
  alt: "Rainfall in Manchester (mm)",
  title: "Rainfall in Manchester (mm)",
  // The repo's bar chart takes at most 8 bars: March to October.
  bars: ["M", "A", "M", "J", "J", "A", "S", "O"].map((label, i) => ({
    label,
    value: [62, 54, 58, 66, 69, 82, 71, 94][i] as number,
  })),
};
const RAIN_TASKS = [
  "Which month has the most rainfall? Give the amount in millimetres.",
  "Describe the pattern of rainfall from April to October.",
  "Calculate the difference between the wettest and the driest month.",
  "Suggest one reason why autumn is wetter than spring in Manchester.",
];
const COW_TASKS = [
  "How many legs does the cow have?",
  "Name one thing a cow eats.",
  "What do we get from cows?",
];
const COLUMN = [
  "3,456 + 2,789",
  "4,508 + 1,694",
  "6,375 + 2,846",
  "7,209 + 1,987",
  "5,647 + 3,568",
  "2,938 + 4,775",
];
const p = (
  name: string,
  stage: Stage,
  heading: string,
  questions: string[],
  extra: Partial<TemplateInput> = {},
): WorkCase => ({ name, stage, input: { template: "practice", heading, questions, ...extra } });
const e = (
  name: string,
  stage: Stage,
  heading: string,
  questions: string[],
  extra: Partial<TemplateInput> = {},
): WorkCase => ({ name, stage, input: { template: "exit-ticket", heading, questions, ...extra } });

export const WORK_CASES: WorkCase[] = [
  p("practice-ks1-picture-static", "ks1", "Look at the cow", COW_TASKS, {
    instruction: "Answer in your book",
    figure: { photo: PHOTO, aspect: 4 / 3, alt: "A cow standing in a field" },
  }),
  p("practice-ks1-picture-failed", "ks1", "Look at the cow", COW_TASKS, {
    instruction: "Answer in your book",
    figure: { photo: PHOTO, aspect: 4 / 3, alt: "A cow standing in a field" },
    tile: true,
  }),
  p("practice-ks1-3-static", "ks1", "Adding tens", [
    "46 + 30 =",
    "52 + 40 =",
    "Sam has 23 stickers. He gets 20 more. How many now?",
  ]),
  p("practice-ks2-maths6-static", "ks2", "Add using the column method", COLUMN, {
    instruction: "Answer in your book. Show your working.",
  }),
  p("practice-ks2-4-static", "ks2", "Plants and water", [
    "Which part of a plant takes in water from the soil?",
    "Name the tubes that carry water up the stem.",
    "Why do leaves wilt on a hot day?",
    "Plan a test to find out if plants need light to grow.",
  ]),
  p(
    "practice-ks2-tf-static",
    "ks2",
    "True or false: the water cycle",
    [
      "Water evaporates when it is heated.",
      "Clouds are made of water vapour.",
      "Rain, snow and hail are all precipitation.",
      "Puddles dry up faster on cold days.",
      "Rivers carry water back to the sea.",
    ],
    { kind: "tf", answers: ["True", "False", "True", "False", "True"] },
  ),
  p("practice-ks3-figure-static", "ks3", "Reading a rainfall graph", RAIN_TASKS, {
    figure: { diagram: RAIN },
  }),
  p("practice-ks3-figure-failed", "ks3", "Reading a rainfall graph", RAIN_TASKS, {
    figure: {
      diagram: {
        kind: "no-such-kind",
        caption: "Rainfall in Manchester (mm), January to December",
      },
    },
  }),
  p("practice-ks3-4long-static", "ks3", "Causes of the First World War", [
    "Explain how the alliance system turned a local quarrel in the Balkans into a European war.",
    "Describe two ways in which the naval race made Britain and Germany distrust each other.",
    "Why did the assassination of Archduke Franz Ferdinand matter so much to Austria-Hungary?",
    "Which cause do you think mattered most? Give one reason from your notes for your choice.",
  ]),
  p("practice-ks2-over7-over", "ks2", "Add using the column method", [...COLUMN, "1,867 + 6,459"]),
  p("practice-ks1-3-cap", "ks1", "Adding tens", [
    "Ben has 34 marbles. His friend gives him 20 more. How many marbles does Ben have now?",
    "Mia has 58 sweets. She eats 30 of them. How many sweets has Mia got left?",
    "There are 45 children on the bus. 20 more get on at the park. How many children are on the bus?",
  ]),
  p("practice-ks3-6-cap", "ks3", "Causes of the First World War", [
    "Explain what an alliance is, using one example of an alliance from 1914.",
    "Describe one way the naval race made Britain feel less safe after 1906.",
    "Why did Austria-Hungary blame Serbia for the murder of Franz Ferdinand in Sarajevo?",
    "Explain how the Schlieffen Plan brought Britain into the war in August 1914.",
    "Give two reasons why the empires of Europe were competing for colonies in Africa.",
    "Which cause mattered most? Give one reason from your notes to support your choice.",
  ]),
  e("exit-ks1-2-static", "ks1", "What plants need", [
    "Name one thing a plant needs to grow.",
    "Where does a plant take in water?",
  ]),
  e(
    "exit-ks2-3-static",
    "ks2",
    "Fractions of amounts",
    [
      "Find {1/6} of 42.",
      "Find {4/5} of 30.",
      "{3/8} of 32 seats are booked. How many seats are booked?",
    ],
    { answers: ["7", "24", "12"] },
  ),
  e("exit-ks3-3long-static", "ks3", "The circulatory system", [
    "Name the organ that pumps blood, and the fluid that carries oxygen around the body.",
    "Describe where blood picks up oxygen and where it gives up carbon dioxide.",
    "A runner's pulse rises during a race. Explain why the heart has to beat faster.",
  ]),
  e(
    "exit-ks2-tf-static",
    "ks2",
    "True or false: materials",
    [
      "All metals are attracted to a magnet.",
      "Wood is a good thermal insulator.",
      "Glass is transparent because it lets light through.",
    ],
    { kind: "tf" },
  ),
  e("exit-ks1-1-static", "ks1", "Our five senses", ["Which sense do you use to hear a bird sing?"]),
  e("exit-ks3-3-cap", "ks3", "The circulatory system", [
    "Name the organ that pumps blood around the body, and explain why its left side has a thicker muscle wall than its right side.",
    "Describe the journey of one red blood cell from the lungs to a working muscle in the leg, naming each blood vessel it passes through.",
    "A runner's pulse rises from 70 to 150 beats a minute during a race. Explain why her heart beats faster, using the words oxygen and respiration.",
  ]),
  e("exit-ks2-over4-over", "ks2", "Fractions of amounts", [
    "Find {1/6} of 42.",
    "Find {4/5} of 30.",
    "{3/8} of 32 seats are booked. How many seats are booked?",
    "Find {2/3} of 27.",
  ]),
];
