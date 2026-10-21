/**
 * The reasons gold's cases (`northstars-v13/reasons/cases.js`, TEACH-75 part ad), as template
 * inputs: the render-compare set and the tests' content. `stage` is the gold's age.
 */
import type { Stage, TemplateInput } from "./index";

export type ReasonsCase = { name: string; stage: Stage; input: TemplateInput };
const R = (
  name: string,
  stage: Stage,
  heading: string,
  lead: string,
  chain: boolean,
  reasons: { icon?: string; head: string; line: string }[],
): ReasonsCase => ({
  name,
  stage,
  input: { template: "reasons", heading, ...(lead ? { lead } : {}), chain, reasons },
});

const ROME = [
  {
    icon: "helmet",
    head: "Invasions",
    line: "Goths and Vandals crossed the borders. Rome was sacked in AD 410.",
  },
  {
    icon: "shield",
    head: "Too big to defend",
    line: "The army was spread along thousands of miles of frontier.",
  },
  {
    icon: "coin",
    head: "Money ran out",
    line: "Heavy taxes and coins with less silver made the army hard to pay.",
  },
  {
    icon: "crown",
    head: "Weak leaders",
    line: "Emperors were often murdered, so rivals fought for the throne.",
  },
];
const SWEAT = [
  {
    icon: "exercise",
    head: "Moving makes us hot",
    line: "Running and playing make our muscles warm us up.",
  },
  {
    icon: "thermometer",
    head: "Our body must stay at 37 °C",
    line: "Our insides work best at this temperature.",
  },
  {
    icon: "sweat-drop",
    head: "Sweat cools us as it dries",
    line: "Drying sweat carries heat away from our skin.",
  },
];

export const REASONS_CASES: ReasonsCase[] = [
  R(
    "sweat",
    "ks2",
    "Why do we sweat?",
    "Your skin makes sweat on hot days and when you run.",
    false,
    SWEAT,
  ),
  R(
    "rome",
    "ks3",
    "Why did the Western Roman Empire fall?",
    "Rome ruled the west for centuries. By AD 476 it was gone.",
    false,
    ROME,
  ),
  R(
    "fire",
    "ks2",
    "How did one small fire burn down London?",
    "The Great Fire of London, September 1666.",
    true,
    [
      {
        icon: "bakery",
        head: "A fire starts in a bakery",
        line: "Sparks from Thomas Farriner's oven light his house in Pudding Lane.",
      },
      {
        icon: "wind",
        head: "Wind spreads the flames",
        line: "A strong east wind blows the fire through streets of wooden houses.",
      },
      {
        icon: "flame",
        head: "Most of the city burns",
        line: "In four days, 13,200 homes and St Paul's Cathedral are destroyed.",
      },
    ],
  ),
  R("plants", "ks1", "Why do plants need water?", "", false, [
    { icon: "without-water", head: "To stand up", line: "Without water, a plant droops." },
    { icon: "growth-over-time", head: "To grow", line: "Water helps a plant grow big." },
  ]),
  R(
    "romeNoIcon",
    "ks3",
    "Why did the Western Roman Empire fall?",
    "Rome ruled the west for centuries. By AD 476 it was gone.",
    false,
    ROME.map((it, i) => (i === 2 ? { ...it, icon: "roman-coin-hoard" } : it)),
  ),
  R(
    "sweatNoIcon",
    "ks2",
    "Why do we sweat?",
    "Your skin makes sweat on hot days and when you run.",
    false,
    SWEAT.map(({ head, line }) => ({ head, line })),
  ),
  R(
    "romeLong",
    "ks3",
    "Why did the Western Roman Empire fall in AD 476?",
    "Rome ruled the west for centuries. By AD 476 it was gone.",
    false,
    [
      {
        icon: "helmet",
        head: "Invasions across the long borders",
        line: "Goths and Vandals crossed the rivers. The Visigoths sacked Rome.",
      },
      {
        icon: "shield",
        head: "An empire too big to defend",
        line: "The army was spread thinly along thousands of miles of frontier.",
      },
      {
        icon: "coin",
        head: "Money and trade ran out",
        line: "Heavy taxes and coins with less silver made soldiers hard to pay.",
      },
      {
        icon: "crown",
        head: "Weak leaders and civil wars",
        line: "Emperors were murdered, so rival generals fought for the throne.",
      },
    ],
  ),
  R("fireKs1", "ks1", "How did a small fire burn down London?", "", true, [
    {
      icon: "bakery",
      head: "A bakery catches fire",
      line: "Sparks from the oven light the house.",
    },
    { icon: "wind", head: "The wind blows it on", line: "The fire jumps to the next houses." },
    { icon: "flame", head: "Most of London burns", line: "It burns for four days." },
  ]),
];
