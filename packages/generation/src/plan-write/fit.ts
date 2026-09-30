import {
  contractFits,
  type MaterialiseMeta,
  materialiseSlide,
  type PaletteFormId,
  type SlideSpec,
  type SlideStructure,
  slideFits,
  slotContract,
  specOfWriter,
  THEMES,
} from "@tj/slides";
import { withAnswersReveal } from "../planner/coded-slides";
import { isSetForm, partsField, type SetForm } from "./menu";

/*
 * Plan-write's render and fit (spike/plan-write, step 4): a writer's output becomes its slide spec
 * (`specOfWriter`, or a question set), judged as the slot-contract drift test judges a contract
 * (`contractFits`: the save gate at body size on all 10 themes, every word kept, the form placed as
 * itself, the heading on one line, the reason within its panel). A failing slide gets ONE re-write
 * of the field the failure names, told what the slide showed. Nothing moves to the notes and the
 * form never changes: a slide that still fails is kept and flagged.
 */

export type Written = Record<string, unknown>;

export type Rendered = { spec: SlideSpec; variant?: string; structure: SlideStructure };

export type FitResult =
  | { ok: true }
  | {
      ok: false;
      /** The writer field the failure is attributed to. */
      field: string;
      /** What the slide showed, in plain words, with the themes it happened on. */
      failure: string;
      /** Themes that fail at all. */
      themes: string[];
    };

const SET_KIND: Record<
  SetForm,
  { kind: "starter" | "instructions" | "exit-ticket"; heading: string }
> = {
  "starter-set": { kind: "starter", heading: "Do now" },
  "check-set": { kind: "instructions", heading: "Quick check" },
  "exit-ticket": { kind: "exit-ticket", heading: "Exit ticket" },
};

type SetQuestion = { question: string; answer: string };

const notesOf = (...parts: unknown[]) =>
  parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join("\n");

/** A question set's spec: the questions listed, the answers as the reveal line and in the notes. */
function setSpec(form: SetForm, out: Written): SlideSpec {
  const qs = (out.questions ?? []) as SetQuestion[];
  const { kind, heading } = SET_KIND[form];
  const items = qs.map((q) => q.question);
  const answers = qs.map((q) => q.answer);
  const footnote = `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`;
  const listed = `Answers: ${answers.map((a, i) => `${i + 1}. ${a}`).join(" ")}`;
  const base = { factRefs: [] as string[], heading, footnote, notes: notesOf(out.notes, listed) };
  return (kind === "instructions"
    ? { kind, ...base, steps: items }
    : { kind, ...base, items }) as unknown as SlideSpec;
}

/** The slide spec a written slide makes, with its variant and structure; notes carried over. */
export function renderWritten(form: string, layout: string, out: Written): Rendered {
  if (isSetForm(form)) return { spec: setSpec(form, out), structure: {} };
  const { notes, ...fields } = out;
  const made = specOfWriter(form as PaletteFormId, fields, layout);
  if (!made) throw new Error(`plan-write: ${form} is not drawn on a slide`);
  const spec = { ...made.spec, notes: notesOf((made.spec as { notes?: string }).notes, notes) };
  return {
    spec: spec as SlideSpec,
    ...(made.variant ? { variant: made.variant } : {}),
    structure: made.structure,
  };
}

const FIT_META: MaterialiseMeta = {
  promptVersion: "fit",
  model: "code",
  at: "1970-01-01T00:00:00.000Z",
};

/** One theme's failure line (`"<theme>: <why>"`) as the field it names and plain words. */
export function attribute(
  line: string,
  form: string,
  layout: string,
  out: Written,
): { theme: string; field: string; what: string } {
  const at = line.indexOf(": ");
  const theme = line.slice(0, at);
  const why = line.slice(at + 2);
  const parts = isSetForm(form)
    ? "questions"
    : (partsField(slotContract(form as PaletteFormId, layout)) ?? "body");
  const heading = /^heading on (\d+) lines/.exec(why);
  if (heading)
    return { theme, field: "heading", what: `the heading sits on ${heading[1]} lines, not one` };
  const reason = /^reason on (\d+) lines, the panel keeps (\d+)/.exec(why);
  if (reason) {
    return {
      theme,
      field: "explanation",
      what: `the explanation takes ${reason[1]} lines where its panel shows ${reason[2]}`,
    };
  }
  const lost = /^not kept "(.*)$/.exec(why);
  if (lost) {
    const start = (lost[1] ?? "").replace(/"$/, "");
    const field =
      Object.keys(out).find((k) => k !== "notes" && JSON.stringify(out[k]).includes(start)) ??
      parts;
    return { theme, field, what: `"${start}…" is not shown on the slide` };
  }
  const placed = /^no (.+)$/.exec(why);
  if (placed) return { theme, field: parts, what: `the ${placed[1]} cannot be placed` };
  const said: string[] = [];
  if (why.includes("overflow")) said.push("the text runs past the slide's safe area");
  if (why.includes("overlap")) said.push("text overlaps other parts of the slide");
  if (why.includes("Why? lane")) {
    return { theme, field: "options", what: "the options run into the reveal panel's space" };
  }
  if (why.includes("stepped down")) said.push("the text has to be set below body size to fit");
  if (why.includes("answers cover")) said.push("the revealed answers cover the questions");
  return { theme, field: parts, what: said.join("; ") || why };
}

/**
 * A question set's failing themes, judged with its answers revealed, at body size (stepDown 0) as
 * every other slide is: the reveal no longer leaves the list stepped down (structure.ts).
 */
function setFailing(spec: SlideSpec): string[] {
  return THEMES.filter(
    (theme) =>
      !slideFits(withAnswersReveal(materialiseSlide(spec, theme.id, FIT_META), theme.id), theme, 0)
        .ok,
  ).map((t) => `${t.id}: overflow`);
}

function failingLines(form: string, layout: string, out: Written): string[] {
  if (isSetForm(form)) return setFailing(renderWritten(form, layout, out).spec);
  const { notes: _notes, ...fields } = out;
  return contractFits(slotContract(form as PaletteFormId, layout), fields).failing;
}

/** A probe value: every text cut to its first two words (measured only, never saved). */
function probeValue(v: unknown): unknown {
  if (typeof v === "string") return v.split(/\s+/).slice(0, 2).join(" ");
  if (Array.isArray(v)) return v.map(probeValue);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? probeValue(x) : x]),
    );
  }
  return v;
}

/**
 * A general failure (overflow, overlap, a step down) does not name its field. Probe it: the field
 * whose text, cut down in a probe, clears the most themes is the one that breaks the slide, and in
 * a list the item that does. Undefined when no single field clears any theme.
 */
export function locate(
  form: string,
  layout: string,
  out: Written,
): { field: string; item?: number } | undefined {
  // Each failing theme's reasons ("overflow, overlap, stepped down"), counted, so a probe that
  // lifts one reason on a theme still counts.
  const count = (o: Written) =>
    failingLines(form, layout, o).reduce(
      (n, l) => n + (l.split(": ")[1] ?? "").split(", ").length,
      0,
    );
  let best: { field: string; left: number } | undefined;
  for (const field of Object.keys(out)) {
    if (field === "notes" || out[field] === undefined || out[field] === null) continue;
    const left = count({ ...out, [field]: probeValue(out[field]) });
    if (!best || left < best.left) best = { field, left };
  }
  if (!best) return undefined;
  const failing = count(out);
  if (best.left >= failing) return undefined;
  const value = out[best.field];
  if (!Array.isArray(value) || value.length < 2) return { field: best.field };
  let item: { i: number; left: number } | undefined;
  value.forEach((_, i) => {
    const next = value.map((x, j) => (j === i ? probeValue(x) : x));
    const left = count({ ...out, [best.field]: next });
    if (left < failing && (!item || left < item.left)) item = { i, left };
  });
  return item ? { field: best.field, item: item.i + 1 } : { field: best.field };
}

const GENERAL = /runs past|overlaps|below body size|cover the questions/;

/** Judge a written slide; on failure, the field to re-write and why. */
export function fitWritten(form: string, layout: string, out: Written): FitResult {
  const lines = failingLines(form, layout, out);
  if (lines.length === 0) return { ok: true };
  const found = lines.map((l) => attribute(l, form, layout, out));
  const general = found.filter((f) => GENERAL.test(f.what));
  if (general.length > 0) {
    const at = locate(form, layout, out);
    if (at) {
      const where = at.item ? `; it is item ${at.item} of ${at.field} that does not fit` : "";
      for (const f of general) {
        f.field = at.field;
        f.what = `${f.what}${where}`;
      }
    }
  }
  // The field named on the most themes; its first description, with those themes.
  const byField = new Map<string, typeof found>();
  for (const f of found) byField.set(f.field, [...(byField.get(f.field) ?? []), f]);
  const [field, hits] = [...byField.entries()].sort((a, b) => b[1].length - a[1].length)[0] as [
    string,
    typeof found,
  ];
  const themes = [...new Set(found.map((f) => f.theme))];
  const on = [...new Set(hits.map((h) => h.theme))];
  const failure = `${hits[0]?.what} on ${on.length} of ${THEMES.length} themes (${on.join(", ")})`;
  return { ok: false, field, failure, themes };
}

/** Item kinds short enough that a trailing aside (" — why", "(the reason)") is never the answer. */
const SHORT_KINDS: ReadonlySet<string> = new Set(["phrase", "label", "term", "answer", "starter"]);
const ASIDE = /\s+[—–-]\s+\S.*$|\s*\([^()]*\)\s*$/;

const unaside = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const cut = v.replace(ASIDE, "").trim();
  return cut === "" ? v : cut;
};

/** How many themes a written slide fails on. */
const failingThemes = (form: string, layout: string, out: Written) =>
  new Set(failingLines(form, layout, out).map((l) => l.slice(0, l.indexOf(": ")))).size;

/**
 * The mechanical shrink (no call): each short item loses a trailing aside (a reason or a label
 * such as " — the common mistake"), then an optional slot (min 0) drops items from its end. Each
 * step is kept only when the slide then fails on fewer themes. A question set drops its last
 * questions instead, down to one.
 */
export function shrink(form: string, layout: string, out: Written): Written {
  let best = out;
  let fails = failingThemes(form, layout, out);
  const tryIt = (next: Written) => {
    if (fails === 0) return;
    const n = failingThemes(form, layout, next);
    if (n < fails) {
      best = next;
      fails = n;
    }
  };
  if (isSetForm(form)) {
    // A set's capacity is not measured: its last questions go, down to one, while it fails.
    let qs = best.questions;
    while (fails > 0 && Array.isArray(qs) && qs.length > 1) {
      const before = best;
      tryIt({ ...best, questions: qs.slice(0, -1) });
      if (best === before) break;
      qs = best.questions;
    }
    return best;
  }
  const contract = slotContract(form as PaletteFormId, layout);
  // 1. Asides off the short items.
  const stripped: Written = { ...best };
  for (const slot of contract.slots) {
    if (slot.place === "notes" || slot.place === "off-slide") continue;
    const v = stripped[slot.field];
    if (!Array.isArray(v)) continue;
    stripped[slot.field] = v.map((item) => {
      if (typeof slot.each === "string") return SHORT_KINDS.has(slot.each) ? unaside(item) : item;
      if (!item || typeof item !== "object") return item;
      const each = slot.each as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([k, x]) => [
          k,
          typeof each[k] === "string" && SHORT_KINDS.has(each[k] as string) ? unaside(x) : x,
        ]),
      );
    });
  }
  tryIt(stripped);
  // 2. Optional items off the end of an optional slot.
  for (const slot of contract.slots) {
    if (slot.min > 0) continue;
    let v = best[slot.field];
    while (fails > 0 && Array.isArray(v) && v.length > 0) {
      const next = { ...best, [slot.field]: v.slice(0, -1) };
      const before = best;
      tryIt(next);
      if (best === before) break;
      v = best[slot.field];
    }
  }
  return best;
}

export type Rewrite = (field: string, failure: string) => Promise<Written | undefined>;

export type Fitted = {
  out: Written;
  fit: FitResult;
  /** Set when the slide failed at first and a re-write was asked for. */
  rewritten?: { field: string; failure: string; ok: boolean };
  /** Set when the mechanical shrink changed the slide. */
  shrunk?: boolean;
};

/**
 * The slide as written when it fits. Otherwise the mechanical shrink first (no call); then, if it
 * still fails, one re-write of the field named, and the shrink again on what comes back. The
 * re-written field is kept when the slide then fits, or fails on no more themes than before;
 * either way a slide that still fails is returned with its failure for the flag.
 */
export async function fitWithRewrite(
  form: string,
  layout: string,
  out: Written,
  rewrite: Rewrite,
): Promise<Fitted> {
  const initial = fitWritten(form, layout, out);
  if (initial.ok) return { out, fit: initial };
  // A set is re-written before it loses a question; other slides shrink first (no call).
  const small = isSetForm(form) ? out : shrink(form, layout, out);
  const shrunk = small !== out ? { shrunk: true } : {};
  const first = small !== out ? fitWritten(form, layout, small) : initial;
  if (first.ok) return { out: small, fit: first, ...shrunk };
  const { field, failure } = first;
  const patch = await rewrite(field, failure).catch(() => undefined);
  if (!patch || !(field in patch)) {
    return { out: small, fit: first, rewritten: { field, failure, ok: false }, ...shrunk };
  }
  const raw = { ...small, [field]: patch[field] };
  const next = shrink(form, layout, raw);
  const also = next !== raw ? { shrunk: true } : shrunk;
  const again = fitWritten(form, layout, next);
  if (again.ok) return { out: next, fit: again, rewritten: { field, failure, ok: true }, ...also };
  const better = again.themes.length <= first.themes.length;
  return {
    out: better ? next : small,
    fit: better ? again : first,
    rewritten: { field, failure, ok: false },
    ...(better ? also : shrunk),
  };
}
