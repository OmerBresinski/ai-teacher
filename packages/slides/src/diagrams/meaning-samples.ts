/**
 * Round 8: the drawer's meaning-form specs (`meaning.ts`) and the new kinds, one per teaching
 * representation the round 1-7 census found forced into the wrong kind (round8/BUILD.md), most of
 * them the round 7 failures re-written as meaning (DIAGRAM-SOURCE C3). The corpus test draws every
 * one on every theme.
 */
export const MEANING_SAMPLES: Record<string, unknown> = {
  "equal-groups-quarter-of-12": {
    kind: "equal-groups",
    alt: "12 counters shared into 4 equal groups of 3.",
    total: 12,
    groups: 4,
  },
  "equal-groups-rows-unknown": {
    kind: "equal-groups",
    alt: "20 counters in 4 equal rows; how many in each row?",
    total: 20,
    groups: 4,
    layout: "rows",
    unknown: true,
  },
  "equal-groups-half-of-10": {
    kind: "equal-groups",
    alt: "10 counters shared into 2 equal groups of 5.",
    total: 10,
    groups: 2,
    show_count: "one",
  },
  "fraction-shapes-shade-the-parts": {
    kind: "fraction-shapes",
    alt: "Shape A is a circle cut in two halves, B a square cut in four quarters, C a rectangle cut in four quarters.",
    shapes: [
      { shape: "circle", parts: 2, shaded: 0, name: "A" },
      { shape: "square", parts: 4, cut: "grid", shaded: 0, name: "B" },
      { shape: "rectangle", parts: 4, cut: "vertical", shaded: 0, name: "C" },
    ],
  },
  "fraction-shapes-one-half": {
    kind: "fraction-shapes",
    alt: "A circle and a square, each cut into two equal parts with one part shaded.",
    shapes: [
      { shape: "circle", parts: 2, shaded: 1, name: "1/2" },
      { shape: "square", parts: 2, cut: "diagonal", shaded: 1, name: "1/2" },
    ],
  },
  "fraction-shapes-bar-fifths": {
    kind: "fraction-shapes",
    alt: "A bar cut into five equal parts with three shaded.",
    shapes: [{ shape: "bar", parts: 5, shaded: 3, name: "3/5" }],
  },
  "particles-identify-letters": {
    kind: "particles",
    alt: "Three particle panels, A, B and C, one for each state of matter.",
    show: "states",
    names: "letters",
    panels: [{ state: "gas" }, { state: "solid" }, { state: "liquid" }],
  },
  "particles-change-melting-boiling": {
    kind: "particles",
    alt: "A solid melts to a liquid, which evaporates to a gas.",
    show: "change",
    energy: "in",
    panels: [{ state: "solid" }, { state: "liquid" }, { state: "gas" }],
  },
  "particles-gas-squash": {
    kind: "particles",
    alt: "The same gas particles before and after a piston squashes them into less room.",
    show: "compare",
    panels: [
      { state: "gas", count: 10, caption: "Before" },
      { state: "gas", count: 10, squash: true, caption: "Squashed", note: "Closer together" },
    ],
  },
  "particles-collisions": {
    kind: "particles",
    alt: "Two collisions: one at low energy bounces apart, one at high energy reacts.",
    show: "collision",
    panels: [
      { state: "gas", outcome: "bounces", impact: "low", note: "Particles unchanged" },
      { state: "gas", outcome: "reacts", impact: "high", note: "Product forms" },
    ],
  },
  "particles-concentration-lump": {
    kind: "particles",
    alt: "A solid lump in a dilute and a concentrated acid: more acid particles meet the surface.",
    show: "compare",
    panels: [
      { state: "liquid", count: 6, solid: true, caption: "Dilute" },
      { state: "liquid", count: 12, solid: true, caption: "Concentrated" },
    ],
    names_of: { solid: "Marble" },
  },
  "flow-multi-store": {
    kind: "flow",
    alt: "The multi-store model: sensory register to short-term memory by attention, short-term to long-term by rehearsal, retrieval back, and loss by decay and displacement.",
    nodes: ["Sensory register", "Short-term memory", "Long-term memory"],
    links: [
      { from: 0, to: 1, label: "Attention" },
      { from: 1, to: 1, label: "Rehearsal" },
      { from: 1, to: 2, label: "Rehearsal" },
      { from: 2, to: 1, label: "Retrieval" },
      { from: 0, to: "out", label: "Decay" },
      { from: 1, to: "out", label: "Displacement" },
    ],
  },
  "flow-zero-product": {
    kind: "flow",
    alt: "(x + 3)(x − 4) = 0 branches into x + 3 = 0, giving x = −3, and x − 4 = 0, giving x = 4.",
    nodes: ["(x + 3)(x − 4) = 0", "x + 3 = 0", "x − 4 = 0", "x = −3", "x = 4"],
    links: [
      { from: 0, to: 1 },
      { from: 0, to: 2 },
      { from: 1, to: 3 },
      { from: 2, to: 4 },
    ],
  },
  "flow-chain": {
    kind: "flow",
    alt: "Occupation of the Ruhr leads to strikes, then printing money, then hyperinflation.",
    nodes: ["Ruhr occupied", "Workers strike", "Government prints money", "Hyperinflation"],
    links: [
      { from: 0, to: 1 },
      { from: 1, to: 2, label: "pays strikers" },
      { from: 2, to: 3 },
    ],
  },
  "flow-cycle": {
    kind: "flow",
    alt: "The water cycle: evaporation, condensation, precipitation, collection.",
    nodes: ["Evaporation", "Condensation", "Precipitation", "Collection"],
    links: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 0 },
    ],
  },
  "bar-model-quarter-of-28": {
    kind: "bar-model",
    alt: "A bar of 28 split into 4 equal parts of 7, with 3 parts shaded.",
    bars: [{ whole: 28, parts: 4, shaded: 3 }],
  },
  "bar-model-money-compare": {
    kind: "bar-model",
    alt: "Amy has £12 in 3 equal parts; Ben has £8 in 2; together £20.",
    bars: [
      { label: "Amy", whole: 12, parts: 3, unit: "£" },
      { label: "Ben", whole: 8, parts: 2, unit: "£" },
    ],
    combined: true,
  },
  "timeline-roman-dates": {
    kind: "timeline",
    alt: "Caesar's raids in 55 and 54 BC and Claudius's invasion in AD 43, spaced by date.",
    events: [
      { date: "AD 43", text: "Claudius invades" },
      { date: "55 BC", text: "Caesar's first raid" },
      { date: "54 BC", text: "Caesar's second raid" },
    ],
    period: { from: "55 BC", to: "54 BC", label: "Caesar's raids" },
  },
  "timeline-1923-months": {
    kind: "timeline",
    alt: "Events of 1923 by month.",
    events: [
      { date: "January 1923", text: "Ruhr occupied" },
      { date: "August 1923", text: "Stresemann chancellor" },
      { date: "November 1923", text: "Rentenmark" },
    ],
  },
};
