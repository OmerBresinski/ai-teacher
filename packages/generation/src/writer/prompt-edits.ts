import FITS_EXTRA from "@tj/slides/templates/fits-extra.json" with { type: "json" };
import type { WriterStage } from "./schema";

/*
 * The wording options of the writer prompt (#431, CROSSCHECK tranches T1, T4 and T5), each a set of
 * exact replacements of pinned base4f-p123 lines, so a test arm changes only its listed lines:
 *  - clarity (T1): one definition of a question slide for the answer rules; Fits rows for every
 *    count the schema allows, generated from measured capacity; no "write the JSON in the same
 *    order"; the slide count counts the title and objectives; the short command only where pupils
 *    act; the history picture line tied to "named"; the Higher-tier sentence only at KS4;
 *  - recallAfterObjectives (T4): the recall slide straight after the objectives, never the title;
 *  - answerVisibility (T5): hinge stems answerable alone; a model slide teaches and never asks,
 *    and is chosen by teaching value; the bar_model row says what a finished model draws.
 * A replacement whose old text is missing throws: an arm that silently changed nothing would test
 * nothing.
 */

type Edit = { from: string; to: string };

function apply(text: string, edits: Edit[], option: string): string {
  let out = text;
  for (const e of edits) {
    const at = out.indexOf(e.from);
    if (at < 0 || out.indexOf(e.from, at + 1) >= 0)
      throw new Error(`prompt option ${option}: expected one "${e.from.slice(0, 60)}…"`);
    out = out.slice(0, at) + e.to + out.slice(at + e.from.length);
  }
  return out;
}

/* T1 clarity ---------------------------------------------------------- */

export const HIGHER_TIER =
  " At KS4, add an optional Higher-tier extension where the specification has one.";

export const CLARITY_EDITS: Edit[] = [
  {
    from: "Work through these four steps in order, and write the JSON in the same order.",
    to: "Work through these four steps in order.",
  },
  {
    from: "The context gives a range of slides.",
    to: "The context gives a range of slides, counting the title and objectives.",
  },
  {
    from: "A slide tells pupils what to do as a short command.",
    to: "A slide where pupils act tells them what to do as a short command.",
  },
  {
    from: "Nothing else on a question's slide, a heading, a caption or another question, gives its answer away.",
    to: "A question slide is one where pupils answer: a hinge, question set, practice, exit ticket or activity. Nothing else on a question slide, a heading, a caption, a figure or another question, gives an answer away; a teaching slide may state the answer it teaches.",
  },
  {
    from: "A historical person or artefact is always a real image, whichever style the lesson has.",
    to: 'A picture of a historical person or artefact is "named", so it shows the real one, whichever style the lesson has.',
  },
];

/* Fits rows for every count the schema allows ------------------------ */

type J = Record<string, unknown>;
type Measured = {
  label: string;
  counts: Record<string, number>;
  figure: boolean;
  maxCharsPerItem: number;
};
type ExtraFits = Record<string, Record<string, { charsPerLine: number; variants: Measured[] }>>;
const EXTRA = (FITS_EXTRA as unknown as { stages: ExtraFits }).stages;

/** Each counted layout's list field, and the noun its rows count. */
const COUNTED: Record<string, { field: string; row: (n: number) => string }> = {
  hinge: { field: "options", row: (n) => `${n} option${n > 1 ? "s" : ""}` },
  "question-set": { field: "questions", row: (n) => `${n} question${n > 1 ? "s" : ""}` },
  practice: { field: "questions", row: (n) => `${n} question${n > 1 ? "s" : ""}` },
  "exit-ticket": { field: "questions", row: (n) => `${n} question${n > 1 ? "s" : ""}` },
  steps: { field: "points", row: (n) => `${n} step${n > 1 ? "s" : ""}` },
  "equation-hero": { field: "points", row: (n) => `formula + ${n} line${n > 1 ? "s" : ""}` },
  explain: { field: "points", row: (n) => `lead + ${n} point${n > 1 ? "s" : ""}` },
  "visual-text": { field: "points", row: (n) => `lead + ${n} point${n > 1 ? "s" : ""}` },
  "picture-sequence": { field: "sequence", row: (n) => `${n} pictures` },
  compare: { field: "columns", row: (n) => `${n} columns` },
};

/** make_menu.py's lines(): characters as lines of the column, under 0.75 reading "half a line". */
export function lines(chars: number, cpl: number): string {
  const x = chars / cpl;
  if (x < 0.75) return "half a line";
  const n = Math.floor(x + 0.25);
  return `${n} line${n > 1 ? "s" : ""}`;
}

type Row = { text: string; count?: number; group: "plain" | "figure" | "card" | "fixed" };

/** A pinned Fits row read back: its count and whether it is a picture or key-card fill. */
function readRow(text: string): Row {
  const label = text.split(/, | of up to /)[0] ?? text;
  if (/key card/.test(label)) return { text, group: "card" };
  const n = /^a lead alone$/.test(label)
    ? 0
    : Number(
        /(\d+) (?:option|question|step|line|point|picture|column)s?\b/.exec(label)?.[1] ?? NaN,
      );
  if (Number.isNaN(n)) return { text, group: "fixed" };
  return { text, count: n, group: / with (?:a )?pictures?\b/.test(label) ? "figure" : "plain" };
}

/** The schema's item range for a layout's list field. */
function rangeOf(schema: J, layout: string, field: string): [number, number] | undefined {
  const defs = (schema.$defs ?? {}) as Record<string, { properties?: Record<string, J> }>;
  const p = defs[layout]?.properties?.[field];
  return typeof p?.minItems === "number" && typeof p?.maxItems === "number"
    ? [p.minItems, p.maxItems]
    : undefined;
}

/**
 * One layout line with a Fits row for every count its schema field allows: pinned rows stay word
 * for word; each missing count gets a row from the measured table (`@tj/slides` fits-extra), in its
 * group (plain, then with a picture, as pinned), by count. A count the table never measured throws.
 */
export function fullFitsLine(line: string, stage: WriterStage, schema: J): string {
  const m = /^- ([a-z-]+): (.*) Fits: (.*)\.$/.exec(line);
  const layout = m?.[1] ?? "";
  const c = COUNTED[layout];
  const range = c && rangeOf(schema, layout, c.field);
  if (!m || !c || !range) return line;
  const rows = (m[3] as string).split("; ").map(readRow);
  const groups: ("plain" | "figure")[] = [
    "plain",
    ...(rows.some((r) => r.group === "figure") ? (["figure"] as const) : []),
  ];
  const suffix =
    /( with .+)$/.exec(rows.find((r) => r.group === "figure")?.text.split(", ")[0] ?? "")?.[1] ??
    "";
  const added: Row[] = [];
  for (const g of groups)
    for (let n = range[0]; n <= range[1]; n++) {
      if (rows.some((r) => r.group === g && r.count === n)) continue;
      // A fill "with" a picture is the figure group (visual-text always has its figure, unnamed).
      const fit = EXTRA[stage]?.[layout];
      const v = fit?.variants.find(
        (x) => / with /.test(x.label) === (g === "figure") && Object.values(x.counts)[0] === n,
      );
      if (!fit || !v || v.maxCharsPerItem <= 0)
        throw new Error(`no measured Fits for ${layout} ${g} ${n} at ${stage}`);
      const L = lines(v.maxCharsPerItem, fit.charsPerLine);
      added.push({
        text: `${c.row(n)}${g === "figure" ? suffix : ""}, ${L}${n > 1 ? " each" : ""}`,
        count: n,
        group: g,
      });
    }
  if (!added.length) return line;
  const all = [...rows, ...added];
  const ordered = [
    ...all.filter((r) => r.group === "fixed"),
    ...groups.flatMap((g) =>
      all.filter((r) => r.group === g).sort((a, b) => (a.count ?? 0) - (b.count ?? 0)),
    ),
    ...all.filter((r) => r.group === "card"),
  ];
  return `- ${layout}: ${m[2]} Fits: ${ordered.map((r) => r.text).join("; ")}.`;
}

/** T1: the system text under `clarity`. */
export function clarityText(
  system: string,
  stage: WriterStage,
  keyStage: string,
  schema: J,
): string {
  let out = apply(system, CLARITY_EDITS, "clarity");
  if (keyStage !== "ks4") out = apply(out, [{ from: HIGHER_TIER, to: "" }], "clarity");
  const at = out.indexOf("\nLayouts. ");
  const end = out.indexOf("\n\n", at + 1);
  if (at < 0 || end < 0) throw new Error("prompt option clarity: no Layouts block");
  const block = out
    .slice(at + 1, end)
    .split("\n")
    .map((l) => fullFitsLine(l, stage, schema))
    .join("\n");
  return out.slice(0, at + 1) + block + out.slice(end);
}

/* T4 recallAfterObjectives -------------------------------------------- */

export const RECALL_EDITS: Edit[] = [
  {
    from: "Plan these where they fit this topic and year group: a first slide that recalls what pupils of this age already know that this lesson builds on, answerable without any earlier lesson;",
    to: "Plan these where they fit this topic and year group: straight after the objectives, a slide of its own that recalls what pupils of this age already know that this lesson builds on, answerable without any earlier lesson, and never asked in the title's subtitle;",
  },
];
export const recallText = (system: string) => apply(system, RECALL_EDITS, "recallAfterObjectives");

/* T5 answerVisibility ------------------------------------------------- */

export const HINGE_EDITS: Edit[] = [
  {
    from: "- hinge: one multiple-choice question: a stem of one short question, 2 to 4 options, each wrong option a belief pupils plausibly hold at this point, and the number of the correct option; a longer setup goes on the slide before it.",
    to: "- hinge: one multiple-choice question that pupils answer from what they have been taught: a stem of one short question that carries everything pupils need, 2 to 4 options, each wrong option a belief pupils plausibly hold at this point, and the number of the correct option; a question that needs a setup, data or a picture goes in question-set or practice.",
  },
];
/** The library's lines (present only when the lesson has models). */
export const MODEL_EDITS: Edit[] = [
  {
    from: "Choose one over a kind above when it shows this slide's idea, and a picture when the slide is about one particular living thing, place, object or person, which a model may not draw. Its intent says what it must show here: the case, its numbers or names, and what stays hidden on a question slide. Unlike the kinds above, a model always fills a big-visual slide of its own: its heading,",
    to: "Choose one only when its drawing teaches this slide's idea better than a kind above or a picture would, since it takes a slide of its own; a slide about one particular living thing, place, object or person takes a picture, which a model may not draw. Its intent says what it must show here: the case and its numbers or names. Unlike the kinds above, a model always fills a big-visual slide of its own and is drawn finished, answer included, so the slide teaches or works an example and never asks pupils a question: its heading,",
  },
  {
    from: ": a word problem as bars, with the unknown marked and the answer braced;",
    to: ": a word problem worked as bars, the answer shown in place of the unknown and the whole braced when it is the unknown;",
  },
];
export function answerText(system: string): string {
  const out = apply(system, HINGE_EDITS, "answerVisibility");
  if (!out.includes("\n- model: ")) return out;
  // The bar_model row is there only when the lesson's models include it.
  const rows = out.includes("\n- bar_model, ") ? MODEL_EDITS : MODEL_EDITS.slice(0, 1);
  return apply(out, rows, "answerVisibility");
}
