import { readFileSync } from "node:fs";
import { z } from "zod";
import { callStructured, type StructuredPrompt } from "../src/call";
import type { LabPack, PipelineDeps } from "../src/types";

/*
 * Lab l6kp2: lab/l6kp's grounded arm ported onto the objectives-first planner (TEACH-93). A Sol
 * recall pack (packs2 format, `<topic>.sol-recall-selfchecklist.json`) minus the facts the
 * in-session check dropped (`drop-<topic>.txt`, ids `secN.fK`, K the 0-based flat position across
 * the fact types in order) becomes `deps.labPack`: the section outcomes as the curriculum extract,
 * and per objective one select call (pack-select.v1, verbatim from lab/l6kp eval/packs/prompts.ts)
 * whose matched section's facts go to that objective's teach call as reference text
 * (`referenceText`, verbatim from lab/l6kp eval/pack-arms.ts). Every fact is still written live.
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

/**
 * l6kp (retired by l6kp2 plan A, 27 Sept 2026): the outcomes as a "unit" in the curriculum slot.
 * Under `CURRICULUM_USE`'s "span its arc" the objectives mapped one to one onto the sections.
 * `packSections` replaces it; see `lab/l6-kpack/HANDOFF-CODE.md`.
 */
export function outcomesText(pack: RecallPack): string {
  return [
    "Unit outcomes (one per section):",
    ...pack.sections.map((s, i) => `${i + 1}. ${s.outcome}`),
  ].join("\n");
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

export const PackSelectOutputSchema = z.strictObject({
  section: z.number().int().nonnegative().nullable(),
  coverage: z.enum(["full", "partial", "none"]),
  missingTypes: z.array(z.enum(FACT_TYPES)),
  missingConcepts: z.array(z.string().max(120)).max(6),
});

interface PackSelectInput {
  subject: string;
  yearGroup: string;
  packYearGroup: string;
  objective: string;
  sections: readonly { outcome: string; types: readonly string[] }[];
}

export const packSelectPrompt: StructuredPrompt<PackSelectInput> = {
  version: "pack-select.v1",
  system: `You decide whether a section of a stored topic pack can supply the facts for one lesson objective. A wrong match puts facts about something else into the lesson and nobody sees it, so it is far worse than no match: match only when you are sure.

Each section line gives its number, its outcome (what it teaches) and, in brackets, the fact types it holds. A pack written for a different year group from the lesson's matches nothing.

Judge by content, not wording or command verbs: "describe", "explain", "outline" or "evaluate" asked of the same thing are the same claim. The same topic, event, process, period, place or skill must be the focus of both.

- full: one section's outcome teaches the whole objective.
- partial: one section's outcome squarely teaches part of the objective but not all of it, because the objective joins two aims or needs a concept the outcome does not cover. missingConcepts names each missing aim or concept in a few words (at most 6); missingTypes lists the fact types a writer must add to teach them.
- none: no section's outcome teaches the objective or a whole aim within it. A section on a neighbouring topic, the same unit, a different example, place or period, a different stage of the same process (planning a meal versus making it), or one that only shares key words is none.

section is the chosen section's number, or null for none. Both lists are empty except for partial.

If two sections fit, pick the one whose outcome matches more closely. When torn between full and partial choose partial; between partial and none choose none.`,
  user: (i) =>
    [
      `Subject: ${i.subject}; Lesson year group: ${i.yearGroup}`,
      `Objective: ${i.objective}`,
      `Sections (pack for ${i.packYearGroup}):`,
      ...i.sections.map((s, n) => `${n}: ${s.outcome} [${s.types.join(", ")}]`),
    ].join("\n"),
};

export interface Selection {
  objective: string;
  section: string | null;
  coverage: string;
}

/** `deps.labPack` for one pack; `selections` collects the select decisions for the report. */
export function labPackFor(
  pack: RecallPack,
  audience: { subject: string; yearGroup: string },
  deps: () => PipelineDeps,
  selections: Selection[],
): LabPack {
  return {
    curriculum: { text: outcomesText(pack) },
    referencesFor: (objectives) =>
      Promise.all(
        objectives.map(async (o) => {
          const r = await callStructured({
            deps: deps(),
            stage: "plan",
            cls: "standard",
            effort: "low",
            prompt: packSelectPrompt,
            input: {
              ...audience,
              packYearGroup: pack.yearGroup,
              objective: o.text,
              sections: pack.sections.map((s) => ({
                outcome: s.outcome,
                types: FACT_TYPES.filter((t) => s.facts[t].length > 0),
              })),
            },
            schema: PackSelectOutputSchema,
            maxOutputTokens: 600,
          });
          const d = r.output;
          const section =
            d.section !== null && d.coverage !== "none" ? (pack.sections[d.section] ?? null) : null;
          selections.push({
            objective: o.text,
            section: section?.id ?? null,
            coverage: d.coverage,
          });
          return section ? referenceText(section) : undefined;
        }),
      ),
  };
}
