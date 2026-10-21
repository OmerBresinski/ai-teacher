/**
 * The source gold's cases (`northstars-v12/source/content.mjs`), as layout inputs: the tests,
 * the renders beside the gold PNGs and the editor harness read them. Every anchor is verbatim.
 */
import type { Stage, TemplateInput } from "./index";

type Case = Omit<TemplateInput, "template" | "heading"> & { stage: Stage };
const SLIDES: Record<string, Case> = {
  peter: {
    stage: "ks1",
    form: "prose",
    from: "from The Tale of Peter Rabbit, Beatrix Potter (1902)",
    extract:
      "Once upon a time there were four little Rabbits, and their names were Flopsy, Mopsy, Cotton-tail, and Peter. They lived with their Mother in a sand-bank, underneath the root of a very big fir-tree.",
    notes: [
      { anchor: "four little Rabbits", label: "who", text: "four rabbit children" },
      { anchor: "a very big fir-tree", label: "where", text: "a home under a tree" },
    ],
  },
  dickens: {
    stage: "ks3",
    form: "prose",
    from: "from A Christmas Carol, Charles Dickens (1843)",
    extract:
      "Oh! But he was a tight-fisted hand at the grindstone, Scrooge! a squeezing, wrenching, grasping, scraping, clutching, covetous, old sinner! Hard and sharp as flint, from which no steel had ever struck out generous fire; secret, and self-contained, and solitary as an oyster. The cold within him froze his old features, nipped his pointed nose, shrivelled his cheek, stiffened his gait.",
    notes: [
      {
        anchor: "squeezing, wrenching, grasping, scraping, clutching",
        label: "list of verbs",
        text: "greed that grabs and holds",
      },
      { anchor: "solitary as an oyster", label: "simile", text: "shut away from everyone" },
    ],
  },
  owen: {
    stage: "ks3",
    form: "verse",
    from: "from Dulce et Decorum Est, Wilfred Owen (1920)",
    extract: [
      "Bent double, like old beggars under sacks,",
      "Knock-kneed, coughing like hags, we cursed through sludge,",
      "Till on the haunting flares we turned our backs",
      "And towards our distant rest began to trudge.",
      "Men marched asleep. Many had lost their boots",
      "But limped on, blood-shod. All went lame; all blind;",
      "Drunk with fatigue; deaf even to the hoots",
      "Of tired, outstripped Five-Nines that dropped behind.",
    ].join("\n"),
    notes: [
      { anchor: "like old beggars", label: "simile", text: "young men made old" },
      { anchor: "trudge", label: "slow verb", text: "heavy, dragging steps" },
      { anchor: "blood-shod", label: "invented word", text: "blood where boots should be" },
    ],
  },
  mole: {
    stage: "ks2",
    form: "prose",
    from: "from The Wind in the Willows, Kenneth Grahame",
    extract:
      "The Mole had been working very hard all the morning, spring-cleaning his little home. First with brooms, then with dusters; then on ladders and steps and chairs, with a brush and a pail of whitewash; till he had dust in his throat and eyes, and splashes of whitewash all over his black fur, and an aching back and weary arms.",
    notes: [
      {
        anchor: "First with brooms, then with dusters",
        label: "a list",
        text: "so many jobs to do",
      },
      { anchor: "an aching back and weary arms", label: "how Mole feels", text: "worn out" },
    ],
  },
  tilbury: {
    stage: "ks3",
    form: "prose",
    from: "Elizabeth I, speech to her army at Tilbury, 1588",
    extract:
      "I know I have the body of a weak and feeble woman; but I have the heart and stomach of a king, and of a king of England too, and think foul scorn that Parma or Spain, or any prince of Europe, should dare to invade the borders of my realm.",
    notes: [
      { anchor: "heart and stomach of a king", label: "her claim", text: "as brave as any king" },
      {
        anchor: "dare to invade the borders of my realm",
        label: "her warning",
        text: "Spain must not invade",
      },
    ],
  },
  max: {
    stage: "ks3",
    form: "prose",
    from: "from A Christmas Carol, Charles Dickens (1843)",
    extract:
      "Oh! But he was a tight-fisted hand at the grindstone, Scrooge! a squeezing, wrenching, grasping, scraping, clutching, covetous, old sinner! Hard and sharp as flint, from which no steel had ever struck out generous fire; secret, and self-contained, and solitary as an oyster. The cold within him froze his old features, nipped his pointed nose, shrivelled his cheek, stiffened his gait; made his eyes red, his thin lips blue; and spoke out shrewdly in his grating voice. A frosty rime was on his head, and on his eyebrows, and his wiry chin.",
    notes: [
      { anchor: "tight-fisted", label: "idiom", text: "mean with money" },
      { anchor: "Hard and sharp as flint", label: "simile", text: "hard, with no spark" },
      { anchor: "solitary as an oyster", label: "simile", text: "shut away, alone" },
      { anchor: "A frosty rime", label: "cold imagery", text: "frost grows on him" },
    ],
  },
  domesday: {
    stage: "ks3",
    form: "picture",
    from: "A page of the Domesday Book, 1086 (The National Archives)",
    figure: { photo: "https://images.test/cow.jpg", alt: "A page of the Domesday Book" },
    notes: [
      { label: "who made it", text: "the king's clerks, in Latin" },
      { label: "what it lists", text: "land, people and animals" },
    ],
  },
};

/** `name`, the gold render it sits beside, its stage and its input. */
export const SOURCE_CASES: { name: string; gold: string; stage: Stage; input: TemplateInput }[] = [
  ["dickens", "so-dickens"],
  ["owen", "so-owen"],
  ["mole", "so-ks2-mole"],
  ["tilbury", "so-history"],
  ["max", "so-max"],
  ["domesday", "so-picture"],
  ["domesdayFail", "so-picture-fallback"],
  // KS1 within its cap (no gold render; the gold's KS1 sizes, ruling 91 steps).
  ["peter", ""],
].map(([name, gold]) => {
  const k =
    name === "domesdayFail"
      ? { ...(SLIDES.domesday as Case), figure: undefined }
      : (SLIDES[name as string] as Case);
  const { stage, ...rest } = k;
  return {
    name: name as string,
    gold: gold as string,
    stage,
    input: { template: "source", heading: "", ...rest } as TemplateInput,
  };
});
