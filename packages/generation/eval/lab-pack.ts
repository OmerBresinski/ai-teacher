import { readFileSync } from "node:fs";
import type { LabPack } from "../src/types";

/*
 * Lab l6kp2: a Sol recall pack (packs2 format, `<topic>.sol-recall-selfchecklist.json`) minus the
 * facts the in-session check dropped (`drop-<topic>.txt`, ids `secN.fK`, K the 0-based flat
 * position across the fact types in order) becomes `deps.labPack` (plan A, E53): no planner call
 * sees the sections; each objective is matched to one in code (`stages/pack-map.ts`) and that
 * section goes to its teach call as reference text (`referenceText`). Every fact is written live.
 */

export const FACT_TYPES = [
  "keyIdeas",
  "misconceptions",
  "vocabulary",
  "workedExamples",
  "questions",
] as const;
type FactType = (typeof FACT_TYPES)[number];

/**
 * Lab-only per-fact fields of the Oak packs (`quality-prd/lab/oak-packs`, 28 Sept 2026; FIX-PLAN
 * plan C): what a fact is, where it comes from, and where to find it. `kind` sits inside the
 * existing lists (a quotation, date or figure is a key idea's `statement`; a term is a vocabulary
 * item), so the lists and `referenceText` are unchanged; `locator` is what `referenceText` puts
 * after a quoted sentence. Recall packs written before this carry none of them.
 */
export type PackFactKind =
  | "keyIdea"
  | "term"
  | "misconception"
  | "quotation"
  | "date"
  | "figure"
  | "workedExample";
export interface PackFactMeta {
  kind?: PackFactKind;
  /** Oak lesson (`oak:<slug>`), act.scene and speaker, stanza and line, with the edition. */
  locator?: string;
  /** `oak`: imported with no model; `model`: written by the pack model (the fill share). */
  source?: "oak" | "model";
}

// biome-ignore lint/suspicious/noExplicitAny: recall pack facts are read field by field below.
type Fact = any;
export interface RecallPack {
  id: string;
  yearGroup: string;
  sections: { id: string; title?: string; outcome: string; facts: Record<FactType, Fact[]> }[];
}

export function loadRecallPack(
  path: string,
  dropPath?: string,
): { pack: RecallPack; dropped: string[] } {
  const pack = JSON.parse(readFileSync(path, "utf8")) as RecallPack;
  const drop = new Set(
    dropPath
      ? readFileSync(dropPath, "utf8")
          .split("\n")
          .map((l) => l.replace(/#.*/, "").trim())
          .flatMap((l) => l.split(/[\s,]+/))
          .filter(Boolean)
      : [],
  );
  for (const id of drop) if (!/^sec\d+\.f\d+$/.test(id)) throw new Error(`drop: bad id ${id}`);
  const dropped: string[] = [];
  const sections = pack.sections.map((s) => {
    let flat = 0;
    const facts = {} as Record<FactType, Fact[]>;
    for (const t of FACT_TYPES)
      facts[t] = (s.facts[t] ?? []).filter(() => {
        const id = `${s.id}.f${flat++}`;
        if (!drop.has(id)) return true;
        dropped.push(id);
        return false;
      });
    return { ...s, facts };
  });
  const unknown = [...drop].filter((id) => !dropped.includes(id));
  if (unknown.length > 0) throw new Error(`drop: ids not in the pack: ${unknown.join(", ")}`);
  return { pack: { ...pack, sections }, dropped };
}

/** The pack as the objectives call's menu (`PlanObjectivesInput.pack`, plan-objectives v19). */
export function packSections(pack: RecallPack): { title?: string; outcome: string }[] {
  return pack.sections.map((s) =>
    s.title ? { title: s.title, outcome: s.outcome } : { outcome: s.outcome },
  );
}

/**
 * One sentence per line. A stop may be followed by a closing quote; the next sentence opens
 * with a capital, a bracket or an opening quote, so a quotation's own stops do not split it.
 */
const SENTENCE_BREAK = /(?<=[.!?]['’”"]?)\s+(?=[A-Z(‘“"'])/;
const QUOTED = /[‘“"]/;

/**
 * A pack section as a pool of facts for one teach call (plan A, 27 Sept 2026; FIX-PLAN cause 2).
 * Plain lines, one claim each, in no order the call is asked to keep: a key idea's statement,
 * explanation and example are split into sentences; a term is `term: definition`; a worked
 * example is one line. Pack questions have no reader (the question call is not shown the pack),
 * and vocabulary `sense` and `band` are dropped. A misconception is rendered only when its
 * `source` is `oak` (28 Sept 2026, the Oak packs): Oak's are documented, and they go last, one
 * line each, labelled so the teach call reads the belief as false. A recall pack's own
 * misconceptions (no `source`, or `model`) stay dropped: the subject expert judged about half of
 * them invented (EXPERT-SUBJECT.md), and verify never sees the pack, so an invented one shown as
 * "pupils think" would pass unchecked. A fact's `locator`, where a pack carries one, follows each
 * of its quoted sentences in brackets, which is what `REFERENCE_INSTRUCTION`'s "with their locator
 * where one is given" reads. No "Key idea:" label on the fact lines: rendered in the teach call's
 * own output shape, the section was paraphrased back whole (EXPERT-PROMPTS T1).
 */
/**
 * A quotation fact as one line: the words in curly quotes, the locator in brackets, then what the
 * words show when the fact says more than the words (a `pack-oak-fill.v1` quotation carries both;
 * a reused one's statement is the quotation itself). Null for a fact with no `quote`. Shared with
 * the fill call's "facts already in the section" (`oakFactLines`), so both show the locator.
 */
export function quotationLine(k: {
  quote?: string;
  statement?: string;
  locator?: string;
}): string | null {
  if (!k.quote) return null;
  const bare = (t: string) => t.replace(/^[“"‘']+|[”"’']+$/g, "").trim();
  const quote = bare(k.quote);
  const about = k.statement && bare(k.statement) !== quote ? `: ${k.statement}` : "";
  return `“${quote}”${k.locator ? ` (${k.locator})` : ""}${about}`;
}

export function referenceText(section: RecallPack["sections"][number]): string {
  const f = section.facts;
  const L: string[] = [];
  // An Oak fact's locator is its lesson (`oak:<slug>`), not a place in a text: never shown, even
  // when the sentence quotes a title ("‘The Tempest’ is considered…").
  const locate = (sentence: string, locator?: string) =>
    locator && !locator.startsWith("oak:") && QUOTED.test(sentence)
      ? `${sentence} (${locator})`
      : sentence;
  const add = (text: string | undefined, locator?: string) => {
    for (const s of (text ?? "").split(SENTENCE_BREAK)) {
      const t = s.trim();
      if (t) L.push(`- ${locate(t, locator)}`);
    }
  };
  for (const k of f.keyIdeas) {
    const quoted = quotationLine(k);
    if (quoted) {
      L.push(`- ${quoted}`);
      continue;
    }
    add(k.statement, k.locator);
    add(k.explanation, k.locator);
    add(k.example, k.locator);
  }
  for (const v of f.vocabulary) L.push(`- ${v.term}: ${v.definition}`);
  for (const x of f.workedExamples)
    L.push(`- ${locate(`${x.problem} ${x.steps.join(" ")} ${x.answer}`, x.locator)}`);
  for (const m of f.misconceptions)
    if (m.source === "oak") L.push(`- Misconception: ${m.belief} Response: ${m.correction}`);
  return L.join("\n");
}

/** `deps.labPack` for one loaded pack (plan A): the menu, the drop list and the reference per section. */
export function labPackOf(loaded: { pack: RecallPack; dropped: string[] }): LabPack {
  const { pack, dropped } = loaded;
  return {
    id: pack.id,
    dropped,
    sections: pack.sections.map((s) => ({
      ...(s.title ? { title: s.title } : {}),
      outcome: s.outcome,
      text: referenceText(s),
    })),
    referenceFor: (index) => {
      const section = pack.sections[index];
      if (!section) throw new Error(`lab pack ${pack.id}: no section ${index}`);
      return referenceText(section);
    },
  };
}
