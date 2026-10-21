import type { Figure, Stage, TemplateInput } from "./index";

/*
 * TEACH-75 part ae (C6): the picture-and-text gold's cases (`northstars-v13/picture-text/cases.js`)
 * as template inputs, for the tests and the browser review page. Photos are named by `p.jpg`.
 */
export const SVG = (w: number, h: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" class="slide tk" viewBox="0 0 ${w} ${h}"><g><rect width="90" height="90"/><text x="9" y="40">Bulb</text></g></svg>`,
  )}`;
export const photo = (aspect: number): Figure => ({ photo: "p.jpg", aspect, alt: "" });

export const PT_CASES: Record<string, { stage: Stage; input: TemplateInput }> = {
  "ks1-chick": {
    stage: "ks1",
    input: {
      template: "picture-text",
      heading: "A chick grows into a hen",
      accentWord: "hen",
      lead: "A chick hatches from an egg and grows into a hen.",
      figure: photo(1),
      pictureText: { icon: "chick" },
    },
  },
  "ks2-wrapping": {
    stage: "ks2",
    input: {
      template: "picture-text",
      heading: "Wrapping the mummy",
      accentWord: "mummy",
      lead: "Embalmers wrapped the dried body in hundreds of metres of linen.",
      points: [
        "They tucked amulets between the layers to protect the dead.",
        "They brushed the linen with resin to glue it in place.",
        "Wrapping one body could take fifteen days.",
      ],
      figure: photo(1.5),
      pictureText: { icon: "mummy" },
    },
  },
  "ks2-canopic-portrait": {
    stage: "ks2",
    input: {
      template: "picture-text",
      heading: "Canopic jars",
      accentWord: "jars",
      lead: "Embalmers kept the dead person's organs in four canopic jars.",
      points: [
        "Each jar held one organ: the liver, the lungs, the stomach or the intestines.",
        "Each lid showed one of the four sons of Horus, who guarded what was inside.",
      ],
      figure: photo(0.75),
      pictureText: { icon: "canopic-jar" },
    },
  },
  "ks3-composite": {
    stage: "ks3",
    input: {
      template: "picture-text",
      heading: "Why composite volcanoes explode",
      accentWord: "explode",
      lead: "Composite volcanoes form where an oceanic plate sinks beneath a continental plate.",
      points: [
        "The magma that rises is rich in silica, so it is thick and sticky and traps gas.",
        "Pressure builds beneath a plug of cooled rock until the vent gives way.",
        "The blast throws out ash, pumice and pyroclastic flows.",
      ],
      figure: photo(1.5),
      pictureText: { icon: "explosive-eruption" },
    },
  },
  "ks2-diagram-circuit": {
    stage: "ks2",
    input: {
      template: "picture-text",
      heading: "A bulb needs a complete circuit",
      accentWord: "circuit",
      lead: "Electricity can only flow round a complete loop.",
      points: ["If there is a gap anywhere in the loop, the bulb stays off."],
      figure: { drawn: { src: SVG(682, 512), aspect: 682 / 512, bare: true, alt: "Circuit" } },
      pictureText: {},
    },
  },
  "key-ks2-photosynthesis": {
    stage: "ks2",
    input: {
      template: "picture-text",
      heading: "How plants make food",
      lead: "Green leaves use sunlight to make food for the whole plant.",
      figure: photo(1),
      pictureText: {
        icon: "leaf-food",
        cards: [
          {
            kind: "word",
            label: "Key word",
            term: "photosynthesis",
            meaning: "The way a plant makes its own food from light, water and air.",
          },
        ],
      },
    },
  },
  "key-ks2-spelling": {
    stage: "ks2",
    input: {
      template: "picture-text",
      heading: "Adding -ing to words ending in e",
      pictureText: {
        cards: [
          {
            kind: "rule",
            label: "Spelling rule",
            term: "Drop the e",
            meaning: "When a word ends in e, take the e off before you add -ing.",
          },
          {
            kind: "examples",
            label: "Examples",
            examples: [
              ["make", "making"],
              ["hope", "hoping"],
              ["ride", "riding"],
            ],
          },
        ],
      },
    },
  },
  "key-ks2-magma-lava": {
    stage: "ks2",
    input: {
      template: "picture-text",
      heading: "Magma and lava",
      figure: photo(1.5),
      pictureText: {
        icon: "lava",
        cards: [
          {
            kind: "word",
            label: "Key word",
            term: "magma",
            meaning: "Melted rock under the ground.",
          },
          {
            kind: "word",
            label: "Key word",
            term: "lava",
            meaning: "Melted rock that has come out of a volcano.",
          },
        ],
      },
    },
  },
  "key-ks3-fact": {
    stage: "ks3",
    input: {
      template: "picture-text",
      heading: "Mount St Helens, 1980",
      lead: "An earthquake set off a landslide, and the volcano blew out sideways.",
      figure: photo(1),
      pictureText: {
        icon: "composite-volcano",
        cards: [
          {
            kind: "fact",
            label: "Key fact",
            num: "400",
            unit: "metres",
            meaning: "The eruption blew about 400 metres off the top of the mountain.",
          },
        ],
      },
    },
  },
};
// The gold's own KS3 text, past the measured word cap: laid in full and reported over.
PT_CASES["ks3-composite-gold-text"] = {
  stage: "ks3",
  input: {
    ...(PT_CASES["ks3-composite"]?.input as TemplateInput),
    lead: "Composite volcanoes form where an oceanic plate sinks beneath a continental plate and melts.",
    points: [
      "The magma that rises is rich in silica, so it is thick and sticky and traps gas as it climbs.",
      "Pressure builds beneath a plug of cooled rock until the vent gives way and the gas expands in an instant.",
      "The blast throws out ash, pumice and pyroclastic flows that race downhill at over 100 km/h.",
    ],
  },
};
PT_CASES["ks2-wrapping-nopic"] = {
  stage: "ks2",
  input: { ...(PT_CASES["ks2-wrapping"]?.input as TemplateInput), figure: undefined },
};
PT_CASES["ks1-chick-nopic-noicon"] = {
  stage: "ks1",
  input: { ...(PT_CASES["ks1-chick"]?.input as TemplateInput), figure: undefined, pictureText: {} },
};
