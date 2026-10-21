/**
 * Stages stress cases (TEACH-75 part ac): the gold's `northstars-v12/stages-arrows/cases.js`, as the
 * writer and image step would hand them over, plus the picture variants the gold renders.
 */
import type { Figure, Stage, StageItem, TemplateInput } from "./index";

export const STAGE_PHOTO = "https://images.test/stage.jpg";
const pic = (alt: string): Figure => ({ photo: STAGE_PHOTO, alt, aspect: 4 / 3 });

export type StageCase = { name: string; stage: Stage; input: TemplateInput };

const base: Record<string, { stage: Stage; heading: string; stages: StageItem[] }> = {
  "y2-river-3-short": {
    stage: "ks1",
    heading: "Where a river goes",
    stages: [
      { name: "Starts", line: "Up in the hills.", icon: "mountain-spring" },
      { name: "Falls", line: "Over the rocks.", icon: "waterfall" },
      { name: "Ends", line: "In the sea.", icon: "estuary" },
    ],
  },
  "y2-bread-3-long": {
    stage: "ks1",
    heading: "From wheat to bread",
    stages: [
      {
        name: "Grow",
        line: "Farmers grow wheat in big fields all through the summer.",
        icon: "wheat",
      },
      {
        name: "Grind",
        line: "A mill grinds the wheat seeds into soft white flour.",
        icon: "flour",
      },
      { name: "Bake", line: "Bakers mix the dough and bake it in a very hot oven.", icon: "oven" },
    ],
  },
  "y5-fossil-4": {
    stage: "ks2",
    heading: "How a fossil forms",
    stages: [
      { name: "Dies", line: "An animal dies and sinks to the seabed.", icon: "fish" },
      { name: "Buried", line: "Layers of mud and sand cover it.", icon: "rock-layers" },
      { name: "Replaced", line: "Minerals slowly replace the bones.", icon: "fossil" },
      {
        name: "Uncovered",
        line: "Rock wears away and the fossil is found.",
        icon: "magnifying-glass",
      },
    ],
  },
  "y5-fossil-5": {
    stage: "ks2",
    heading: "How a fossil forms",
    stages: [
      { name: "Lives", line: "A fish swims in an ancient sea.", icon: "fish" },
      { name: "Dies", line: "Its soft body rots, leaving bones.", icon: "fish-skeleton" },
      { name: "Buried", line: "Mud and sand cover the bones.", icon: "rock-layers" },
      { name: "Turns to stone", line: "Minerals replace the bones.", icon: "fossil" },
      { name: "Found", line: "Rock wears away and we find it.", icon: "magnifying-glass" },
    ],
  },
  "y5-bread-5": {
    stage: "ks2",
    heading: "From wheat to bread",
    stages: [
      { name: "Grow", line: "Farmers sow wheat in autumn.", icon: "wheat" },
      { name: "Harvest", line: "Combines cut the ripe wheat.", icon: "combine-harvester" },
      { name: "Mill", line: "Mills grind the grain into flour.", icon: "flour" },
      { name: "Bake", line: "Bakers mix, prove and bake.", icon: "oven" },
      { name: "Sell", line: "Shops sell the bread.", icon: "bakery" },
    ],
  },
  "y8-river-4": {
    stage: "ks3",
    heading: "A river from source to mouth",
    stages: [
      {
        name: "Source",
        line: "Rain and springs feed small streams high in the hills.",
        icon: "mountain-spring",
      },
      {
        name: "Waterfall",
        line: "Water erodes soft rock under a hard band, leaving a step.",
        icon: "waterfall",
      },
      { name: "Meander", line: "On flatter land the river swings in wide bends.", icon: "meander" },
      {
        name: "Mouth",
        line: "The river widens into an estuary and meets the sea.",
        icon: "estuary",
      },
    ],
  },
  "y9-bill-6": {
    stage: "ks3",
    heading: "How a bill becomes law",
    stages: [
      { name: "Drafted", line: "Ministers write the bill and publish it.", icon: "scroll" },
      {
        name: "Debated",
        line: "MPs debate its main ideas in the Commons.",
        icon: "speech-bubbles",
      },
      { name: "Amended", line: "A committee checks it line by line.", icon: "pen" },
      { name: "Voted", line: "The Commons votes on the final version.", icon: "ballot-box" },
      { name: "Revised", line: "The Lords check it and suggest changes.", icon: "portcullis" },
      { name: "Royal Assent", line: "The monarch signs and it becomes law.", icon: "crown" },
    ],
  },
  "y9-bill-6-over": {
    stage: "ks3",
    heading: "How a bill becomes law",
    stages: [
      {
        name: "Drafted",
        line: "Government ministers and their lawyers write the bill and publish it for all MPs.",
        icon: "scroll",
      },
      {
        name: "Debated",
        line: "MPs argue about its main ideas at the second reading in the House of Commons.",
        icon: "speech-bubbles",
      },
      {
        name: "Amended",
        line: "A small committee of MPs goes through the bill line by line and changes it.",
        icon: "pen",
      },
      {
        name: "Voted",
        line: "At the third reading the whole Commons votes on the final version of the bill.",
        icon: "ballot-box",
      },
      {
        name: "Revised",
        line: "The House of Lords checks the bill again and sends changes back to the MPs.",
        icon: "portcullis",
      },
      {
        name: "Royal Assent",
        line: "The monarch signs the bill, and from that day it becomes an Act of Parliament.",
        icon: "crown",
      },
    ],
  },
  "y9-river-6-miss": {
    stage: "ks3",
    heading: "Landforms from source to mouth",
    stages: [
      {
        name: "Source",
        line: "Springs and rain start it on high ground.",
        icon: "mountain-spring",
      },
      {
        name: "V-shaped valley",
        line: "It cuts down, so the sides are steep.",
        icon: "v-shaped-valley",
      },
      { name: "Waterfall", line: "Soft rock wears back under hard rock.", icon: "waterfall" },
      { name: "Meander", line: "It erodes the outside of each bend.", icon: "meander" },
      { name: "Ox-bow lake", line: "A flood cuts the neck off a bend.", icon: "oxbow-lake" },
      { name: "Estuary", line: "It widens and drops mud by the sea.", icon: "estuary" },
    ],
  },
};

const make = (name: string, key: string, pics?: string): StageCase => {
  const b = base[key] as (typeof base)[string];
  return {
    name,
    stage: b.stage,
    input: {
      template: "stages",
      heading: b.heading,
      stages: b.stages.map((s, i) => (pics?.[i] === "1" ? { ...s, picture: pic(s.name) } : s)),
    },
  };
};

/** The gold's eleven renders (`renders/block/01`-`11`). */
export const STAGE_CASES: StageCase[] = [
  make("01-y2-river-3-short", "y2-river-3-short"),
  make("02-y2-bread-3-long", "y2-bread-3-long"),
  make("03-y5-fossil-4", "y5-fossil-4"),
  make("04-y5-fossil-5", "y5-fossil-5"),
  make("05-y5-bread-5-icons", "y5-bread-5"),
  make("06-y5-bread-5-pictures", "y5-bread-5", "11111"),
  make("07-y5-bread-5-two-pics-failed", "y5-bread-5", "10110"),
  make("08-y8-river-4", "y8-river-4"),
  make("09-y9-bill-6", "y9-bill-6"),
  make("10-y9-river-6-icons-missing", "y9-river-6-miss"),
  make("11-y9-bill-6-over", "y9-bill-6-over"),
];
