/**
 * Items row capacity (TEACH-75 part u): the published limit (`cap`, still comfortable) and hard
 * maximum (`hardMax`, still fits at the floors) per age profile, item count, icons or numbers,
 * lead or none, and field, measured by the renderer the way the pilot's `caps.mjs` measured them
 * in the browser (ruling 215). Each cell holds on every theme at every stage of the age. Each list
 * field is the smaller of two runs: every item long, and one item long beside short siblings, so
 * a cap holds per item whatever the other items hold. Never hand-edit; regenerate:
 * `bun packages/slides/src/templates/items-row-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { sample } from "./capacity";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { type FieldCap, ROW_DRAW_MAX, type RowCaps, type RowItem, withoutCaps } from "./items-row";
import CAPACITY from "./items-row-capacity.json" with { type: "json" };
import type { Age } from "./items-row-deps";

export const ROW_CAP_GROUPS: Record<Age, Stage[]> = {
  early: ["ks1"],
  primary: ["ks2"],
  secondary: ["ks3", "ks4", "ks5"],
};
export type RowVariant = { icons: boolean; lead: boolean };
export type RowField = "name" | "text" | "lead" | "heading";

/** The heading every item cell is measured under (one line at every age). */
export const ROW_FIT_HEADING = "How the parts work together";
/** Labels the stand-in and the real icon library both resolve, so icon cells are measured with icons. */
const ICONS = ["heart", "blood", "vessels", "lungs", "stomach", "muscles"];
const NAME = 12;
const TEXT = 40;
const LEAD = 40;
const LIMIT = 320;

type Fill = Partial<Record<RowField, number>> & { only?: boolean };
/** The row's input: every field at its default length unless `fill` sets it (`only`: item 0 alone). */
function input(n: number, v: RowVariant, f: Fill = {}): TemplateInput {
  const len = (field: "name" | "text", k: number) =>
    f[field] !== undefined && (!f.only || k === 0)
      ? (f[field] as number)
      : field === "name"
        ? NAME
        : f.only && f.text !== undefined
          ? 16
          : TEXT;
  const items: RowItem[] = Array.from({ length: n }, (_, k) => ({
    name: sample(len("name", k), k + 2),
    text: sample(len("text", k), k),
    ...(v.icons ? { icon: ICONS[k % ICONS.length] as string } : {}),
  }));
  return {
    template: "items-row",
    heading: f.heading !== undefined ? sample(f.heading, 7) : ROW_FIT_HEADING,
    ...(v.lead ? { lead: sample(f.lead ?? LEAD, 4) } : {}),
    items,
  };
}

/** Whether the row holds on every theme and stage of the age: `fit` nothing over, `comfort` also not tight. */
export function rowHolds(
  age: Age,
  n: number,
  v: RowVariant,
  fill: Fill,
  mode: "fit" | "comfort",
): boolean {
  const inp = input(n, v, fill);
  return withoutCaps(() =>
    THEMES.every((theme) =>
      ROW_CAP_GROUPS[age].every((stage) => {
        const r = layoutTemplate(inp, theme, stage);
        // A count over ROW_MAX is flagged "items" but still drawn: only the words decide a fit.
        return r.over.every((f) => f === "items") && (mode === "fit" || !r.tight);
      }),
    ),
  );
}

/** Whether `field` at `chars` holds (both runs for a list field). */
export function rowFitsAt(
  age: Age,
  n: number,
  v: RowVariant,
  field: RowField,
  chars: number,
  mode: "fit" | "comfort",
): boolean {
  const list = field === "name" || field === "text";
  return (
    rowHolds(age, n, v, { [field]: chars }, mode) &&
    (!list || rowHolds(age, n, v, { [field]: chars, only: true }, mode))
  );
}

/** The longest `chars` (2-character steps) that holds, 0 when none does. */
function longest(ok: (chars: number) => boolean): number {
  if (!ok(2)) return 0;
  let lo = 2;
  let hi = LIMIT;
  if (ok(hi)) return hi;
  while (hi - lo > 2) {
    const mid = lo + Math.floor((hi - lo) / 4) * 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export type RowCell = RowCaps & { items: number; icons: boolean; withLead: boolean };

export function measureRowCaps(age: Age): RowCell[] {
  const out: RowCell[] = [];
  for (let n = 2; n <= ROW_DRAW_MAX[age]; n++)
    for (const icons of [true, false])
      for (const lead of [false, true]) {
        const v = { icons, lead };
        const cap = (field: RowField): FieldCap => ({
          cap: longest((c) => rowFitsAt(age, n, v, field, c, "comfort")),
          hardMax: longest((c) => rowFitsAt(age, n, v, field, c, "fit")),
        });
        out.push({
          items: n,
          icons,
          withLead: lead,
          name: cap("name"),
          text: cap("text"),
          lead: lead ? cap("lead") : { cap: 0, hardMax: 0 },
          heading: cap("heading"),
        });
      }
  return out;
}

/** A cell of the committed table. */
export function rowCapsFor(age: Age, n: number, v: RowVariant): RowCell | undefined {
  return (TABLE[age] ?? []).find(
    (c) => c.items === n && c.icons === v.icons && c.withLead === v.lead,
  );
}
const TABLE = CAPACITY as unknown as Record<string, RowCell[]>;

if (import.meta.main) {
  const table = Object.fromEntries(
    (Object.keys(ROW_CAP_GROUPS) as Age[]).map((age) => [age, measureRowCaps(age)]),
  );
  writeFileSync(
    new URL("./items-row-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}
