import { charsOver, fitTable } from "./fixes";
import { validate } from "./strict-subset";

/*
 * Slot-fill (lab/slotfill round 2, 3a26ce97; on with writer bundle base4g): layout first, then
 * fill the slots.
 *
 * Sol still chooses each slide's layout while it writes, from the full menu, in the same streamed
 * call. The change is what the choice commits to: every slide def becomes one def per way of
 * filling the layout (a fit-table variant: item count, key cards, figure or not). The slide's
 * second field, `fit`, names the variant, so the moment `template` and `fit` arrive the slide's
 * slots are known (the skeleton), and every text field after them carries a `maxLength` from the
 * renderer's measured room at the theme's type size (fit-table.gen.json). The per-field caps are
 * split so that their sum also stays inside the variant's whole-slide room, so a slide that keeps
 * to its caps cannot overflow by the writer's own measure (`charsOver`).
 *
 * On when the writer bundle says so (`WriterBundle.features.slotFill`). A slide that breaks its
 * caps, reaches one, or ends a sentence field mid-sentence is logged as a writer fault
 * (`ev: "slot-fill"`, `cut: true`) and kept as written: no code shrinks, splits or cuts it. Old
 * outputs (no `fit`) still parse.
 */

type J = Record<string, unknown>;
type FitLimit = { item: number; total: number; instruction?: number };
type FitVariant = {
  label: string;
  counts: Record<string, number>;
  figure: boolean;
  keyCards?: boolean;
  chars: number;
  limit?: FitLimit;
  limitBare?: FitLimit;
  noInstruction?: boolean;
  instruction?: number;
  stem?: number;
  keyLabel?: number;
  columnLabel?: number;
};

/** Labels the fit table measured with a fixed length (fit-table.ts KEY_LABEL, COLUMN_LABEL). */
const KEY_LABEL = 16;
const COLUMN_LABEL = 12;
/**
 * Characters per word (spaces included) used to turn a `maxLength` cap into the words the writer
 * is shown. On-slide strings average about 6 characters a word but reach 8 at the 95th
 * percentile, so at 8 a field written to its word budget fits its cap; the schema's `maxLength`
 * stays the hard backstop.
 */
export const CHARS_PER_WORD = 8;
const LISTS = ["points", "questions", "options", "columns", "sequence"] as const;

const REF = (n: string): J => ({ $ref: `#/$defs/${n}` });
const isNull = (x: J) => x.type === "null";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const capped = (n: number): J => ({ type: "string", maxLength: n });

/** The variant's key: `points-2-key-fig`, `columns-3-fig`, `bare`, `fig`. Unique per layout. */
export function fitKey(v: Pick<FitVariant, "counts" | "keyCards" | "figure">): string {
  const parts = Object.entries(v.counts).map(([k, n]) => `${k}-${n}`);
  if (v.keyCards) parts.push("key");
  if (v.figure) parts.push("fig");
  return parts.length ? parts.join("-") : "bare";
}
export const variantDefName = (layout: string, key: string) => `${layout}~${key}`;

/** A schema with its null branch taken out (resolving one `$ref` level). */
function nonNull(x: J, defs: Record<string, J>): J {
  const s = x.$ref ? (defs[String(x.$ref).replace("#/$defs/", "")] ?? x) : x;
  if (!s.anyOf) return x;
  const keep = (s.anyOf as J[]).filter((b) => !isNull(b));
  return keep.length === 1 ? (keep[0] as J) : { anyOf: keep };
}

/**
 * The per-field caps of one variant: each field at most its measured item room, and the shares
 * weighted so lead/stem + instruction + items together never pass the variant's total room.
 */
export function variantCaps(
  layout: string,
  v: FitVariant,
  fields: { lead: boolean; stem: boolean; instruction: boolean },
  heading: number,
) {
  const lim: FitLimit = (fields.instruction ? v.limit : (v.limitBare ?? v.limit)) ?? {
    item: v.chars,
    total: Number.POSITIVE_INFINITY,
  };
  const n = Math.max(0, ...Object.values(v.counts));
  const wLead = fields.lead || fields.stem ? 1.5 : 0;
  const ins =
    fields.instruction && !v.noInstruction ? (lim.instruction ?? v.instruction) : undefined;
  const wIns = ins ? 1 : 0;
  const sumW = wLead + wIns + n;
  const share = (w: number) =>
    Number.isFinite(lim.total) && sumW > 0 ? Math.floor((lim.total * w) / sumW) : lim.item;
  const stemRoom = v.stem ?? Math.round(lim.item * 1.6);
  return {
    heading,
    lead: fields.lead ? Math.min(lim.item, share(wLead)) : undefined,
    stem: fields.stem ? Math.min(stemRoom, share(wLead)) : undefined,
    instruction: ins ? Math.min(ins, share(1)) : undefined,
    item: n > 0 ? Math.min(lim.item, share(1)) : undefined,
    label: layout === "compare" ? (v.columnLabel ?? COLUMN_LABEL) : (v.keyLabel ?? KEY_LABEL),
  };
}

/** One variant's strict def, built from the layout's own def in the writer's schema. */
function variantDef(
  layout: string,
  base: J,
  v: FitVariant,
  heading: number,
  formula: { alone: number; beside: number },
  defs: Record<string, J>,
): J | undefined {
  const p = clone(base.properties as Record<string, J>);
  const figField = ["figure", "picture"].find((k) => k in p);
  // A measured "with a figure" way the layout has no slot for is not offered.
  if (v.figure && !figField && layout !== "compare") return undefined;
  const caps = variantCaps(
    layout,
    v,
    { lead: "lead" in p, stem: "stem" in p, instruction: "instruction" in p && !v.noInstruction },
    heading,
  );
  if ("heading" in p) p.heading = capped(caps.heading);
  if ("lead" in p && caps.lead !== undefined) p.lead = capped(caps.lead);
  if ("stem" in p && caps.stem !== undefined) p.stem = capped(caps.stem);
  if ("instruction" in p)
    p.instruction =
      v.noInstruction || caps.instruction === undefined
        ? { type: "null" }
        : { anyOf: [capped(caps.instruction), { type: "null" }] };
  if ("formula" in p) p.formula = capped(v.figure ? formula.beside : formula.alone);
  if (figField && layout !== "compare" && layout !== "picture-sequence") {
    const f = p[figField] as J;
    p[figField] = v.figure ? nonNull(f, defs) : { type: "null" };
  }
  for (const k of LISTS) {
    const n = v.counts[k];
    if (!(k in p) || n === undefined) continue;
    const list = p[k] as J;
    const item = caps.item ?? 0;
    let it: J;
    if (k === "points" && (layout === "visual-text" || layout === "explain"))
      it = v.keyCards
        ? {
            type: "object",
            additionalProperties: false,
            required: ["label", "text"],
            properties: { label: capped(caps.label), text: capped(item) },
          }
        : capped(item);
    else if (k === "columns") {
      const card = clone(list.items as J);
      const cp = card.properties as Record<string, J>;
      cp.label = capped(caps.label);
      cp.text = capped(item);
      cp.picture = v.figure ? nonNull(cp.picture as J, defs) : { type: "null" };
      it = card;
    } else if (k === "sequence") {
      const seq = clone(list.items as J);
      const capCaption = (b: J) => {
        const bp = b.properties as Record<string, J> | undefined;
        if (bp?.caption) bp.caption = capped(item);
        return b;
      };
      it = seq.anyOf ? { anyOf: (seq.anyOf as J[]).map(capCaption) } : capCaption(seq);
    } else it = capped(item);
    const description = (p[k] as J | undefined)?.description;
    p[k] = {
      type: "array",
      items: it,
      minItems: n,
      maxItems: n,
      ...(description ? { description } : {}),
    };
  }
  const { template, ...rest } = p;
  const props = { template, fit: { type: "string", enum: [fitKey(v)] }, ...rest };
  return { ...base, required: Object.keys(props), properties: props };
}

/** The layouts slot-fill covers: those the fit table measured for the stage. */
export function slotLayouts(stage: string): Record<string, FitVariant[]> {
  const F = fitTable()[stage];
  if (!F) throw new Error(`slot-fill: no fit table for ${stage}`);
  const out: Record<string, FitVariant[]> = {};
  for (const [name, L] of Object.entries(F.layouts))
    out[name] = (L.variants as unknown as FitVariant[]).filter((v) => v.chars > 0);
  return out;
}

/**
 * The writer's schema with every measured layout split into its variant defs (`layout~key`).
 * Applied last, after the library and activities steps, so it splits the defs as sent. Layouts
 * with no fit-table entry (activities) stay as they are. Pure: returns a new schema.
 */
export function withSlotFill(schema0: J, stage: string): J {
  const schema = clone(schema0);
  const defs = schema.$defs as Record<string, J>;
  const F = fitTable()[stage];
  if (!F) throw new Error(`slot-fill: no fit table for ${stage}`);
  const formula = { alone: F.formula, beside: F.formulaBesideFigure };
  const split = (layout: string): J[] | undefined => {
    const base = defs[layout];
    const vs = slotLayouts(stage)[layout];
    if (!base || !vs?.length) return undefined;
    const refs: J[] = [];
    for (const v of vs) {
      const d = variantDef(layout, base, v, F.heading, formula, defs);
      if (!d) continue;
      const name = variantDefName(layout, fitKey(v));
      defs[name] = d;
      refs.push(REF(name));
    }
    return refs.length ? refs : undefined;
  };
  const props = schema.properties as Record<string, J>;
  const done = new Set<string>();
  const slides = props.slides as J;
  const items = slides.items as J;
  const branches = (items.anyOf as J[]) ?? [items];
  slides.items = {
    anyOf: branches.flatMap((b) => {
      const name = String(b.$ref ?? "").replace("#/$defs/", "");
      const refs = name ? split(name) : undefined;
      if (refs) done.add(name);
      return refs ?? [b];
    }),
  };
  // The flow names each slide's content shape after what it does and before what pupils look at,
  // so the layout is fitted to a shape already written (key before the question).
  const flowItem = (props.flow as J | undefined)?.items as J | undefined;
  const fp = flowItem?.properties as Record<string, J> | undefined;
  if (flowItem && fp && !("shape" in fp)) {
    const { slide, does, ...rest } = fp;
    flowItem.properties = { slide, does, shape: { type: "string", enum: [...SHAPES] }, ...rest };
    flowItem.required = Object.keys(flowItem.properties as J);
  }
  const titleRefs = split("title");
  if (titleRefs) {
    props.title = { anyOf: titleRefs };
    done.add("title");
  }
  // The split layouts' own defs are no longer referenced; strict mode is sent only what is used.
  for (const n of done) delete defs[n];
  return schema;
}

/*
 * Slot-fill prompt wording (prompt-engineer, 10 Oct 2026, round 2 11 Oct). Three sentences join the
 * base text and every `Fits:` sentence is rewritten from the schema's own caps, so the words the
 * writer reads are the limits it is held to. Net shorter than the base at every stage (tested).
 */
/** Step 2 (Flow): each slide's content shape is named before what pupils look at (round 2). */
const FLOW_LOOK = "then what pupils look at to learn from it";
const SF_FLOW_LOOK =
  "then its shape (one idea, things of one kind, an order, a contrast, a misconception, a worked example, or a question) and what pupils look at to learn from it";
/** Appended to step 2: one idea per slide within its Fits; an order once; a long table planned. */
const SF_FLOW =
  " Each slide carries one idea its Fits hold, more takes two slides; a table longer than its kind holds takes two, or fewer rows. An order is shown once: steps or picture-sequence, or a flow or timeline diagram only when the picture is the order.";
/** Step 3 (Layout), replaced: the flow's shape first, then the look; then the fit. */
const SF_LAYOUT =
  "3. Layout. Give each slide the layout below that fits its shape first, then what pupils look at; then its fit: items, key for key cards, fig for a picture or diagram.";
/** Step 4's Fits clause, folded: the menu's Fits now say what a layout holds. */
const WRITE_HOLDS =
  ". A layout holds what its line below says; the year group decides how much of that a slide uses.";
const SF_WRITE_HOLDS = "; the year group decides how much of its Fits a slide uses.";
/** Menu size phrases the Fits budgets now carry (caps moved into the schema; CORE 2026-10-07). */
const SIZE_PHRASES: [string, string][] = [
  ["a short label, a word or two naming its idea", "a short label naming its idea"],
  ["then the substitution and the answer, one line each,", "then the substitution and the answer,"],
];
/** The flow's shape values, in the prompt's own words (the enum and the prose at one grain). */
export const SHAPES = [
  "one idea",
  "things of one kind",
  "an order",
  "a contrast",
  "a misconception",
  "a worked example",
  "a question",
] as const;
/** Replaces the menu's intro sentence about Fits lines (the heading clause is regenerated too). */
const sfIntro = (heading: number, label?: number) =>
  `Layouts. A heading is up to ${heading} words${label ? `, a label ${label}` : ""}. Fits gives each fit's most words: its lead or stem, then "each" item, a phrase or one short sentence, never cut off. More words take a fit with fewer items; never cram.`;

const words = (chars: number) => Math.max(1, Math.floor(chars / CHARS_PER_WORD));

/** A variant def's caps, in field order: `[path, maxLength]`, e.g. `["points[].text", 92]`. */
function defCaps(x: unknown, path = ""): [string, number][] {
  if (!x || typeof x !== "object") return [];
  const s = x as J;
  if (typeof s.maxLength === "number") return [[path, s.maxLength]];
  const out: [string, number][] = [];
  if (s.properties)
    for (const [k, v] of Object.entries(s.properties as J))
      out.push(...defCaps(v, path ? `${path}.${k}` : k));
  if (s.items) out.push(...defCaps(s.items, `${path}[]`));
  if (Array.isArray(s.anyOf)) for (const b of s.anyOf) out.push(...defCaps(b, path));
  const seen = new Set<string>();
  return out.filter(([p]) => !seen.has(p) && seen.add(p));
}

/**
 * One fit's budget in words, from its strict def: `points-1-key-fig 22, each 15`. The lead or
 * stem goes unnamed; a card or column label is named only when labels differ across the menu.
 */
function fitBudget(key: string, def: J, namedLabels: boolean): string {
  const parts: string[] = [];
  const props = (def.properties ?? {}) as Record<string, J>;
  for (const [path, n] of defCaps(def)) {
    const [list, leaf] = path.split(/\[\]\.?/);
    // The formula is held by the schema alone: one short line, as the menu line says.
    if (path === "heading" || path === "formula" || n === 0) continue;
    // A list held at 0 items has no slot to describe.
    if (leaf !== undefined && props[list as string]?.maxItems === 0) continue;
    if (leaf === "label") {
      if (namedLabels) parts.push(`each label ${words(n)}`);
    } else if (leaf === "text" && parts.at(-1)?.startsWith("each label"))
      parts.push(`${parts.pop()} + text ${words(n)}`);
    else if (leaf !== undefined) parts.push(`each ${words(n)}`);
    else if (path === "lead" || path === "stem") parts.push(`${words(n)}`);
    else parts.push(`${path} ${words(n)}`);
  }
  return parts.length ? `${key} ${parts.join(", ")}` : key;
}

/**
 * Each layout's Words sentence, generated from the variant defs in the schema as sent, so the
 * budgets the writer reads are the caps it is held to. A layout whose budgets equal an earlier
 * layout's points to it. `label` is set when every label in the menu has one word budget.
 */
export function fitsLines(schema: J): {
  heading?: number;
  label?: number;
  lines: Record<string, string>;
} {
  const defs = (schema.$defs ?? {}) as Record<string, J>;
  const variants = Object.entries(defs).flatMap(([name, def]) => {
    const [layout, key] = name.split("~");
    return layout && key ? [{ layout, key, def }] : [];
  });
  let heading: number | undefined;
  const labels = new Set<number>();
  for (const { def } of variants) {
    for (const [path, n] of defCaps(def)) {
      if (path === "heading") heading = Math.max(heading ?? 0, words(n));
      if (path.endsWith("[].label")) labels.add(words(n));
    }
  }
  const label = labels.size === 1 ? [...labels][0] : undefined;
  // Per layout: budget -> its fit keys, so fits with one budget share it (`bare, fig 31`).
  const fits: Record<string, Map<string, string[]>> = {};
  for (const { layout, key, def } of variants) {
    const m = fits[layout] ?? new Map<string, string[]>();
    fits[layout] = m;
    const budget = fitBudget("", def, label === undefined).trim();
    m.set(budget, [...(m.get(budget) ?? []), key]);
  }
  const pairs = (m: Map<string, string[]>) =>
    [...m].flatMap(([b, ks]) => ks.map((k) => `${k} ${b}`));
  const lines: Record<string, string> = {};
  for (const [layout, m] of Object.entries(fits)) {
    // Every fit already given, budget for budget, by an earlier layout: point to it.
    const same = Object.keys(lines).find((l) => {
      const theirs = new Set(pairs(fits[l] as Map<string, string[]>));
      return pairs(m).every((p) => theirs.has(p));
    });
    const body = [...m].map(([b, ks]) => `${ks.join(", ")} ${b}`.trim()).join("; ");
    lines[layout] = same ? `Fits: as ${same}.` : `Fits: ${body}.`;
  }
  return { heading, label, lines };
}

/**
 * The writer's system text for slot-fill. Every `Fits:` sentence (rendered lines, which the
 * model cannot count) is replaced by its fits' word budgets generated from the slot-filled
 * schema, the menu intro by the slot rules; step 2 names each slide's shape and plans what does
 * not fit one slide, and step 3 fits shape first.
 */
export function slotFillSystem(system: string, schema: J): string {
  const { heading, label, lines } = fitsLines(schema);
  return system
    .split("\n")
    .map((line) => {
      if (/^Layouts\. A heading is up to /.test(line) && heading) return sfIntro(heading, label);
      if (line.startsWith("2. Flow. ")) {
        // A pinned bundle that lost the anchor must not silently ship without the shape.
        if (!line.includes(FLOW_LOOK)) throw new Error("slot-fill: flow anchor missing");
        return line.replace(FLOW_LOOK, SF_FLOW_LOOK) + SF_FLOW;
      }
      if (line.startsWith("3. Layout. ")) return SF_LAYOUT;
      if (line.startsWith("4. Write. ")) {
        if (!line.includes(WRITE_HOLDS)) throw new Error("slot-fill: write anchor missing");
        return line.replace(WRITE_HOLDS, SF_WRITE_HOLDS);
      }
      if (!/^- ([a-z-]+): .*?(\s*Fits: .*)$/.test(line)) return line;
      const menu = SIZE_PHRASES.reduce((l, [a, b]) => l.replace(a, b), line);
      const m = /^- ([a-z-]+): .*?(\s*Fits: .*)$/.exec(menu);
      if (!m) return menu;
      const fits = lines[m[1] as string];
      return menu.slice(0, menu.length - (m[2] as string).length) + (fits ? ` ${fits}` : "");
    })
    .join("\n");
}

/** A string that ends a sentence. */
const SENTENCE_END = /[.!?)"'’”]$/;
/** Fields written as sentences, by name; a lead is a caption on title and big-visual. */
const SENTENCE_FIELD = /(^|\.)(lead|stem|instruction)$/;
const CAPTION_LEAD = new Set(["title", "big-visual"]);
/** A sentence ended inside the string: the string itself must end one too. */
const INNER_SENTENCE = /[.!?]\s+\S/;

export type Arrival = {
  slide: J;
  fit?: string;
  /** The slide's own def broken: wrong counts, a field over its cap, an unknown variant. */
  breaches: string[];
  /**
   * Writer faults, kept as written: a field that reached its cap, or a sentence field (or a string
   * holding more than one sentence) that does not end a sentence. Logged `cut: true`.
   */
  cuts: string[];
  /** Every capped field's length against its cap, in words. */
  fields: { path: string; words: number; capWords: number }[];
  /** The writer's measure (`charsOver`): the slide overflows its layout. Logged, not repaired. */
  over: string[];
  route: "as-written" | "writer-fault";
};

/**
 * A slide as it arrives under slot-fill: checked against its variant def, `fit` stripped so the
 * rest of the stage sees today's slide shape. A breach, cut or overflow is a writer fault: logged,
 * never silently accepted, and never repaired here (slot-fill never drops or rewrites words).
 */
export function slotFillArrival(raw: J, stage: string, schema: J): Arrival {
  const { fit, ...slide } = raw;
  const layout = String(raw.template ?? "");
  const key = typeof fit === "string" ? fit : undefined;
  const defs = (schema.$defs ?? {}) as Record<string, J>;
  const def = key ? defs[variantDefName(layout, key)] : undefined;
  const breaches: string[] = [];
  const cuts: string[] = [];
  const fields: Arrival["fields"] = [];
  const wordsIn = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  if (!key) breaches.push("fit: missing");
  else if (!def) breaches.push(`fit: no variant ${layout}~${key}`);
  else {
    breaches.push(...validate(def, raw, schema));
    const walk = (s: J, v: unknown, path: string) => {
      if (s.$ref) return walk(defs[String(s.$ref).replace("#/$defs/", "")] ?? {}, v, path);
      if (s.anyOf) {
        for (const b of s.anyOf as J[]) walk(b, v, path);
        return;
      }
      if (s.type === "string" && typeof v === "string" && typeof s.maxLength === "number") {
        fields.push({
          path,
          words: wordsIn(v),
          capWords: Math.floor(s.maxLength / CHARS_PER_WORD),
        });
        const t = v.trim();
        const sentence =
          (SENTENCE_FIELD.test(path) && !(path === "lead" && CAPTION_LEAD.has(layout))) ||
          INNER_SENTENCE.test(t);
        if (v.length >= s.maxLength || (sentence && t && !SENTENCE_END.test(t))) cuts.push(path);
      } else if (s.type === "array" && Array.isArray(v))
        for (const [i, x] of v.entries()) walk(s.items as J, x, `${path}[${i}]`);
      else if (s.type === "object" && v && typeof v === "object")
        for (const [k, p] of Object.entries((s.properties ?? {}) as Record<string, J>))
          walk(p, (v as J)[k], path ? `${path}.${k}` : k);
    };
    walk(def, raw, "");
  }
  const over = charsOver(slide, stage);
  const route = breaches.length || cuts.length || over.length ? "writer-fault" : "as-written";
  return { slide, ...(key ? { fit: key } : {}), breaches, cuts, fields, over, route };
}
