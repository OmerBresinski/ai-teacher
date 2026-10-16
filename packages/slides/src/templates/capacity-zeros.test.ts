/**
 * Zero caps (TEACH-68 part b): a 0 in a capacity table means "nothing fits here", never "no limit".
 * No field a layout shows has a hard maximum of 0 unless the combination itself cannot show it
 * (listed below with why; the writer never offers it), and a layout reports any words in a field
 * whose cell is 0 or missing as over.
 */
import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import ACTIVITY from "./activity-capacity.json" with { type: "json" };
import { layoutTemplate, type TemplateInput } from "./index";
import { withRowCapsTable } from "./items-row";
import ROW from "./items-row-capacity.json" with { type: "json" };
import PANEL from "./panel-list-capacity.json" with { type: "json" };
import REASONS from "./reasons-capacity.json" with { type: "json" };
import SIDE_BY_SIDE from "./side-by-side-capacity.json" with { type: "json" };
import SPLIT from "./split-compare-capacity.json" with { type: "json" };
import STAGES from "./stages-capacity.json" with { type: "json" };

type Cap = { cap: number; hardMax: number };
const T0 = THEMES[0] as (typeof THEMES)[number];

/** Every combination that truly cannot show a field, with the reason (category a). */
const LEGITIMATE: Record<string, string> = {
  // Panel list: six rows hold nothing at early and primary even with one-word rows; five rows at
  // early and six at secondary leave no line for a lead. The writer offers 2-5 rows, each count
  // only with every cap above 0 (layout-menu `okCount`, `leadNs`).
  "panel-list early.5.lead": "five rows at early leave no line for a lead",
  "panel-list early.5.withLead": "five rows at early leave no line for a lead",
  "panel-list early.5.pictures.lead": "five pictured rows at early leave no line for a lead",
  "panel-list early.5.pictures.withLead": "five pictured rows at early leave no line for a lead",
  "panel-list early.6": "six rows do not fit at early",
  "panel-list primary.6": "six rows do not fit at primary",
  "panel-list secondary.6.lead": "six rows leave no line for a lead",
  "panel-list secondary.6.withLead": "six rows leave no line for a lead",
  "panel-list secondary.6.pictures.lead": "six pictured rows leave no line for a lead",
  "panel-list secondary.6.pictures.withLead": "six pictured rows leave no line for a lead",
  // Stages: six picture tiles at primary hold no 10-character line even beside 3-letter names.
  "stages primary.6.pictures": "six picture tiles at primary hold no stage",
  // Reasons: four reasons and a four-link chain are never taken at KS1 (REASONS_MAX, ruling).
  "reasons early.reasons-4": "four reasons are not taken at KS1",
  "reasons early.chain-4": "a four-link chain is not taken at KS1",
  // Activities: even 2-character cards overflow (group boxes 101pt, label column, word width);
  // the writer keeps a variant only from MIN_CELL (8) characters (writer/activities.ts).
  "activity group-sort.KS1.6 cards, 3 groups": "three group boxes do not fit at KS1",
  "activity group-sort.KS1.8 cards, 3 groups": "three group boxes do not fit at KS1",
  "activity sequence.KS1.6 cards": "six sequence cards do not fit at KS1",
  "activity label.KS1.5 pointers": "the label column overflows at KS1",
  "activity label.KS1.6 pointers": "the label column overflows at KS1",
  "activity label.KS2.6 pointers": "the label column overflows at KS2",
};
const legit = (key: string) =>
  Object.keys(LEGITIMATE).some((k) => key === k || key.startsWith(`${k}.`));

/** Every `{cap, hardMax}` under `v` whose hard maximum is 0, by dotted path. */
function zeros(v: unknown, path: string, out: string[]) {
  if (!v || typeof v !== "object") return;
  const c = v as Partial<Cap>;
  if (typeof c.hardMax === "number" && typeof c.cap === "number") {
    if (c.hardMax === 0) out.push(path);
    return;
  }
  for (const [k, x] of Object.entries(v)) zeros(x, path ? `${path}.${k}` : k, out);
}

describe("capacity tables: no shown field holds 0 unless the combination cannot show it", () => {
  test("items row (the lead counts only in a cell with a lead)", () => {
    const out: string[] = [];
    for (const [age, cells] of Object.entries(ROW))
      for (const c of cells as unknown as (Record<string, Cap> & {
        withLead: boolean;
        items: number;
        icons: boolean;
      })[])
        for (const f of ["name", "text", "heading", ...(c.withLead ? ["lead"] : [])])
          if ((c[f] as Cap).hardMax === 0)
            out.push(
              `items-row ${age}.${c.items}.${c.icons ? "icons" : "numbers"}.${c.withLead}.${f}`,
            );
    expect(out.filter((k) => !legit(k))).toEqual([]);
  });
  test("panel list, reasons, split compare, side by side", () => {
    const out: string[] = [];
    zeros(PANEL, "panel-list", out);
    zeros(REASONS, "reasons", out);
    zeros(SPLIT, "split-compare", out);
    zeros(SIDE_BY_SIDE, "side-by-side", out);
    expect(out.map((p) => p.replace(".", " ")).filter((k) => !legit(k))).toEqual([]);
  });
  test("stages", () => {
    const out: string[] = [];
    for (const [age, cells] of Object.entries(STAGES))
      for (const c of cells as { n: number; vis: string; name: Cap; line: Cap }[])
        for (const f of ["name", "line"] as const)
          if (c[f].hardMax === 0) out.push(`stages ${age}.${c.n}.${c.vis}.${f}`);
    expect(out.filter((k) => !legit(k))).toEqual([]);
  });
  test("activities (a cell is the longest card word)", () => {
    const out: string[] = [];
    for (const [id, stages] of Object.entries(ACTIVITY))
      for (const [st, row] of Object.entries(stages))
        for (const [label, chars] of Object.entries(row as Record<string, number>))
          if (chars === 0) out.push(`activity ${id}.${st}.${label}`);
    expect(out.filter((k) => !legit(k))).toEqual([]);
  });
  test("every listed combination is still 0 (the list never outlives the table)", () => {
    const all: string[] = [];
    zeros(PANEL, "panel-list", all);
    zeros(REASONS, "reasons", all);
    for (const [age, cells] of Object.entries(STAGES))
      for (const c of cells as { n: number; vis: string; name: Cap }[])
        if (c.name.hardMax === 0) all.push(`stages.${age}.${c.n}.${c.vis}`);
    for (const [id, stages] of Object.entries(ACTIVITY))
      for (const [st, row] of Object.entries(stages))
        for (const [label, chars] of Object.entries(row as Record<string, number>))
          if (chars === 0) all.push(`activity.${id}.${st}.${label}`);
    const keys = all.map((p) => p.replace(".", " "));
    for (const k of Object.keys(LEGITIMATE))
      expect(keys.some((x) => x === k || x.startsWith(`${k}.`))).toBe(true);
  });
});

describe("a 0 or missing cap reports over, never no limit", () => {
  const rowInput: TemplateInput = {
    template: "items-row",
    heading: "Parts",
    items: [
      { name: "Heart", text: "Pumps blood." },
      { name: "Lungs", text: "Take in air." },
      { name: "Blood", text: "Carries air." },
    ],
  };
  test("items row: a cell of 0 is over in every field", () => {
    const zero = { cap: 0, hardMax: 0 };
    const cell = {
      items: 3,
      icons: false,
      withLead: false,
      name: zero,
      text: zero,
      lead: zero,
      heading: zero,
    };
    const r = withRowCapsTable({ primary: [cell] } as never, () =>
      layoutTemplate(rowInput, T0, "ks2"),
    );
    expect(r.over).toEqual(expect.arrayContaining(["heading", "items[0].name", "items[2].text"]));
  });
  test("items row: a missing cell is over in every field", () => {
    const r = withRowCapsTable({}, () => layoutTemplate(rowInput, T0, "ks2"));
    expect(r.over).toEqual(expect.arrayContaining(["heading", "items[1].name", "items[1].text"]));
  });
  test("panel list: six rows at early (hard maximum 0) are over", () => {
    const rows = ["Fruit", "Fish", "Water", "Leaf", "Sun", "Heart"].map((name) => ({
      name,
      text: "Good.",
    }));
    const r = layoutTemplate(
      { template: "panel-list", heading: "Food", rows, panel: null } as TemplateInput,
      T0,
      "ks1",
    );
    expect(r.over).toEqual(expect.arrayContaining(["heading", "rows[0].name", "rows[5].text"]));
  });
  test("stages: six picture tiles at primary (hard maximum 0) are over", () => {
    const stages = ["Seed", "Root", "Shoot", "Leaf", "Bud", "Fruit"].map((name) => ({
      name,
      line: "It grows.",
      picture: { photo: "https://images.test/stage.jpg", alt: name },
    }));
    const r = layoutTemplate(
      { template: "stages", heading: "How a plant grows", stages } as TemplateInput,
      T0,
      "ks2",
    );
    expect(r.over).toEqual(expect.arrayContaining(["stages[0].name", "stages[5].line"]));
  });
  test("reasons: four reasons at KS1 (cell of 0) are over", () => {
    const reasons = ["Wind", "Rain", "Heat", "Cold"].map((head) => ({ head, line: "It helps." }));
    const r = layoutTemplate(
      { template: "reasons", heading: "Why?", reasons } as TemplateInput,
      T0,
      "ks1",
    );
    expect(r.over).toEqual(expect.arrayContaining(["reasons[0].head", "reasons[3].line"]));
  });
  test("split compare: a field with no measured limit (side by side has no quotes) is over", () => {
    const sides = ["Cats", "Dogs"].map((title) => ({ title, text: "They play.", quote: "Hello." }));
    const r = layoutTemplate(
      { template: "side-by-side", heading: "Pets", sides } as TemplateInput,
      T0,
      "ks2",
    );
    expect(r.over).toEqual(expect.arrayContaining(["sides[0].quote"]));
  });
});
