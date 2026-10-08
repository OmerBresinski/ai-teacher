import type { Figure, TemplateInput } from "./index";

/**
 * One filled sample per writer template (a Year 1 life-cycles lesson, short enough for KS1's
 * capacity), for the every-theme test and the contact-sheet renders. `photo` gives each picture slot
 * its source; the default is an open slot ("": the image view draws its placeholder).
 */
export function templateSamples(photo: (label: string) => string = () => ""): TemplateInput[] {
  const ph = (label: string): Figure => ({ photo: photo(label), aspect: 4 / 3, alt: label });
  const flow: Figure = {
    diagram: {
      kind: "flow",
      alt: "The life cycle of a chicken",
      steps: [{ label: "Egg" }, { label: "Chick" }, { label: "Hen" }],
    },
  };
  return [
    {
      template: "title",
      heading: "Animals and their young",
      lead: "How do young animals change as they grow?",
      figure: ph("hen and chicks"),
    },
    {
      template: "objectives",
      heading: "Today we will",
      points: [
        "Name the young of some animals",
        "Describe how a chick grows into a hen",
        "Sort animals by how their young change",
      ],
    },
    {
      template: "explain",
      heading: "Young animals grow",
      lead: "Every animal starts small and grows bigger.",
      points: [
        "Some young look like their parents.",
        "Some young change shape as they grow.",
        "All young need food and shelter.",
      ],
    },
    {
      template: "picture-text",
      heading: "Lambs and ewes",
      lead: "A lamb is a young sheep.",
      points: [
        { label: "Lamb", text: "a young sheep" },
        { label: "Ewe", text: "the mother" },
      ],
      figure: ph("ewe and lamb"),
    },
    {
      template: "diagram-text",
      heading: "From egg to hen",
      lead: "A chicken goes through three stages.",
      points: ["The chick hatches from an egg.", "The chick grows into a hen."],
      figure: flow,
    },
    {
      template: "big-diagram",
      heading: "The life cycle of a chicken",
      lead: "Follow the arrows from egg to hen.",
      figure: flow,
    },
    {
      template: "big-picture",
      heading: "Look closely",
      lead: "What do you notice about the frog and the tadpole?",
      figure: ph("frog and tadpole"),
    },
    {
      template: "picture-sequence",
      heading: "A frog grows up",
      sequence: [
        { caption: "Frogspawn", figure: ph("frogspawn") },
        { caption: "Tadpole", figure: ph("tadpole") },
        { caption: "Frog", figure: ph("frog") },
      ],
    },
    {
      template: "compare",
      heading: "Same or different?",
      columns: [
        { label: "Lamb", text: "Looks like its parent from birth." },
        { label: "Tadpole", text: "Changes shape before it looks like a frog." },
      ],
    },
    {
      template: "steps",
      heading: "How a caterpillar changes",
      points: [
        "The caterpillar eats leaves and grows.",
        "It makes a chrysalis around itself.",
        "A butterfly comes out of the chrysalis.",
      ],
    },
    {
      template: "hinge",
      heading: "Quick check",
      stem: "Which young animal looks most like its parent?",
      options: ["A tadpole", "A lamb", "A caterpillar", "Frogspawn"],
    },
    {
      template: "question-set",
      heading: "Your turn",
      questions: [
        "What is a young sheep called?",
        "What does a tadpole grow into?",
        "Name one animal whose young change shape.",
      ],
      instruction: "Answer in full sentences.",
    },
    {
      template: "discussion",
      heading: "Talk to your partner",
      lead: "Why do some young animals look so different from their parents?",
    },
    {
      template: "practice",
      heading: "Practice",
      questions: [
        "Draw the life cycle of a frog.",
        "Label each stage.",
        "Write one sentence about each stage.",
      ],
      instruction: "You have five minutes.",
    },
    {
      template: "exit-ticket",
      heading: "Before you go",
      questions: ["What is a young cow called?", "Name the three stages of a chicken's life."],
    },
    {
      template: "equation-hero",
      heading: "Finding a fraction of an amount",
      formula: "1/4 of 20 = 20 ÷ 4 = 5",
      points: ["Divide by the denominator.", "Multiply by the numerator."],
    },
  ];
}
