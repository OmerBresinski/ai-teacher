/**
 * One realistic spec per kind (and a second for the kinds with two shapes of use), as a writer
 * would fill them. The snapshot tests and the visual page draw these.
 */
import type { DiagramSpecInput } from "./schema";

export const DIAGRAM_SAMPLES: Record<string, DiagramSpecInput> = {
  "bar-model-ratio": {
    kind: "bar-model",
    alt: "Bar model: Amy's share is 3 parts and Ben's is 2 parts; together they are £60.",
    title: "Share £60 in the ratio 3 : 2",
    bars: [
      { label: "Amy", parts: [{ label: "£12" }, {}, {}], total: "£36" },
      { label: "Ben", parts: [{ label: "£12" }, {}], total: "£24" },
    ],
    combined: "£60",
  },
  "bar-model-fraction": {
    kind: "bar-model",
    alt: "A bar split into five equal parts with three shaded: three fifths of 40 is 24.",
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
  "line-graph-heating": {
    kind: "line-graph",
    alt: "Heating curve for water: temperature rises, stays at 0 °C while melting, rises, stays at 100 °C while boiling.",
    title: "Heating curve of water",
    x: { label: "Time (minutes)", min: 0, max: 20, step: 5 },
    y: { label: "Temperature (°C)", min: -20, max: 120, step: 20 },
    series: [
      {
        points: [
          [0, -20],
          [2, 0],
          [6, 0],
          [12, 100],
          [18, 100],
          [20, 115],
        ],
      },
    ],
    segments: [
      { from: 2, to: 6, label: "melting" },
      { from: 12, to: 18, label: "boiling" },
    ],
  },
  "line-graph-hydrograph": {
    kind: "line-graph",
    alt: "Storm hydrograph: rainfall peaks at hour 6, river discharge peaks later at hour 14; the gap is the lag time.",
    x: { label: "Time (hours)", min: 0, max: 30, step: 6 },
    y: { label: "Discharge (m³/s)", min: 0, max: 40, step: 10 },
    y2: { label: "Rainfall (mm)", min: 0, max: 20, step: 5 },
    series: [
      {
        label: "Rainfall",
        style: "bars",
        axis: "right",
        points: [
          [2, 2],
          [4, 8],
          [6, 16],
          [8, 10],
          [10, 4],
          [12, 1],
        ],
      },
      {
        label: "Discharge",
        points: [
          [0, 8],
          [6, 9],
          [10, 20],
          [14, 34],
          [18, 24],
          [24, 14],
          [30, 10],
        ],
      },
    ],
    annotations: [
      { x: 14, y: 34, label: "peak discharge" },
      { x: 6, y: 32, label: "peak rainfall" },
    ],
  },
  "flow-cycle": {
    kind: "flow",
    alt: "The water cycle: evaporation, condensation, precipitation, collection, and back to evaporation.",
    layout: "cycle",
    steps: [
      { label: "Evaporation", arrow: "cools" },
      { label: "Condensation", arrow: "falls" },
      { label: "Precipitation", arrow: "flows" },
      { label: "Collection", arrow: "heats" },
    ],
  },
  "flow-chain": {
    kind: "flow",
    alt: "Digestion of starch: amylase in the mouth, then small intestine, then glucose absorbed into the blood.",
    layout: "chain",
    steps: [
      { label: "Starch in food", arrow: "amylase" },
      { label: "Maltose in the small intestine", arrow: "maltase" },
      { label: "Glucose" },
      { label: "Absorbed into the blood" },
    ],
  },
  "labelled-particles": {
    kind: "labelled-diagram",
    alt: "Particles in a solid are in a regular pattern, touching; in a liquid touching but random; in a gas far apart.",
    canvas: "wide",
    shapes: [
      { type: "particles", arrangement: "solid", x: 2, y: 25, w: 48, h: 55, caption: "Solid" },
      { type: "particles", arrangement: "liquid", x: 56, y: 25, w: 48, h: 55, caption: "Liquid" },
      { type: "particles", arrangement: "gas", x: 110, y: 25, w: 48, h: 55, caption: "Gas" },
    ],
    labels: [
      { text: "regular rows", at: [20, 30], side: "top" },
      { text: "random, touching", at: [80, 60], side: "top" },
      { text: "far apart", at: [135, 45], side: "top" },
    ],
  },
  "labelled-cell": {
    kind: "labelled-diagram",
    alt: "An animal cell: cell membrane, cytoplasm, nucleus and mitochondria.",
    title: "Animal cell",
    shapes: [
      { type: "ellipse", cx: 50, cy: 50, rx: 44, ry: 36, fill: "surface" },
      { type: "circle", cx: 46, cy: 46, r: 13, fill: "accent" },
      { type: "ellipse", cx: 72, cy: 64, rx: 8, ry: 4, fill: "accent2" },
      { type: "ellipse", cx: 26, cy: 68, rx: 7, ry: 3.5, fill: "accent2" },
    ],
    labels: [
      { text: "nucleus", at: [46, 46], side: "left" },
      { text: "cell membrane", at: [94, 50], side: "right" },
      { text: "cytoplasm", at: [60, 30], side: "right" },
      { text: "mitochondrion", at: [72, 64], side: "right" },
    ],
  },
  "labelled-river": {
    kind: "labelled-diagram",
    alt: "River cross-section: a wide valley with the river channel at the bottom, the water surface and the bed.",
    canvas: "wide",
    shapes: [
      {
        type: "polygon",
        points: [
          [0, 15],
          [45, 50],
          [62, 78],
          [98, 78],
          [115, 50],
          [160, 15],
          [160, 100],
          [0, 100],
        ],
        fill: "muted",
      },
      {
        type: "polygon",
        points: [
          [55, 62],
          [105, 62],
          [98, 78],
          [62, 78],
        ],
        fill: "accent2",
      },
      {
        type: "line",
        points: [
          [62, 88],
          [98, 88],
        ],
        dashed: true,
      },
    ],
    labels: [
      { text: "valley side", at: [25, 31], side: "top" },
      { text: "water surface", at: [80, 62], side: "top" },
      { text: "river bed", at: [80, 78], side: "bottom" },
      { text: "bank", at: [108, 64], side: "right" },
    ],
  },
  "number-line": {
    kind: "number-line",
    alt: "Number line from −5 to 5: a jump of +5 from −2 lands on 3.",
    min: -5,
    max: 5,
    step: 1,
    points: [
      { value: -2, label: "start" },
      { value: 3, label: "end" },
    ],
    jumps: [{ from: -2, to: 3, label: "+5" }],
  },
  "number-line-inequality": {
    kind: "number-line",
    alt: "The inequality x ≥ 2 on a number line from 0 to 10.",
    title: "x ≥ 2",
    min: 0,
    max: 10,
    step: 1,
    points: [{ value: 2 }],
    range: { from: 2, to: 10 },
  },
  table: {
    kind: "table",
    alt: "The three states of matter compared by arrangement, movement and energy.",
    header: ["State", "Arrangement", "Movement"],
    rows: [
      ["Solid", "Regular, touching", "Vibrate in place"],
      ["Liquid", "Random, touching", "Slide past each other"],
      ["Gas", "Random, far apart", "Move fast in all directions"],
    ],
  },
};
