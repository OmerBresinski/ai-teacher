import type { TemplateInput } from "../index";
import { templateSamples } from "../samples";

/**
 * Inputs for the old-lesson snapshot (TEACH-75 part e): every template sample plus the key-card
 * shapes a lesson written before typed callouts holds (labelled points in a column, a labelled
 * strip under a full-width diagram). `old-lesson-master.json` holds master's (25ac3642) output
 * hash for each, every theme and stage, ids removed.
 */
const flow = {
  diagram: {
    kind: "flow",
    alt: "The life cycle of a chicken",
    steps: [{ label: "Egg" }, { label: "Chick" }, { label: "Hen" }],
  },
};
const photo = { photo: "", aspect: 4 / 3, alt: "a lamb" };
/** Templates added since the snapshot: an old lesson cannot hold them, so they are not in it. */
// `worked` (TEACH-17 part b) is new: no saved lesson can hold one, so it has no master hash.
const NEWER = new Set<string>(["panel-list", "split-compare", "items-row", "worked", "stages"]);
export const OLD_LESSON_INPUTS: TemplateInput[] = [
  ...templateSamples()
    .filter((s) => !NEWER.has(s.template))
    // The question-set sample gained answers (the quick check, TEACH-101 part g); master's had none.
    .map((s) => (s.template === "question-set" ? { ...s, answers: undefined } : s)),
  {
    template: "picture-text",
    heading: "Lambs",
    lead: "A lamb is a young sheep.",
    points: [{ label: "Lamb", text: "a young sheep" }, "It drinks milk."],
    figure: photo,
  },
  {
    template: "explain",
    heading: "Grow",
    lead: "All young grow.",
    points: [
      { label: "Lamb", text: "a young sheep" },
      { label: "Ewe", text: "its mother" },
      "Food",
    ],
  },
  {
    template: "diagram-text",
    heading: "Egg to hen",
    lead: "Three stages.",
    points: [{ label: "Egg", text: "laid by the hen" }],
    figure: flow,
  },
  {
    template: "big-diagram",
    heading: "Loop",
    lead: "Follow it.",
    points: [{ label: "Egg", text: "laid by the hen" }, "The chick hatches."],
    figure: flow,
  },
];
export const OLD_LESSON_STAGES = ["ks1", "ks2", "ks3", "ks4", "ks5"] as const;
