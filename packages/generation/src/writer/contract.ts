import { diagramJsonSchema, LIMIT_TEXT, LIMITS, SLOT_LIMITS } from "@tj/slides/diagrams";

/*
 * The writer's contract with the drawer and the brief, in code (TEACH-110 part k, rootcause
 * WRITER-CONTRACT and PICTURES-DIAGRAMS, 9 Oct 2026). The pinned bundle files stay byte-exact
 * copies of the lab's; this module rewrites the lines of the writer's system text that
 * contradicted the drawer's schema or the teacher's slide count, and builds the freeform diagram
 * def. Every number below is read from the drawer's own schema (`diagramJsonSchema`), never typed
 * in: a drawer limit that changes changes the writer's text and schema with it.
 */

type J = Record<string, unknown>;

const props = (kind: string) =>
  (diagramJsonSchema(kind as never) as { properties: Record<string, J> }).properties;
const items = (n: J | undefined) => (n?.items ?? {}) as J;
/** A string limit the drawer states in its description ("at most 24 characters", "about 35"). */
const chars = (n: J | undefined): number => {
  const m = /(?:at most|about) (\d+) characters/.exec(String(n?.description ?? ""));
  if (!m) throw new Error(`writer contract: no character limit in ${JSON.stringify(n)}`);
  return Number(m[1]);
};
const num = (n: J | undefined, k: "maxItems" | "minItems" | "minimum"): number => {
  const v = n?.[k];
  if (typeof v !== "number") throw new Error(`writer contract: no ${k} in ${JSON.stringify(n)}`);
  return v;
};

/** The drawer's limits for the freeform kinds the writer names but does not spec itself. */
export function drawerLimits() {
  const ld = props("labelled-diagram");
  const pa = props("particles");
  const rv = props("river");
  const panel = (items(pa.panels).properties ?? {}) as Record<string, J>;
  return {
    labelled: {
      labels: num(ld.labels, "maxItems"),
      chars: chars((items(ld.labels).properties as Record<string, J>).text),
    },
    particles: {
      panels: num(pa.panels, "maxItems"),
      perPanel: num(panel.count, "minimum"),
      notes: num(pa.notes, "maxItems"),
      noteChars: chars(items(pa.notes)),
      captionChars: chars(items(pa.captions)),
      keyChars: chars(items(pa.key)),
    },
    river: {
      labels: num(rv.labels, "maxItems"),
      chars: chars((items(rv.labels).properties as Record<string, J>).text),
    },
  };
}

/** The menu lines for the freeform kinds, from the drawer's limits (`Diagram kinds:` block). */
export function freeformMenuLines(): { labelled: string; particles: string } {
  const L = drawerLimits();
  const p = L.particles;
  return {
    labelled: `- labelled-diagram: a simple drawing of one thing with up to ${L.labelled.labels} parts labelled, each label ${LIMIT_TEXT.label}.`,
    particles: `- particles: up to ${p.panels} panels of atoms or molecules, at least ${p.perPanel} particles in each, for states of matter, diffusion, dissolving, or how temperature, concentration or pressure changes how particles move and collide; ${LIMIT_TEXT.particles}, and no arrows between panels that compare. Organisms, populations and variants are never particles: compare them with bar-chart, table or the compare layout.`,
  };
}

/** The pinned lines the contract replaces, exactly as every bundle's system text holds them. */
export const PINNED_LINES = {
  labelled:
    "- labelled-diagram: a simple drawing of one thing with up to 8 parts labelled, each label up to 4 words.",
  particles:
    "- particles: up to 3 particle panels, each with a note of up to 4 words, for states of matter, diffusion, dissolving, comparing conditions or collisions.",
  count:
    "The context gives a range of slides. Choose the number in that range that fits the topic, the pupils' age and the objectives, and plan that many in the flow.",
} as const;

/** The slide-count sentence: the context's count includes the title and objectives (ADR 0036). */
export const COUNT_LINE =
  "The context gives the number of slides, counting the title and the objectives: plan exactly that many in the flow. When it gives a range instead, choose the number in that range that fits the topic, the pupils' age and the objectives.";

/**
 * The writer's system text with the contract lines in place. Throws when a pinned line is
 * missing, so a new bundle cannot ship with the old contradiction silently kept.
 */
export function contractSystem(text: string): string {
  const lines = freeformMenuLines();
  const swap = (t: string, from: string, to: string) => {
    if (!t.includes(from)) throw new Error(`writer contract: pinned line not found: ${from}`);
    return t.split(from).join(to);
  };
  let t = swap(text, PINNED_LINES.labelled, lines.labelled);
  t = swap(t, PINNED_LINES.particles, lines.particles);
  return swap(t, PINNED_LINES.count, COUNT_LINE);
}

/**
 * The freeform diagram def (`labelled-diagram`, `particles`, `hydrograph`, `river`, `cubes`): its
 * `labels` are what the drawer is asked to name, so they are held to the drawer's most generous
 * label slot (labelled-diagram and river take the same count), each at its character limit.
 */
export function freeformLabels(): J {
  const L = drawerLimits();
  const max = Math.max(L.labelled.labels, L.river.labels);
  const len = Math.min(L.labelled.chars, L.river.chars);
  return {
    type: "array",
    maxItems: max,
    items: { type: "string", description: `at most ${len} characters` },
  };
}

/** The writer's table row cap: 4 slides (one and three continuations) of 8 rows, 32 rows. */
export const TABLE_ROWS_MAX = 4 * LIMITS.table.rows;

/**
 * The writer's array caps as code holds them (register content-01, content-02, diagrams-10). A
 * table's `rows` carry no `maxItems`: constrained decoding closed a capped array mid-list (a 1-20
 * table stopped at 15, its last cell a stray word), so a table's rows are capped only at what its
 * continuation slides can hold (TABLE_ROWS_MAX, 32) and code packs and continues a long table
 * (ruling 197, `table-pack.ts`); the slot's count stays as words.
 * Fraction shapes are capped at what the slot now holds (the measured slot table). `def` is one
 * `dg-<kind>-<slot>` def; returns a new def, or the same one for any other kind.
 */
export function writerCaps(
  def: J,
  kind: string,
  stage: "KS1" | "KS2" | "KS3-5",
  slot: "side" | "full",
): J {
  const lim = SLOT_LIMITS.limits[stage][slot][kind];
  const field = kind === "table" ? "rows" : kind === "fraction-shapes" ? "shapes" : undefined;
  const props = def.properties as Record<string, J> | undefined;
  if (!lim || !field || !props?.[field]) return def;
  const list: J = { ...props[field] };
  if (kind === "table") {
    // A generous but finite cap: everything the continuation slides can hold (4 slides of the
    // drawer's 8 rows, `table-pack.ts`), so one runaway table can't spend the lesson's tokens.
    list.maxItems = TABLE_ROWS_MAX;
    list.description = `about ${lim.items} rows fit in this slot; write every row the table needs, a longer table continues on the next slide`;
  } else list.maxItems = lim.items;
  return { ...def, properties: { ...props, [field]: list } };
}

/** `flow[].teaches`: only the approved objectives' numbers (`1..n`). */
export const teachesSchema = (objectives: number): J => ({
  type: "array",
  items: { type: "integer", enum: Array.from({ length: objectives }, (_, k) => k + 1) },
});
