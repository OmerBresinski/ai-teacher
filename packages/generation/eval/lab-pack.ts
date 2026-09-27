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
 * and vocabulary `sense` and `band` are dropped. Pack misconceptions are dropped too until the
 * packs are rebuilt (plan C): the subject expert judged about half of them invented
 * (EXPERT-SUBJECT.md), the teach call writes exactly one misconception of its own in any case,
 * and verify never sees the pack, so an invented one shown as "pupils think" would pass
 * unchecked; the true facts their corrections carry are already in the key ideas. A fact's `locator`, where a pack carries one, follows each of its quoted sentences in
 * brackets, which is what `REFERENCE_INSTRUCTION`'s "with their locator where one is given" reads.
 * No "Key idea:" / "Misconception:" labels: rendered in the teach call's own output shape, the
 * section was paraphrased back whole (EXPERT-PROMPTS T1).
 */
export function referenceText(section: RecallPack["sections"][number]): string {
  const f = section.facts;
  const L: string[] = [];
  const locate = (sentence: string, locator?: string) =>
    locator && QUOTED.test(sentence) ? `${sentence} (${locator})` : sentence;
  const add = (text: string | undefined, locator?: string) => {
    for (const s of (text ?? "").split(SENTENCE_BREAK)) {
      const t = s.trim();
      if (t) L.push(`- ${locate(t, locator)}`);
    }
  };
  for (const k of f.keyIdeas) {
    add(k.statement, k.locator);
    add(k.explanation, k.locator);
    add(k.example, k.locator);
  }
  for (const v of f.vocabulary) L.push(`- ${v.term}: ${v.definition}`);
  for (const x of f.workedExamples)
    L.push(`- ${locate(`${x.problem} ${x.steps.join(" ")} ${x.answer}`, x.locator)}`);
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
