import { PANEL, RESERVED_LINES } from "./explanation-metrics";
import { fitsPlanned, type ThemeFit } from "./fit-check";
import { SAFE } from "./grid";
import { materialiseSlide } from "./materialise";
import { paletteForm } from "./palette";
import { HEADING_NAME } from "./reflow";
import {
  type ItemField,
  SLOT_CONTRACTS,
  type Slot,
  type SlotContract,
  specOfWriter,
  type TextKind,
  type WriterOutput,
} from "./slot-contracts";
import { workingAndReason } from "./structure";
import { countLines } from "./text-measure";
import { THEMES } from "./themes";

/*
 * The probe behind the slot contracts' counts, and the drift test's ruler. Each kind of text has a
 * bank of the longest plausible classroom text of that kind (`WORST`): not "x", not a padded
 * paragraph, but the long end of what a writer asked for that kind really writes (from the fit-lab
 * briefs and the oracle decks: Weimar 1923, electrolysis, plants, ratio, rivers). A contract is
 * filled with it, every slot at its maximum, and judged by the save gate (`fitsPlanned`, stepDown
 * 0, all 10 themes), plus two checks the gate does not make: a heading sits on one line, and a
 * reason shown after the reveal fits the lines its panel keeps. Test support; not exported from
 * the package.
 */

export const WORST: Record<TextKind, readonly string[]> = {
  // A display heading holds about one short clause on one line on every theme: "Two factors
  // change the rate of electrolysis" already wraps on five.
  heading: [
    "Water moves round the Earth in a cycle",
    "Root hairs take in water from the soil",
    "Weather is not the same as climate",
    "Sharing an amount in a given ratio",
  ],
  sentence: [
    "By November 1923 a loaf of bread cost 200 billion marks, and prices doubled every few days.",
    "Families who had saved for years found that their money would not even buy a postage stamp.",
    "The sun heats water in seas and lakes until it evaporates and rises into the air as vapour.",
    "Positive ions are attracted to the negative electrode, where they gain electrons and are discharged.",
    "Without light the plant cannot photosynthesise, so it cannot make the glucose its cells need.",
    "The droplets join together, grow heavy and fall back to the ground as rain, snow or hail.",
    "A river erodes its bed and banks most in its upper course, where the gradient is steepest.",
  ],
  question: [
    "Why did prices in Germany rise so quickly during 1923?",
    "Amy and Ben share £45 in the ratio 2 : 3, so how much does each of them get?",
    "Explain why a plant kept in a dark cupboard for two weeks will die.",
    "Was the Treaty of Versailles the main reason for the crisis of 1923?",
  ],
  "short-question": [
    "Which outline would persuade the council best?",
    "Which method finds two-fifths of £60?",
  ],
  option: [
    "The government printed money to pay its debts",
    "Factories stopped making goods to sell",
    "Changes slowly, over several decades",
    "A liquid that conducts electricity",
  ],
  outline: [
    "Position, two reasons with examples, a request",
    "Position, objection answered, weekly trial asked",
    "Rhetorical questions, repetition, a slogan",
    "Position, reasons, but no call to action",
  ],
  card: [
    "Oak flowers are pollinated by the wind",
    "Seeds develop inside the acorns",
    "Acorns are carried off by jays",
    "Acorns germinate and grow into seedlings",
  ],
  "short-instruction": ["Put the stages in the right order.", "Order the events of 1923."],
  instruction: [
    "Put the events of 1923 in the order they happened.",
    "Match each electrode word to its meaning.",
    "Complete the sentence with the correct words.",
  ],
  phrase: [
    "The government printed money to pay its debts",
    "Factories stopped making goods to sell",
    "The usual pattern over thirty years",
    "Changes slowly, over several decades",
    "A liquid that conducts electricity",
    "Holds the plant firmly in the ground",
  ],
  clause: [
    // From the slide bench's KS4-5 writers (lab/slide-bench): a lead of one clause at its longest.
    "In 2-bromo-2-methylpropane, the C–Br bond breaks first to form a tertiary carbocation.",
    "A German household's cash savings bought less and less bread as prices rose in 1923.",
    "In electrolysis, the current is carried through the solution by electrons.",
    "Plants get the food they need to grow from the soil around their roots.",
  ],
  label: [
    "Rentenmark issued",
    "The positive electrode",
    "General strike",
    "Carries water up the stem",
    "Makes food for the plant",
    "Ruhr occupied",
  ],
  term: ["Rentenmark issued", "Money printed", "General strike", "Ruhr occupied", "Condensation"],
  answer: ["photosynthesis", "chlorophyll", "condensation", "£27", "discharged"],
  working: [
    "Add the parts: 2 + 3 = 5 parts",
    "One part: £45 ÷ 5 = £9",
    "Amy: 2 × £9 = £18, Ben: 3 × £9 = £27",
    "Subtract 7 from both sides: 3x = 12",
  ],
  "reasoned-step": [
    "One part: £45 ÷ 5 = £9 — the total over the 5 equal parts",
    "Amy: 2 × £9 = £18 — Amy has 2 of the parts",
    "Ice particles vibrate faster — they gain energy from the room",
    "Subtract 7 from both sides: 3x = 12 — undo the + 7",
    "1923: prices doubled every few days — more money was printed",
  ],
  "labelled-sentence": [
    "Current: a larger current discharges more ions at each electrode every second.",
    "Concentration: a stronger solution puts more ions close to each of the electrodes.",
    "Temperature: warmer ions move faster, so they reach the electrodes more quickly.",
  ],
  chunk: [
    "Melting ice: heating gives the particles energy, so they vibrate faster. They break free of fixed positions and slide past each other.",
    "Liquid: the particles touch but slide past each other. A liquid flows and takes its container's shape.",
    "In 1923: a loaf of bread cost 200 billion marks. Prices doubled every few days.",
    "Why it matters: savers lost everything, because their money would no longer buy anything at all.",
  ],
  "gapped-sentence": [
    "Positive ions move to the ___, where they gain electrons and are ___.",
    "Plants make their food by ___ using energy from ___ absorbed by their leaves.",
  ],
  starter: ["I think the main reason was… because…", "Another reason was…"],
  brief: [
    "A flower cut in half, labelled petal, sepal, stamen, anther, filament, carpel, stigma, style and ovary.",
  ],
  paragraph: ["Ask who has grown a plant on a windowsill."],
};

const pick = (kind: TextKind, i: number): string => {
  const bank = WORST[kind];
  return bank[i % bank.length] as string;
};

/** A slot's counts: the slot's own and any sub-list's, by field. */
export type Counts = Record<string, number>;

/** Hands out a kind's bank in order, longest first, so no two slots carry the same text. */
type Picker = (kind: TextKind) => string;

function picker(): Picker {
  const used = new Map<TextKind, number>();
  return (kind) => {
    const i = used.get(kind) ?? 0;
    used.set(kind, i + 1);
    return pick(kind, i);
  };
}

function fillField(f: ItemField, i: number, counts: Counts, key: string, next: Picker): unknown {
  if (f === "flag") return i === 0;
  if (f === "named") return null;
  if (typeof f === "string") return next(f);
  const n = counts[key] ?? f.max;
  return Array.from({ length: n }, () => next(f.each));
}

function fillSlot(slot: Slot, counts: Counts, next: Picker): unknown {
  const n = counts[slot.field] ?? slot.max ?? slot.min;
  const item = (i: number) =>
    typeof slot.each === "string"
      ? next(slot.each)
      : Object.fromEntries(
          Object.entries(slot.each).map(([k, f]) => [
            k,
            fillField(f, i, counts, `${slot.field}.${k}`, next),
          ]),
        );
  if (slot.field === "correct") return false;
  if (slot.field === "compare") return { left: item(0), right: item(1) };
  if (slot.field === "imageBrief")
    return { subject: "root hairs on a seedling", named: null, mustShow: [] };
  const items = Array.from({ length: n }, (_, i) => item(i));
  return slot.min === 1 && slot.max === 1 && n === 1 ? items[0] : items;
}

/** A contract filled with worst-case text, every slot at its maximum unless `counts` says. */
export function worstFill(contract: SlotContract, counts: Counts = {}): WriterOutput {
  const out: WriterOutput = {};
  const next = picker();
  for (const slot of contract.slots) out[slot.field] = fillSlot(slot, counts, next);
  // A gapped sentence carries as many gaps as the answers slot holds.
  if (contract.form === "fill-gap") {
    const answers = out.answers as string[];
    out.sentence =
      answers.length === 1
        ? "Positive ions move to the ___, where they gain electrons and are discharged."
        : pick("gapped-sentence", 0);
  }
  return out;
}

export type ContractFit = { ok: boolean; failing: string[] };

/**
 * Does a filled contract fit? The save gate on all 10 themes, a heading on one line, and a reason
 * shown after the reveal within the lines its panel keeps.
 */
export function contractFits(contract: SlotContract, out: WriterOutput): ContractFit {
  const made = specOfWriter(contract.form, out, contract.layout);
  if (!made) return { ok: true, failing: [] };
  const failing: string[] = [];
  const gate = fitsPlanned(made.spec, {
    stepDown: 0,
    ...(made.variant ? { variant: made.variant } : {}),
    structure: made.structure,
  });
  failing.push(...gate.failing.map((f: ThemeFit) => `${f.theme}: ${why(f)}`));
  const spec = made.spec as Record<string, unknown>;
  for (const theme of THEMES) {
    const slide = materialiseSlide(
      made.spec,
      theme.id,
      META,
      undefined,
      made.variant,
      made.structure,
    );
    // Everything written is kept: the look drops a lead's second sentence, and a card with no
    // room is left off, and neither is an overflow.
    const shown = norm(
      [
        ...slide.elements.map((e) => ("doc" in e && e.doc ? docText(e.doc) : "")),
        JSON.stringify(slide.question ?? {}),
        typeof slide.notes === "string" ? slide.notes : JSON.stringify(slide.notes ?? ""),
      ].join(" "),
    );
    // The form was placed as itself (a callout card, a step card), not left off or fallen back.
    const placed = placedName(contract.form);
    if (placed && !slide.elements.some((e) => e.name === placed))
      failing.push(`${theme.id}: no ${placed}`);
    // A worked step is drawn as its working and its reason, in their own columns.
    // A bank repeats once a slot outgrows it, so a text is kept only when the slide shows it as
    // many times as it was written: a dropped repeat no longer hides behind its first copy.
    const times = (needle: string) => shown.split(norm(needle)).length - 1;
    const written = writtenTexts(contract, out);
    const wanted = (t: string) => written.filter((w) => w === t).length;
    const kept = (t: string) => {
      if (times(t) >= wanted(t)) return true;
      const [working, reason] = workingAndReason(t);
      return !!reason && times(working) >= wanted(t) && times(reason) >= wanted(t);
    };
    const lost = written.filter((t) => !kept(t));
    if (lost.length) failing.push(`${theme.id}: not kept "${lost[0]?.slice(0, 40)}"`);
    if (typeof spec.heading === "string") {
      const el = slide.elements.find((e) => e.name === HEADING_NAME);
      if (el && el.type === "text") {
        const lines = countLines(
          spec.heading,
          el.style.preset,
          theme,
          el.w,
          undefined,
          el.style.fontSize,
        );
        if (lines > 1) failing.push(`${theme.id}: heading on ${lines} lines`);
      }
    }
    const kind = spec.kind as string;
    if (
      (kind === "multiple-choice" || kind === "true-false") &&
      typeof spec.explanation === "string"
    ) {
      const lines = countLines(spec.explanation, "body", theme, SAFE.w - 2 * PANEL.padX);
      const keeps = RESERVED_LINES[kind];
      if (lines > keeps)
        failing.push(`${theme.id}: reason on ${lines} lines, the panel keeps ${keeps}`);
    }
  }
  return { ok: failing.length === 0, failing };
}

function placedName(form: SlotContract["form"]): string | undefined {
  const r = paletteForm(form).renderer;
  return r.on === "slide" ? r.placed : undefined;
}

/** Every text run in a rich doc, one space between blocks. */
function docText(doc: unknown): string {
  const n = doc as { text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  return (n.content ?? []).map(docText).join(" ");
}

const norm = (t: string) => t.replace(/\\"/g, '"').replace(/\s+/g, " ").trim();

/** Every piece of text the writer wrote into a slot shown on the slide, the notes or the reveal. */
function writtenTexts(contract: SlotContract, out: WriterOutput): string[] {
  const texts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") texts.push(v.replace(/___/g, " ").split("  ")[0] as string);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const slot of contract.slots) {
    if (slot.place === "off-slide" || slot.field === "sentence") continue;
    walk(out[slot.field]);
  }
  return texts;
}

const META = { promptVersion: "slot-contracts", model: "code", at: "1970-01-01T00:00:00.000Z" };

function why(f: ThemeFit): string {
  return [
    f.overflow.length && "overflow",
    f.overlaps && "overlap",
    f.lane.length && "in the Why? lane",
    f.steps && "stepped down",
    f.answers.length && "answers cover questions",
  ]
    .filter(Boolean)
    .join(", ");
}

/** The countable things in a contract: each slot, and each sub-list inside an item. */
export function countables(
  contract: SlotContract,
): { key: string; min: number; max?: number; fixed: boolean }[] {
  const out: { key: string; min: number; max?: number; fixed: boolean }[] = [];
  for (const slot of contract.slots) {
    if (slot.place === "off-slide" || slot.place === "notes") continue;
    out.push({
      key: slot.field,
      min: slot.min,
      ...(slot.max === undefined ? {} : { max: slot.max }),
      fixed: !!slot.fixed,
    });
    if (typeof slot.each !== "string") {
      for (const [k, f] of Object.entries(slot.each)) {
        if (typeof f === "object")
          out.push({ key: `${slot.field}.${k}`, min: f.min, max: f.max, fixed: false });
      }
    }
  }
  return out;
}

/**
 * The most of `key` that fits with every other slot at its contract maximum, searched from the
 * slot's minimum up to `cap`. 0 when even the minimum does not fit.
 */
export function capacity(contract: SlotContract, key: string, cap = 16): number {
  const c = countables(contract).find((x) => x.key === key);
  if (!c) throw new Error(`${contract.form}: no slot ${key}`);
  let best = 0;
  for (let n = Math.max(1, c.min); n <= cap; n++) {
    if (!contractFits(contract, worstFill(contract, { [key]: n })).ok) break;
    best = n;
  }
  return best;
}

if (import.meta.main) {
  for (const contract of SLOT_CONTRACTS) {
    const full = contractFits(contract, worstFill(contract));
    const caps = countables(contract)
      .filter((c) => !c.fixed)
      .map((c) => `${c.key} ${c.max ?? "-"}→${capacity(contract, c.key)}`);
    console.log(
      `${contract.form}/${contract.layout}: ${full.ok ? "fits" : `FAILS ${full.failing.slice(0, 4).join("; ")}`}  ${caps.join("  ")}`,
    );
  }
}
