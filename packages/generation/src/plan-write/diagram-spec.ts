/*
 * The diagram spec a diagram slot is written as. r5: one source of truth, the drawer's own schema in
 * `@tj/slides/diagrams`; this file used to hold a hand mirror of it, which drifted (round 4: a tuple
 * reached OpenAI and every particles spec failed with a 400). The wire form states each text limit
 * to the writer without enforcing it: a text over its limit fails the drawer's parse when the slide
 * is drawn, and the slide lands as a normal teaching slide without the drawing (plan-write
 * `diagramDraws`), never a failed writer call.
 */
import {
  type DiagramKind,
  DiagramWireSchema,
  DiagramSpecSchema as DrawerSpecSchema,
} from "@tj/slides/diagrams";

/** One diagram, told apart by `kind`, as the writer sends it (limits stated, not enforced). */
export const DiagramSpecSchema = DiagramWireSchema;
export type { DiagramSpec } from "@tj/slides/diagrams";
/** The drawer's strict parse: what decides whether a written spec draws. */
export { DrawerSpecSchema };

/**
 * The kinds the writer and picture-director prompts name (DIAGRAM_CONTRACT below). The drawer
 * draws more (bar-chart, pie, venn, carroll, cubes); widening this list changes those prompts, so
 * it is the prompt owner's call. A test holds every name here to a kind the drawer has.
 */
export const DIAGRAM_KINDS: DiagramKind[] = [
  "particles",
  "hydrograph",
  "timeline",
  "layers",
  "cycle",
  "river",
  "bar-model",
  "line-graph",
  "flow",
  "labelled-diagram",
  "number-line",
  "table",
  // Round 8 (DIAGRAM-SOURCE C2.3): code-drawn meaning-only kinds for KS1-2 maths.
  "equal-groups",
  "fraction-shapes",
];

/**
 * The contract lines a writer reads for the diagram slot: the renderer's limits as units of text
 * (words, phrases), never character counts (rulings 82 and 132); the renderer's parse still holds
 * the limits, and a spec over one lands as a teaching slide without the drawing.
 */
export const DIAGRAM_CONTRACT = [
  `- diagram: the drawing itself, as a diagram spec of one kind; never shown as text. Templates come first: particles (arrangement of particles in solids, liquids and gases, diffusion, dissolving), hydrograph (a storm hydrograph), timeline (dated events in order), layers (a layered structure or cross-section), cycle (a cycle of three to five steps), river (a V-shaped valley, or a meander across or from above), bar-model and number-line. A template's slots are its words and values only; code draws it. Use a template whenever it shows the idea, and the free kinds (line-graph, labelled-diagram, flow, table) only when none does. Its text is labels, not sentences: a label, annotation, interval, series name, particle caption or table header is one to three words; an axis label is a few words with its unit; a flow step is a short phrase and a flow arrow one or two words; a table cell is a short phrase; the title is one short line and the alt one sentence. A field with nothing to say is left out, never empty.`,
  "  - line-graph: an annotation marks one point of one series, at that point's own x and y (on the series' own axis), and its label names that series' feature (\"Peak rainfall\" at the tallest rainfall bar, \"Peak discharge\" at the top of the discharge line). An interval's y is in the left axis's units, below both curves' peaks. A lag time is an interval from the rainfall peak's x to the discharge peak's x.",
  "  - labelled-diagram: shapes on a canvas 100 high (100 or 160 wide). Each label's point is inside or on the shape it names; a label is 1 to 3 words, one per shape, at most 6. Particle boxes are one per state, the caption the state's name; a label on a particle box says something the caption does not (\"fixed rows\", never the state's name again).",
].join("\n");
