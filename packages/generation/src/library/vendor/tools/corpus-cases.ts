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
  // round 2 (9 Oct): fixes found by rendering each case and looking
  {
    id: "number_line",
    label: "r2: four jumps back and forth over one stretch are refused, not piled up",
    expect: "refused",
    preset: "y1-count-on",
    params: {
      jumps: [
        { from: "7", to: "10" },
        { from: "10", to: "7" },
        { from: "7", to: "10" },
        { from: "10", to: "7" },
      ],
    },
  },
  {
    id: "number_line",
    label: "r2: three jumps over one stretch still draw, each at its own height",
    expect: "drawn",
    preset: "y1-count-on",
    params: {
      jumps: [
        { from: "7", to: "10" },
        { from: "10", to: "7" },
        { from: "7", to: "10" },
      ],
    },
  },
  {
    id: "sort_venn_carroll",
    label: "r2: the same rule twice is refused",
    expect: "refused",
    preset: "y5-mult-3-4",
    params: {
      rules: [
        { label: "Multiples of 3" },
        { label: "Multiples of 4" },
        { label: "multiples of 3" },
      ],
    },
  },
  {
    id: "sort_venn_carroll",
    label: "r2: three apart hoops squeezed tiny by 12 outside things are refused",
    expect: "refused",
    preset: "y2-odd-even",
    params: {
      diagram: "hoops",
      cards: "words",
      rules: [{ label: "Basking shark" }, { label: "Hedgehog" }, { label: "Lifeguard" }],
      items: [
        "Sledge",
        "Kangaroo",
        "Pirate",
        "Dragonfly",
        "Sunflower",
        "Lifeguard",
        "Kangaroo",
        "Pirate",
        "Basking shark",
        "Hedgehog",
        "Dragonfly",
        "Sunflower",
      ].map((label) => ({ label, r1: "no", r2: "no", r3: "no" })),
    },
  },
  {
    id: "sort_venn_carroll",
    label: "r2: three apart hoops with long rule names draw",
    expect: "drawn",
    preset: "y2-odd-even",
    params: {
      diagram: "hoops",
      cards: "words",
      rules: [
        { label: "Lives in the water" },
        { label: "Has wings to fly" },
        { label: "Has fur all over" },
      ],
      items: [
        ["Shark", 1],
        ["Crab", 1],
        ["Owl", 2],
        ["Bee", 2],
        ["Fox", 3],
        ["Rabbit", 3],
        ["Snail", 0],
      ].map(([label, k]) => ({
        label,
        r1: k === 1 ? "yes" : "no",
        r2: k === 2 ? "yes" : "no",
        r3: k === 3 ? "yes" : "no",
      })),
    },
  },
  {
    id: "column_methods",
    label: "r2: seven columns leave the counters off, so the digits stay readable",
    expect: "drawn",
    preset: "y3-compact-add",
    params: { a: 99999.99, b: 99999.99 },
  },
  {
    id: "volcano_earthquake",
    label: "r2: a squeezed chamber label moves rather than split a word",
    expect: "drawn",
    preset: "y6-iceland",
    params: { layers: [{ label: "Basking shark" }, { label: "Hedgehog" }] },
  },
  {
    id: "rhythm_grid",
    label: "r2: four bars with a keyboard never claim the rhythm is still shown",
    expect: "drawn",
    preset: "y5-c-major",
    mustNotSay: ["played to a rhythm over"],
    params: {
      bars: 4,
      rhythm: [
        { cells: "ta ta ta ta" },
        { cells: "ta ta ta ta" },
        { cells: "ta ta ta ta" },
        { cells: "ta ta ta ta" },
      ],
    },
  },
  {
    id: "plant_growth",
    label: "r2: the stalk-in-water summary never claims roots or flowers it does not draw",
    expect: "drawn",
    preset: "y3-transport",
    mustNotSay: ["leaves and flowers"],
    params: {},
  },
  {
    id: "plant_growth",
    label: "r2: an off-menu name on the parts picture is refused",
    expect: "refused",
    preset: "y3-parts",
    params: { plantName: "Basking shark" },
  },
  {
    id: "sound_vibration",
    label: "r2: an ear close by wraps the travel label instead of cutting it",
    expect: "drawn",
    preset: "y4-further-away",
    params: {},
  },
];
