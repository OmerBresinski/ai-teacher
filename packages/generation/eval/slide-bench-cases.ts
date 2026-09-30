/*
 * Slide-bench cases (spike/slide-bench). Each case is one slide: either a row of a saved plan-write
 * plan (`from`: the lesson file under the rounds dir and its 1-based slide number, so the writer
 * sees the real table), or a small synthetic plan in the planner's own coded rows (`plan`, the
 * target the last row). `probe` is mode (a)'s input: one objective and one content point.
 */

export type BenchCase = {
  id: string;
  /** The form and layout the case exercises (mode b writes to the row's own form and layout). */
  form: string;
  layout: string;
  ks: string;
  hard?: string;
  from?: { file: string; slide: number };
  plan?: {
    topic: string;
    subject: string;
    yearGroup: string;
    ageBand: string;
    objectives: string[];
    runningExample: string;
    misconception: string;
    /** Coded rows after the title (`role | form | layout | objectives | parts | aim | teaches | tests`). */
    rows: string[];
  };
  probe: { objective: string; point: string };
};

export const CASES: BenchCase[] = [
  // Saved plan rows (pw1 L/S, pw2-smoke S).
  {
    id: "y5-rivers-hinge",
    form: "hinge",
    layout: "default",
    ks: "KS2",
    from: { file: "pw1/S/y5-rivers.lesson.json", slide: 7 },
    probe: {
      objective: "Explain why a river flows from source to mouth",
      point: "check pupils know a river flows downhill, not always south",
    },
  },
  {
    id: "y5-rivers-vocab",
    form: "vocabulary",
    layout: "default",
    ks: "KS2",
    from: { file: "pw1/S/y5-rivers.lesson.json", slide: 3 },
    probe: {
      objective: "Use the words source, tributary and mouth correctly",
      point: "the meanings of source, tributary and mouth",
    },
  },
  {
    id: "y9-weimar-compare",
    form: "compare",
    layout: "default",
    ks: "KS3",
    from: { file: "pw1/S/y9-weimar.lesson.json", slide: 6 },
    probe: {
      objective: "Explain who lost and who gained from hyperinflation in 1923",
      point: "savers lost, borrowers with fixed debts gained",
    },
  },
  {
    id: "y9-weimar-photo",
    form: "photo",
    layout: "default",
    ks: "KS3",
    from: { file: "pw1/S/y9-weimar.lesson.json", slide: 2 },
    probe: {
      objective: "Describe the effects of hyperinflation on ordinary Germans in 1923",
      point: "open with the scale of it: people carried banknotes in bundles to buy bread",
    },
  },
  {
    id: "y11-linear-worked",
    form: "worked-example",
    layout: "default",
    ks: "KS4",
    from: { file: "pw1/S/y11-linear.lesson.json", slide: 4 },
    probe: {
      objective: "Solve linear equations with the unknown on both sides",
      point: "model solving 5x + 7 = 3x + 19 step by step",
    },
  },
  {
    id: "y11-linear-starter",
    form: "starter-set",
    layout: "default",
    ks: "KS4",
    from: { file: "pw1/S/y11-linear.lesson.json", slide: 2 },
    probe: {
      objective: "Solve linear equations with the unknown on both sides",
      point: "recall simplifying like terms and inverse operations from last lesson",
    },
  },
  {
    id: "y10-electro-diagram",
    form: "diagram-slot",
    layout: "default",
    ks: "KS4",
    from: { file: "pw1/S/y10-electrolysis.lesson.json", slide: 2 },
    probe: {
      objective: "Identify the ions present in an aqueous solution during electrolysis",
      point: "copper(II) chloride solution: which ions move to which electrode",
    },
  },
  {
    id: "y10-electro-callout",
    form: "explain-callout",
    layout: "default",
    ks: "KS4",
    from: { file: "pw1/L/y10-electrolysis.lesson.json", slide: 5 },
    probe: {
      objective: "Predict the product at the cathode in aqueous electrolysis",
      point:
        "hydrogen forms unless the metal is less reactive than hydrogen; pupils think the metal always forms",
    },
  },
  {
    id: "y6-ratio-checkset",
    form: "check-set",
    layout: "default",
    ks: "KS2",
    from: { file: "pw1/S/y6-ratio.lesson.json", slide: 5 },
    probe: {
      objective: "Find a missing quantity in a ratio",
      point: "quick check: one part and the matching amount in a 2:3 drink",
    },
  },
  {
    id: "y3-rocks-matching",
    form: "matching",
    layout: "default",
    ks: "KS2",
    from: { file: "pw1/S/y3-rocks.lesson.json", slide: 6 },
    probe: {
      objective: "Describe how the three rock types form",
      point: "check pupils can pair igneous, sedimentary and metamorphic with how each forms",
    },
  },
  {
    id: "y4-plants-sort",
    form: "sort",
    layout: "default",
    ks: "KS2",
    from: { file: "pw1/L/y4-plants.lesson.json", slide: 8 },
    probe: {
      objective: "Describe the life cycle of a flowering plant",
      point: "pupils put the four stages of the oak's life cycle in order",
    },
  },
  {
    id: "y11-linear-open",
    form: "open-response",
    layout: "default",
    ks: "KS4",
    from: { file: "pw1/S/y11-linear.lesson.json", slide: 8 },
    probe: {
      objective: "Solve linear equations with the unknown on both sides and check the answer",
      point: "pupils solve and check 7x + 4 = 3x + 20 on their own",
    },
  },
  // The three known hard cases.
  {
    id: "HARD-y8-hinge-outline",
    form: "hinge",
    // plan-lesson.v3 takes the stacked layout for outline options (checked in layout mode).
    layout: "stacked",
    ks: "KS3",
    hard: "long-option hinge (speech outlines)",
    from: { file: "pw2-smoke/S/y8-persuasive.lesson.json", slide: 6 },
    probe: {
      objective: "Describe a clear structure for a persuasive speech",
      point: "check pupils can pick the strongest speech outline over one that just lists devices",
    },
  },
  {
    id: "HARD-y10-exit3",
    form: "exit-ticket",
    layout: "default",
    ks: "KS4",
    hard: "3-question set",
    from: { file: "pw1/S/y10-electrolysis.lesson.json", slide: 10 },
    probe: {
      objective: "Predict the products of electrolysis of aqueous solutions",
      point:
        "close with three questions on potassium bromide solution: ions at the cathode, cathode product, anode product",
    },
  },
  {
    id: "HARD-y8-discussion2",
    form: "discussion",
    layout: "default",
    ks: "KS3",
    hard: "discussion with two sentence starters",
    from: { file: "pw1/L/y8-persuasive.lesson.json", slide: 2 },
    probe: {
      objective: "Write a short persuasive speech section with a clear argument",
      point:
        "open with talk: what would convince the head to add more outdoor seating; give two sentence starters",
    },
  },
  // Synthetic rows: KS1, KS5 and forms the saved plans do not use.
  {
    id: "y5-rivers-sequence",
    form: "sequence",
    layout: "default",
    ks: "KS2",
    plan: {
      topic: "Rivers: the journey from source to mouth",
      subject: "Geography",
      yearGroup: "Year 5",
      ageBand: "ks2",
      objectives: [
        "Name the parts of a river from source to mouth",
        "Describe how a river changes from source to mouth",
      ],
      runningExample:
        "The River Thames, from its source in the Cotswolds to its mouth at the North Sea",
      misconception: "Rivers flow south; in fact they flow downhill in any direction",
      rows: [
        "teach | vocabulary | default | 1 | 3 | name source, course and mouth | source, course, mouth | -",
        "teach | sequence | default | 2 | 3 | how speed, width and depth change from source to mouth | river-changes | -",
      ],
    },
    probe: {
      objective: "Describe how a river changes from source to mouth",
      point: "speed, width and depth change along the course",
    },
  },
  {
    id: "y1-seasons-explain",
    form: "explain",
    layout: "default",
    ks: "KS1",
    plan: {
      topic: "The four seasons and the weather",
      subject: "Science",
      yearGroup: "Year 1",
      ageBand: "ks1",
      objectives: ["Name the four seasons in order", "Describe the weather in each season"],
      runningExample: "The oak tree in the school playground through the year",
      misconception:
        "It is always cold in winter and hot in summer every day; the weather changes from day to day",
      rows: [
        "teach | explain | default | 1 | 2 | the four seasons come in the same order every year | season-order | -",
      ],
    },
    probe: {
      objective: "Name the four seasons in order",
      point: "spring, summer, autumn, winter come round every year, seen on the playground oak",
    },
  },
  {
    id: "y2-animals-truefalse",
    form: "true-false",
    layout: "default",
    ks: "KS1",
    plan: {
      topic: "Animals and their offspring",
      subject: "Science",
      yearGroup: "Year 2",
      ageBand: "ks1",
      objectives: ["Describe how animals have offspring that grow into adults"],
      runningExample: "A frog's life cycle in the school pond",
      misconception:
        "Offspring always look like their parents; a tadpole looks nothing like a frog",
      rows: [
        "teach | sequence | default | 1 | 4 | frogspawn to tadpole to froglet to frog | frog-cycle | -",
        "check | true-false | default | 1 | 1 | a tadpole is a baby frog | - | frog-cycle",
      ],
    },
    probe: {
      objective: "Describe how animals have offspring that grow into adults",
      point: "check: is a tadpole a baby frog (true or false)",
    },
  },
  {
    id: "y2-fire-photo",
    form: "photo",
    layout: "default",
    ks: "KS1",
    plan: {
      topic: "The Great Fire of London, 1666",
      subject: "History",
      yearGroup: "Year 2",
      ageBand: "ks1",
      objectives: [
        "Describe what happened in the Great Fire of London",
        "Explain why the fire spread so quickly",
      ],
      runningExample: "Samuel Pepys's diary of the fire",
      misconception:
        "The fire was started on purpose; it began by accident in a bakery on Pudding Lane",
      rows: ["hook | photo | default | - | 1 | a painting of London burning in 1666 | - | -"],
    },
    probe: {
      objective: "Describe what happened in the Great Fire of London",
      point: "open with a painting of the fire so pupils see how big it was",
    },
  },
  {
    id: "y1-plants-figure",
    form: "figure",
    layout: "default",
    ks: "KS1",
    plan: {
      topic: "Parts of a plant",
      subject: "Science",
      yearGroup: "Year 1",
      ageBand: "ks1",
      objectives: ["Name the parts of a flowering plant"],
      runningExample: "A sunflower grown in the classroom",
      misconception: "Roots are not part of the plant because you cannot see them",
      rows: [
        "teach | figure | default | 1 | 2 | the sunflower's roots, stem, leaves and flower | plant-parts | -",
      ],
    },
    probe: {
      objective: "Name the parts of a flowering plant",
      point: "a sunflower with roots, stem, leaves and flower labelled",
    },
  },
  {
    id: "y2-maths-fillgap",
    form: "fill-gap",
    layout: "default",
    ks: "KS1",
    plan: {
      topic: "Tens and ones",
      subject: "Maths",
      yearGroup: "Year 2",
      ageBand: "ks1",
      objectives: ["Partition two-digit numbers into tens and ones"],
      runningExample: "Bundles of ten straws and single straws",
      misconception: "In 46 the 4 means four; it means four tens, 40",
      rows: [
        "teach | explain | default | 1 | 2 | 46 is 4 tens and 6 ones | partition | -",
        "check | fill-gap | default | 1 | 2 | partition 58 into tens and ones | - | partition",
      ],
    },
    probe: {
      objective: "Partition two-digit numbers into tens and ones",
      point: "pupils fill in: 58 = __ tens and __ ones",
    },
  },
  {
    id: "y2-geog-compare",
    form: "compare",
    layout: "default",
    ks: "KS1",
    plan: {
      topic: "Hot and cold places in the world",
      subject: "Geography",
      yearGroup: "Year 2",
      ageBand: "ks1",
      objectives: ["Describe how hot and cold places are different"],
      runningExample: "Kenya and the Arctic",
      misconception: "Every hot place is a desert; many hot places near the Equator are wet",
      rows: [
        "teach | compare | default | 1 | 2 | Kenya and the Arctic: weather and animals | hot-vs-cold | -",
      ],
    },
    probe: {
      objective: "Describe how hot and cold places are different",
      point: "Kenya and the Arctic side by side: weather and animals",
    },
  },
  {
    id: "y13-psych-explain",
    form: "explain",
    layout: "default",
    ks: "KS5",
    plan: {
      topic: "Obedience: Milgram's research",
      subject: "Psychology",
      yearGroup: "Year 13",
      ageBand: "ks5",
      objectives: [
        "Outline the procedure and findings of Milgram's 1963 study",
        "Evaluate Milgram's research using ethical and methodological issues",
      ],
      runningExample: "Milgram's 1963 study at Yale",
      misconception: "Only cruel people obeyed; 65% of ordinary participants went to 450 volts",
      rows: [
        "teach | explain | default | 1 | 3 | procedure and the 65% finding | milgram-findings | -",
      ],
    },
    probe: {
      objective: "Outline the procedure and findings of Milgram's 1963 study",
      point: "the procedure and the finding that 65% went to 450 volts",
    },
  },
  {
    id: "y13-psych-hinge",
    form: "hinge",
    layout: "default",
    ks: "KS5",
    plan: {
      topic: "Obedience: Milgram's research",
      subject: "Psychology",
      yearGroup: "Year 13",
      ageBand: "ks5",
      objectives: [
        "Outline the procedure and findings of Milgram's 1963 study",
        "Evaluate Milgram's research using ethical and methodological issues",
      ],
      runningExample: "Milgram's 1963 study at Yale",
      misconception: "Only cruel people obeyed; 65% of ordinary participants went to 450 volts",
      rows: [
        "teach | explain | default | 1 | 3 | procedure and the 65% finding | milgram-findings | -",
        "teach | list | default | 2 | 2 | deception and right to withdraw as ethical issues | milgram-ethics | -",
        "hinge | hinge | default | 2 | 4 | which ethical issue the prods raise | - | milgram-ethics",
      ],
    },
    probe: {
      objective: "Evaluate Milgram's research using ethical issues",
      point: "check pupils see the prods as a breach of the right to withdraw",
    },
  },
  {
    id: "y12-econ-list",
    form: "list",
    layout: "default",
    ks: "KS5",
    plan: {
      topic: "Causes of inflation",
      subject: "Economics",
      yearGroup: "Year 12",
      ageBand: "ks5",
      objectives: [
        "Distinguish demand-pull from cost-push inflation",
        "Explain a cause of each with a real example",
      ],
      runningExample: "UK inflation in 2022",
      misconception: "All inflation comes from printing money; rising costs can push prices up too",
      rows: [
        "teach | list | default | 1 | 2 | demand-pull and cost-push, each with a UK case | demand-pull, cost-push | -",
      ],
    },
    probe: {
      objective: "Distinguish demand-pull from cost-push inflation",
      point: "the two causes, each defined with a UK example",
    },
  },
  {
    id: "y12-maths-worked",
    form: "worked-example",
    layout: "default",
    ks: "KS5",
    plan: {
      topic: "Stationary points",
      subject: "Maths",
      yearGroup: "Year 12",
      ageBand: "ks5",
      objectives: [
        "Find stationary points by differentiation",
        "Classify stationary points with the second derivative",
      ],
      runningExample: "y = x^3 - 3x^2 + 4",
      misconception: "A stationary point is where y = 0; it is where dy/dx = 0",
      rows: [
        "teach | worked-example | default | 1 | 4 | find the stationary points of the running curve | find-stationary | -",
      ],
    },
    probe: {
      objective: "Find stationary points by differentiation",
      point: "model finding the stationary points of y = x^3 - 3x^2 + 4",
    },
  },
  {
    id: "y13-chem-sequence",
    form: "sequence",
    layout: "default",
    ks: "KS5",
    plan: {
      topic: "Nucleophilic substitution",
      subject: "Chemistry",
      yearGroup: "Year 13",
      ageBand: "ks5",
      objectives: ["Describe the SN1 mechanism", "Explain why tertiary haloalkanes react by SN1"],
      runningExample: "2-bromo-2-methylpropane with hydroxide ions",
      misconception: "SN1 happens in one step; it goes through a carbocation in two steps",
      rows: [
        "teach | sequence | default | 1 | 3 | the SN1 steps for 2-bromo-2-methylpropane | sn1-steps | -",
      ],
    },
    probe: {
      objective: "Describe the SN1 mechanism",
      point: "the steps of SN1 for 2-bromo-2-methylpropane",
    },
  },
  {
    id: "y7-maths-hinge-why",
    form: "hinge",
    layout: "why",
    ks: "KS3",
    plan: {
      topic: "Fractions of amounts",
      subject: "Maths",
      yearGroup: "Year 7",
      ageBand: "ks3",
      objectives: ["Find a fraction of an amount"],
      runningExample: "A class trip budget of £240",
      misconception:
        "To find 3/4 you divide by 3; you divide by the denominator and multiply by the numerator",
      rows: [
        "teach | worked-example | default | 1 | 3 | find 3/4 of £240 | fraction-of-amount | -",
        "hinge | hinge | why | 1 | 4 | 2/5 of £60, options are amounts | - | fraction-of-amount",
      ],
    },
    probe: {
      objective: "Find a fraction of an amount",
      point: "check: what is 2/5 of £60, answers are amounts",
    },
  },
  {
    id: "y7-french-matching",
    form: "matching",
    layout: "default",
    ks: "KS3",
    plan: {
      topic: "Describing your family in French",
      subject: "French",
      yearGroup: "Year 7",
      ageBand: "ks3",
      objectives: ["Name family members in French", "Say how many brothers and sisters you have"],
      runningExample: "A French pen pal's family photo",
      misconception: "Mon and ma are the same; mon goes with masculine nouns, ma with feminine",
      rows: [
        "teach | vocabulary | default | 1 | 4 | mère, père, frère, sœur | family-words | -",
        "check | matching | default | 1 | 3 | match French family words to English | - | family-words",
      ],
    },
    probe: {
      objective: "Name family members in French",
      point: "pupils match mère, père and sœur to their English meanings",
    },
  },
  {
    id: "y9-computing-vocab",
    form: "vocabulary",
    layout: "default",
    ks: "KS3",
    plan: {
      topic: "Binary numbers",
      subject: "Computing",
      yearGroup: "Year 9",
      ageBand: "ks3",
      objectives: ["Define bit, byte and binary", "Convert 8-bit binary numbers to denary"],
      runningExample: "The binary number 01001101",
      misconception: "Binary 10 means ten; it means two",
      rows: [
        "teach | vocabulary | default | 1 | 4 | bit, byte, binary, denary | bit, byte, binary, denary | -",
      ],
    },
    probe: {
      objective: "Define bit, byte and binary",
      point: "the key words bit, byte, binary and denary",
    },
  },
  {
    id: "y12-ethics-discussion",
    form: "discussion",
    layout: "default",
    ks: "KS5",
    plan: {
      topic: "Utilitarianism",
      subject: "Religious Studies",
      yearGroup: "Year 12",
      ageBand: "ks5",
      objectives: [
        "Explain Bentham's act utilitarianism",
        "Evaluate utilitarianism using the trolley problem",
      ],
      runningExample: "The trolley problem",
      misconception:
        "Utilitarianism means doing what makes you happy; it counts everyone's happiness equally",
      rows: [
        "teach | explain | default | 1 | 3 | act utilitarianism and the hedonic calculus | act-util | -",
        "practise | discussion | default | 2 | 2 | should you pull the lever, as a utilitarian would argue | - | act-util",
      ],
    },
    probe: {
      objective: "Evaluate utilitarianism using the trolley problem",
      point: "a class debate on pulling the lever, with two sentence starters",
    },
  },
  {
    id: "y12-bio-open",
    form: "open-response",
    layout: "default",
    ks: "KS5",
    plan: {
      topic: "Enzyme action",
      subject: "Biology",
      yearGroup: "Year 12",
      ageBand: "ks5",
      objectives: [
        "Explain the induced-fit model",
        "Explain how temperature affects the rate of an enzyme reaction",
      ],
      runningExample: "Amylase breaking down starch",
      misconception:
        "Enzymes are killed by heat; they are denatured as the active site changes shape",
      rows: [
        "teach | explain | default | 2 | 3 | high temperature denatures the active site | denaturing | -",
        "practise | open-response | default | 2 | 2 | explain why amylase stops working at 70 °C | - | denaturing",
      ],
    },
    probe: {
      objective: "Explain how temperature affects the rate of an enzyme reaction",
      point: "pupils explain in writing why amylase stops working at 70 °C",
    },
  },
];
