/**
 * Round I: specs for every template as a writer would fill them, the short and the long, plus the
 * bar model and number line kinds the templates keep. The tests draw each on every theme and slot;
 * the gallery script draws them for a look.
 */
import type { DiagramSpecInput } from "./schema";

export const TEMPLATE_SPECS: Record<string, DiagramSpecInput> = {
  // r4 (external review of y11): temperature, collision outcome, concentration, surface area.
  "particles-temperature": {
    kind: "particles",
    alt: "Gas particles at 20 °C and 80 °C",
    show: "compare",
    panels: [
      { state: "gas", count: 10, energy: 20 },
      { state: "gas", count: 10, energy: 80 },
    ],
    captions: ["20 °C", "80 °C"],
    notes: ["Slower", "Faster"],
  },
  "particles-collision": {
    kind: "particles",
    alt: "Collisions with and without enough energy",
    show: "collision",
    outcomes: ["bounces", "reacts"],
    captions: ["Low energy", "High energy"],
  },
  "particles-concentration": {
    kind: "particles",
    alt: "Lower and higher concentration",
    show: "compare",
    panels: [
      { state: "liquid", count: 9, extra: 3 },
      { state: "liquid", count: 9, extra: 9 },
    ],
    captions: ["Dilute", "Concentrated"],
    key: ["Water", "Acid"],
  },
  "cubes-surface-area": {
    kind: "cubes",
    alt: "One cube beside the same volume cut into eight small cubes",
    split: 2,
    areas: true,
  },
  "particles-three": {
    kind: "particles",
    alt: "Particles in a solid, a liquid and a gas.",
    title: "Arrangement of particles",
    states: ["solid", "liquid", "gas"],
    notes: ["fixed rows, vibrate", "touching, slide past", "far apart, fast"],
    motion: true,
  },
  "particles-arrows": {
    kind: "particles",
    alt: "Solid melts to liquid, liquid boils to gas.",
    states: ["solid", "liquid", "gas"],
    arrows: ["melting", "boiling"],
  },
  "particles-two": {
    kind: "particles",
    alt: "Ice and liquid water particles.",
    states: ["solid", "liquid"],
    captions: ["Ice", "Liquid water"],
    notes: ["regular pattern, touching", "random, still touching"],
    arrows: ["melting"],
  },
  "particles-one": {
    kind: "particles",
    alt: "Gas particles moving fast in all directions.",
    states: ["gas"],
    captions: ["A gas"],
    notes: ["spread out, move fast"],
    motion: true,
  },
  "particles-diffusion": {
    kind: "particles",
    alt: "Two gases mix by diffusion.",
    title: "Diffusion",
    show: "diffusion",
    key: ["Bromine", "Air"],
    notes: ["bromine on one side", "mixed evenly"],
  },
  "particles-dissolving": {
    kind: "particles",
    alt: "Sugar dissolving in water.",
    show: "dissolving",
    key: ["Water", "Sugar"],
    captions: ["Sugar added", "Dissolved"],
  },
  "hydrograph-flashy": {
    kind: "hydrograph",
    alt: "Storm hydrograph with a short lag time and high peak.",
    title: "Storm hydrograph",
    shape: "flashy",
  },
  "hydrograph-gentle-values": {
    kind: "hydrograph",
    alt: "Storm hydrograph: peak rainfall 12 mm, peak discharge 40 cumecs, lag 18 hours.",
    title: "River Wye after a storm",
    shape: "gentle",
    values: { peakRainfall: 12, peakDischarge: 40, baseFlow: 8, lagHours: 18 },
  },
  "hydrograph-flashy-values": {
    kind: "hydrograph",
    alt: "Urban river hydrograph.",
    shape: "flashy",
    values: { peakRainfall: 20, peakDischarge: 150, lagHours: 6 },
    marks: ["peak-rainfall", "peak-discharge", "lag-time"],
  },
  "timeline-romans": {
    kind: "timeline",
    alt: "Roman Britain from 55 BC to AD 410.",
    title: "Roman Britain",
    events: [
      { date: "55 BC", text: "Julius Caesar lands" },
      { date: "AD 43", text: "Claudius invades Britain" },
      { date: "AD 60", text: "Boudicca's revolt" },
      { date: "AD 122", text: "Hadrian's Wall begun" },
      { date: "AD 410", text: "Romans leave Britain" },
    ],
    period: { from: 2, to: 5, label: "Roman rule" },
  },
  "timeline-seven": {
    kind: "timeline",
    alt: "Weimar Republic 1918 to 1933.",
    events: [
      { date: "1918", text: "Kaiser abdicates and the war ends" },
      { date: "1919", text: "Treaty of Versailles signed" },
      { date: "1920", text: "Kapp Putsch in Berlin" },
      { date: "1923", text: "Hyperinflation and the Munich Putsch" },
      { date: "1924", text: "Dawes Plan brings loans" },
      { date: "1929", text: "Wall Street Crash" },
      { date: "1933", text: "Hitler becomes Chancellor" },
    ],
  },
  "timeline-three": {
    kind: "timeline",
    alt: "Three events.",
    events: [
      { date: "1066", text: "Battle of Hastings" },
      { date: "1086", text: "Domesday Book" },
      { date: "1215", text: "Magna Carta" },
    ],
  },
  "layers-earth": {
    kind: "layers",
    alt: "Layers of the Earth.",
    title: "Structure of the Earth",
    layers: [
      { label: "Crust", thickness: 1 },
      { label: "Mantle", thickness: 3 },
      { label: "Outer core (liquid)", thickness: 2 },
      { label: "Inner core (solid)", thickness: 2 },
    ],
  },
  "layers-six": {
    kind: "layers",
    alt: "Soil profile.",
    layers: [
      { label: "Leaf litter" },
      { label: "Topsoil" },
      { label: "Subsoil" },
      { label: "Weathered rock" },
      { label: "Bedrock" },
      { label: "Groundwater in the rock" },
    ],
  },
  "cycle-water": {
    kind: "cycle",
    alt: "The water cycle.",
    title: "The water cycle",
    steps: ["Evaporation", "Condensation", "Precipitation", "Collection"],
  },
  "cycle-states": {
    kind: "cycle",
    alt: "Changes of state.",
    steps: ["Solid", "Liquid", "Gas"],
  },
  "cycle-five": {
    kind: "cycle",
    alt: "Rock cycle in five steps.",
    steps: [
      "Weathering breaks rock",
      "Erosion carries sediment",
      "Deposition in layers",
      "Compaction and cementation",
      "Uplift exposes rock",
    ],
  },
  "river-v-valley": {
    kind: "river",
    alt: "Cross-section of a V-shaped valley in the upper course.",
    title: "Upper course: V-shaped valley",
    view: "v-valley",
    labels: [
      { part: "valley-side", text: "Steep valley side" },
      { part: "channel", text: "Narrow channel" },
      { part: "vertical-erosion", text: "Vertical erosion" },
    ],
  },
  "river-meander-section": {
    kind: "river",
    alt: "Cross-section of a meander.",
    view: "meander-section",
    labels: [
      { part: "river-cliff", text: "River cliff" },
      { part: "slip-off-slope", text: "Slip-off slope" },
      { part: "fastest-flow", text: "Fastest flow" },
      { part: "erosion", text: "Erosion" },
      { part: "deposition", text: "Deposition" },
    ],
  },
  "river-meander-plan": {
    kind: "river",
    alt: "A meander seen from above.",
    title: "A meander from above",
    view: "meander-plan",
    labels: [
      { part: "outer-bank", text: "Outer bank: erosion" },
      { part: "inner-bank", text: "Inner bank: deposition" },
      { part: "fastest-flow", text: "Fastest flow" },
      { part: "flow-direction", text: "Flow" },
    ],
  },
  "bar-model-ratio": {
    kind: "bar-model",
    alt: "Share 60 in the ratio 3 to 2.",
    title: "Share £60 in the ratio 3 : 2",
    bars: [
      { label: "Amy", parts: [{ label: "£12" }, {}, {}], total: "£36" },
      { label: "Ben", parts: [{ label: "£12" }, {}], total: "£24" },
    ],
    combined: "£60",
  },
  "bar-model-part-whole": {
    kind: "bar-model",
    alt: "Three fifths of 40.",
    bars: [
      {
        parts: [
          { label: "8", shaded: true },
          { label: "8", shaded: true },
          { label: "8", shaded: true },
          { label: "8" },
          { label: "8" },
        ],
        total: "40",
      },
    ],
  },
  "bar-model-compare": {
    kind: "bar-model",
    alt: "Comparison: Sam has 3 more than Kim.",
    bars: [
      {
        label: "Sam",
        parts: [
          { value: 5, label: "5" },
          { value: 3, label: "3 more", shaded: true },
        ],
      },
      { label: "Kim", parts: [{ value: 5, label: "5" }] },
    ],
  },
  "number-line-jumps": {
    kind: "number-line",
    alt: "Counting on from 27 to 45.",
    min: 20,
    max: 50,
    step: 5,
    points: [
      { value: 27, label: "27" },
      { value: 45, label: "45" },
    ],
    jumps: [
      { from: 27, to: 30, label: "+3" },
      { from: 30, to: 40, label: "+10" },
      { from: 40, to: 45, label: "+5" },
    ],
  },
  "number-line-negative": {
    kind: "number-line",
    alt: "Number line from -5 to 5.",
    title: "Negative numbers",
    min: -5,
    max: 5,
    step: 1,
    points: [
      { value: -3, label: "−3" },
      { value: 2, label: "2" },
    ],
  },
};
