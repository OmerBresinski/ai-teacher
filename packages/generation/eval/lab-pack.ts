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
  sections: { id: string; outcome: string; facts: Record<FactType, Fact[]> }[];
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

export function outcomesText(pack: RecallPack): string {
  return [
    "Unit outcomes (one per section):",
    ...pack.sections.map((s, i) => `${i + 1}. ${s.outcome}`),
  ].join("\n");
}

export function referenceText(section: RecallPack["sections"][number]): string {
  const f = section.facts;
  const L: string[] = [];
  for (const k of f.keyIdeas)
    L.push(`- Key idea: ${k.statement} ${k.explanation} Example: ${k.example}`);
  for (const m of f.misconceptions)
    L.push(`- Misconception: pupils think ${m.belief}; in fact ${m.correction}`);
  for (const v of f.vocabulary) L.push(`- Term: ${v.term} — ${v.definition}`);
  for (const x of f.workedExamples)
    L.push(`- Worked example: ${x.problem} Steps: ${x.steps.join(" ")} Answer: ${x.answer}`);
  for (const q of f.questions) L.push(`- Question: ${q.stem} Answer: ${q.answer}`);
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
