/**
 * One fixture slide per activity template at KS1 and at KS4 (TEACH-101 part b): the unit tests lay
 * them out, and the e2e and screenshot specs seed them as lessons with real cached photos
 * (`apps/web/e2e/fixtures/activities/<name>.jpg`, served from `/files/act/<name>.jpg`).
 * The label diagrams are drawn SVGs (a label activity never points at a photo).
 */
import type { PhotoSource } from "@tj/domain/documents";
import type { Stage, TemplateInput } from "./index";

/** A fixture photo as served: its url, its own shape and its real credit. */
export type FixturePhoto = { src: string; aspect?: number; source?: PhotoSource };

export type ActivityFixture = { name: string; stage: Stage; input: TemplateInput };

const svg = (body: string, w: number, h: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`,
  )}`;

/** A flowering plant: petals, stem, leaf, roots (KS1). */
export const PLANT_SVG = svg(
  `<rect x="0" y="300" width="400" height="120" fill="#c9a27a"/>
  <path d="M200 300 C 200 240, 198 200, 200 120" stroke="#3f8f3a" stroke-width="10" fill="none"/>
  <path d="M200 230 C 250 200, 290 210, 310 240 C 270 260, 230 255, 200 230 Z" fill="#5fb85a"/>
  <g fill="#f2a7c3">${[0, 60, 120, 180, 240, 300]
    .map((a) => `<ellipse cx="200" cy="80" rx="22" ry="40" transform="rotate(${a} 200 110)"/>`)
    .join("")}</g>
  <circle cx="200" cy="110" r="22" fill="#f4c542"/>
  <path d="M200 300 L 170 360 M200 300 L 205 380 M200 300 L 235 355 M185 330 L 160 340 M215 330 L 245 335" stroke="#7a4e2a" stroke-width="5" fill="none"/>`,
  400,
  420,
);

/** An animal cell: membrane, cytoplasm, nucleus, mitochondria (KS4). */
export const CELL_SVG = svg(
  `<ellipse cx="250" cy="180" rx="230" ry="160" fill="#fde9d9" stroke="#c0704a" stroke-width="6"/>
  <circle cx="230" cy="170" r="62" fill="#b9a3e3" stroke="#6b4fb0" stroke-width="4"/>
  <circle cx="240" cy="160" r="18" fill="#6b4fb0"/>
  <g fill="#f29b6b" stroke="#b5552a" stroke-width="3">
    <ellipse cx="380" cy="120" rx="34" ry="16" transform="rotate(-20 380 120)"/>
    <ellipse cx="120" cy="250" rx="34" ry="16" transform="rotate(25 120 250)"/>
  </g>
  <g fill="#7fb7d9"><circle cx="360" cy="250" r="5"/><circle cx="372" cy="262" r="5"/><circle cx="348" cy="262" r="5"/><circle cx="110" cy="110" r="5"/><circle cx="124" cy="100" r="5"/></g>`,
  500,
  360,
);

/**
 * `photo(name)` gives each named photo's url, shape and credit. One KS4 card (the group sort's
 * "Heavy rain") has no picture on purpose: it shows the word-only fallback a failed card takes.
 */
export function activityFixtures(photo: (name: string) => FixturePhoto): ActivityFixture[] {
  const picture = (name: string, text: string) => {
    const p = photo(name);
    return {
      photo: p.src,
      alt: text,
      request: text,
      ...(p.aspect ? { aspect: p.aspect } : {}),
      ...(p.source ? { source: p.source } : {}),
    };
  };
  const card = (text: string, name: string, group?: number) => ({
    text,
    figure: picture(name, text),
    ...(group === undefined ? {} : { group }),
  });
  return [
    {
      name: "pair",
      stage: "ks1",
      input: {
        template: "pair",
        heading: "Who is the baby of each animal?",
        lead: "Write the letter and the number that go together.",
        cards: [
          card("calf", "cow"),
          card("puppy", "dog"),
          card("tadpole", "frog"),
          card("lamb", "sheep"),
        ],
      },
    },
    {
      name: "pair",
      stage: "ks4",
      input: {
        template: "pair",
        heading: "Match each Roman site to its name",
        cards: [
          card("Hadrian's Wall", "hadrian"),
          card("Vindolanda fort", "vindolanda"),
          card("Mosaic floor", "mosaic"),
          card("Roman baths", "great-bath"),
        ],
      },
    },
    {
      name: "group-sort",
      stage: "ks1",
      input: {
        template: "group-sort",
        heading: "Bird or mammal?",
        groups: ["Bird", "Mammal"],
        cards: [
          card("duck", "duck", 0),
          card("chicks", "chicks", 0),
          card("dog", "dog", 1),
          card("cow", "cow", 1),
          card("sheep", "sheep", 1),
          card("lamb", "lamb", 1),
        ],
      },
    },
    {
      name: "group-sort",
      stage: "ks4",
      input: {
        template: "group-sort",
        heading: "Sort the flood cards: cause, effect or response?",
        groups: ["Cause", "Effect", "Response"],
        cards: [
          { text: "Heavy rain", group: 0 },
          card("Snow melts", "icicle", 0),
          card("Homes cut off", "upton-flood", 1),
          card("Roads flooded", "york-flood", 1),
          card("Barrier shuts", "thames-barrier", 2),
          card("Clean-up", "boscastle", 2),
        ],
      },
    },
    {
      name: "sequence",
      stage: "ks1",
      input: {
        template: "sequence",
        heading: "Put the frog's life in order",
        lead: "Write the letters in order on your board.",
        cards: [
          card("tiny tadpoles", "tadpoles-small"),
          card("tadpoles swimming", "tadpoles-pond"),
          card("bigger tadpole", "tadpole-big"),
          card("frog", "frog"),
        ],
      },
    },
    {
      name: "sequence",
      stage: "ks4",
      input: {
        template: "sequence",
        heading: "Order the stages of a river flood",
        cards: [
          card("River rises in the fields", "river-trees"),
          card("Water bursts the banks", "river-city"),
          card("Streets under water", "york-flood"),
          card("The clean-up begins", "boscastle"),
        ],
      },
    },
    {
      name: "choose",
      stage: "ks1",
      input: {
        template: "choose",
        heading: "Which one is a baby animal?",
        correct: 1,
        explanation: "The lamb is a baby sheep.",
        cards: [card("lamb", "lamb"), card("cow", "cow"), card("dog", "dog"), card("duck", "duck")],
      },
    },
    {
      name: "choose",
      stage: "ks4",
      input: {
        template: "choose",
        heading: "Which is a hard-engineering flood defence?",
        correct: 1,
        explanation: "The Thames Barrier is built to hold back a tidal surge.",
        cards: [
          card("Thames Barrier", "thames-barrier"),
          card("Trees on the floodplain", "river-trees"),
          card("Clean-up crews", "boscastle"),
        ],
      },
    },
    {
      name: "odd-one-out",
      stage: "ks1",
      input: {
        template: "odd-one-out",
        heading: "Which is the odd one out?",
        correct: 2,
        explanation: "The duck has feathers and two legs. Other good reasons can be right too.",
        cards: [
          card("sheep", "sheep"),
          card("duck", "duck"),
          card("cow", "cow"),
          card("dog", "dog"),
        ],
      },
    },
    {
      name: "odd-one-out",
      stage: "ks4",
      input: {
        template: "odd-one-out",
        heading: "Which is the odd one out?",
        lead: "Say why. More than one answer can be right.",
        correct: 4,
        explanation: "The banknote is from 1920s Germany; the others are Roman Britain.",
        cards: [
          card("Hadrian's Wall", "hadrian"),
          card("Vindolanda fort", "vindolanda"),
          card("Calleva town wall", "silchester"),
          card("A 1923 banknote", "rentenmark"),
        ],
      },
    },
    {
      name: "label",
      stage: "ks1",
      input: {
        template: "label",
        heading: "Label the parts of a plant",
        figure: { drawn: { src: PLANT_SVG, aspect: 400 / 420, alt: "A flowering plant" } },
        targets: [
          { x: 0.5, y: 0.17, text: "flower" },
          { x: 0.7, y: 0.55, text: "leaf" },
          { x: 0.5, y: 0.45, text: "stem" },
          { x: 0.45, y: 0.85, text: "roots" },
        ],
        extra: ["seed"],
      },
    },
    {
      name: "label",
      stage: "ks4",
      input: {
        template: "label",
        heading: "Label the animal cell",
        lead: "One word in the bank is not needed.",
        figure: { drawn: { src: CELL_SVG, aspect: 500 / 360, alt: "An animal cell" } },
        targets: [
          { x: 0.48, y: 0.44, text: "nucleus" },
          { x: 0.76, y: 0.33, text: "mitochondrion" },
          { x: 0.5, y: 0.05, text: "cell membrane" },
          { x: 0.72, y: 0.72, text: "ribosomes" },
          { x: 0.3, y: 0.8, text: "cytoplasm" },
        ],
        extra: ["cell wall"],
      },
    },
  ];
}
