// The audit's worst cases (flex audit, 8 Oct): each names what must be drawn as a card, what the slide
// must not say, or that the model must refuse.
export type Case = {
  preset?: string;
  id: string;
  label: string;
  params: Record<string, unknown>;
  mustCard?: string[];
  mustNotSay?: string[];
  expect?: "refused" | "drawn";
};
export const TARGETED: Case[] = [
  {
    id: "food_chain",
    label: "ocean: shark on the seal",
    expect: "drawn",
    mustCard: ["Shark"],
    mustNotSay: ["seal"],
    params: {
      title: "An ocean food chain",
      habitat: "ocean",
      mode: "chain",
      organisms: [
        { kind: "plankton", name: "Phytoplankton" },
        { kind: "zooplankton", name: "Krill" },
        { kind: "fish", name: "Mackerel" },
        { kind: "seal", name: "Shark" },
      ],
    },
  },
  {
    id: "life_cycle",
    label: "ladybird on the butterfly",
    expect: "drawn",
    mustCard: ["Ladybird"],
    mustNotSay: ["butterfly", "caterpillar", "chrysalis"],
    params: {
      title: "The life cycle of a ladybird",
      organism: "butterfly",
      text: {
        "label:name:butterfly": "Ladybird",
        "label:butterfly:eggs": "Eggs",
        "label:butterfly:caterpillar": "Larva",
        "label:butterfly:chrysalis": "Pupa",
        "label:butterfly:butterfly": "Ladybird",
      },
    },
  },
  {
    id: "forces_magnets",
    label: "friction: sledge on the car",
    expect: "drawn",
    mustCard: ["sledge"],
    mustNotSay: ["car"],
    params: {
      title: "Friction on a sledge",
      context: "friction",
      object: "sledge",
      motion: "right",
    },
  },
  {
    id: "community_helpers",
    label: "seaside: lifeguard and coastguard",
    expect: "drawn",
    mustCard: ["Lifeguard", "Coastguard"],
    mustNotSay: ["firefighter", "police officer"],
    params: {
      title: "People who help us at the seaside",
      helpers: [
        { role: "firefighter", name: "Lifeguard" },
        { role: "police", name: "Coastguard" },
      ],
      jobs: true,
    },
  },
  {
    id: "coordinate_grid",
    label: "the pirate on the robot",
    expect: "drawn",
    mustCard: ["pirate"],
    mustNotSay: ["robot"],
    preset: "rec-bee-forward",
    params: {
      title: "Help the pirate find the treasure",
      mover: { kind: "robot", name: "the pirate" },
    },
  },
  {
    id: "microhabitat_survey",
    label: "bug hotel: bees on the beetle, 9 woodlice kept",
    expect: "drawn",
    mustCard: ["Solitary bees"],
    mustNotSay: ["beetle"],
    params: {
      title: "Our bug hotel",
      creatures: [
        { kind: "beetle", name: "Solitary bees", count: 4 },
        { kind: "ladybird", name: "Ladybirds", count: 3 },
        { kind: "woodlouse", name: "Woodlice", count: 9 },
      ],
    },
  },
  {
    id: "rocks_soil_fossils",
    label: "coal shows plant fossils, not an ammonite",
    expect: "drawn",
    mustCard: ["Plant fossils"],
    params: {
      title: "Rocks and fossils",
      view: "rocks",
      rocks: [
        { name: "Basalt", type: "igneous" },
        { name: "Coal", type: "sedimentary", fossils: true },
        { name: "Limestone", type: "sedimentary", fossils: true },
        { name: "Marble", type: "metamorphic" },
      ],
    },
  },
  {
    id: "plant_growth",
    label: "a sunflower is not drawn as a bean",
    expect: "refused",
    params: { title: "A sunflower grows", view: "grow", plantName: "sunflower" },
  },
  {
    id: "evolution_adaptation",
    label: "Arctic hares keyed onto green beetles",
    expect: "refused",
    params: {
      title: "Arctic hares",
      organism: "beetle",
      pressure: "soil",
      text: { "label:end0": "White", "label:end1": "Brown" },
    },
  },
  {
    id: "sequences_patterns",
    label: "a green star called leaf",
    expect: "refused",
    params: {
      title: "What comes next?",
      kind: "repeating",
      unit: [
        { shape: "star", colour: "green", name: "leaf" },
        { shape: "circle", colour: "red", name: "red" },
      ],
    },
  },
  {
    id: "mixtures_separating",
    label: "filtering sugar water is refused, not swapped",
    expect: "refused",
    params: {
      title: "Can we filter sugar out of water?",
      mixture: "sugar-water",
      method: "filter",
    },
  },
  {
    id: "hist_map",
    label: "da Gama keeps the Cape",
    expect: "drawn",
    params: {
      title: "Vasco da Gama",
      region: "world",
      dates: "plain",
      dateRange: { from: "1400", to: "1600" },
      routes: [
        {
          who: "Vasco da Gama",
          label: "sails round Africa",
          date: "1497",
          from: "Lisbon",
          via: "Cape of Good Hope",
          to: "Calicut",
          colour: "1",
        },
      ],
    },
  },
  {
    id: "hist_map",
    label: "an unknown stop is refused, not dropped",
    expect: "refused",
    params: {
      title: "Cook",
      region: "world",
      dates: "plain",
      dateRange: { from: "1700", to: "1800" },
      routes: [
        {
          who: "Captain Cook",
          label: "sails",
          date: "1768",
          from: "Plymouth",
          via: "Rio de Janeiro, Tahiti",
          to: "Sydney",
          colour: "1",
        },
      ],
    },
  },
];
