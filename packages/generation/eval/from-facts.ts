// Loading a saved lab run's objectives and facts, for the steps that re-run the outline on them
// with no model call: `eval/replay-outline.ts` (outline before/after, in code) and
// `lab.ts --from-facts <runDir>` (the outline and every stage after Plan, facts held fixed).

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Lesson, LessonFacts } from "@tj/domain/documents";
import type { OutlineFacts } from "../src/outline-from-facts";
import type { OrdinalRef } from "../src/specs";

export const LAB_RESULTS = join(import.meta.dir, "results", "lab");

/** `LessonFacts` (ids) back to the merged facts the outline step reads (ordinal refs). */
export function toOutlineFacts(facts: LessonFacts): OutlineFacts {
  const index = (list: { id: string }[]) => new Map(list.map((x, i) => [x.id, i]));
  const objective = index(facts.objectives);
  const misconception = index(facts.misconceptions);
  const objectives = (ids: string[] | undefined): OrdinalRef[] =>
    (ids ?? []).flatMap((id) => {
      const i = objective.get(id);
      return i === undefined ? [] : [{ type: "objective" as const, index: i }];
    });
  const mis = (id: string | undefined) => {
    const i = id === undefined ? undefined : misconception.get(id);
    return i === undefined ? undefined : { type: "misconception" as const, index: i };
  };
  const strip = <T extends { id: string }>({ id: _id, ...rest }: T) => rest;
  return {
    keyIdeas: (facts.keyIdeas ?? []).map((k) => ({
      ...strip(k),
      objectiveRefs: objectives(k.objectiveRefs),
    })),
    misconceptions: facts.misconceptions.map((m) => ({
      ...strip(m),
      objectiveRefs: objectives(m.objectiveRefs),
    })),
    vocabulary: facts.vocabulary.map((v) => ({
      ...strip(v),
      objectiveRefs: objectives(v.objectiveRefs),
    })),
    workedExamples: facts.workedExamples.map((x) => {
      const { misconceptionRef, objectiveRefs, ...rest } = strip(x);
      const m = mis(misconceptionRef);
      return {
        ...rest,
        ...(m ? { misconceptionRef: m } : {}),
        ...(objectiveRefs ? { objectiveRefs: objectives(objectiveRefs) } : {}),
      };
    }),
    questions: facts.questions.map((q) => {
      const { distractors, objectiveRefs, ...rest } = strip(q);
      return {
        ...rest,
        objectiveRefs: objectives(objectiveRefs),
        distractors: (distractors ?? []).map((d) => {
          const m = mis(d.misconceptionRef);
          return { text: d.text, ...(m ? { misconceptionRef: m } : {}) };
        }),
      };
    }),
  } as unknown as OutlineFacts;
}

/** A saved run's objectives and facts, as the lab plan path would have them after the merge. */
export interface SavedRunFacts {
  /** The run's label (its directory name). */
  run: string;
  dir: string;
  briefId: string;
  /** Where the facts were read from, relative to the run dir. */
  factsFrom: string;
  objectives: { text: string; curriculumAnchor?: string | undefined }[];
  /** The ids form, as saved. */
  lessonFacts: LessonFacts;
  /** The merged form (ordinal refs) the outline step reads. */
  facts: OutlineFacts;
  /** The original run's np1 arm, if any (recorded, not re-run). */
  arm: string | null;
}

/** A label under `eval/results/lab/` or a path to a run directory. */
export function runDirOf(ref: string): string {
  const asPath = resolve(ref);
  return existsSync(join(asPath, "result.json")) ? asPath : join(LAB_RESULTS, ref);
}

/**
 * The facts the run's slides were written from: the first `generated` snapshot (Generate awaits
 * Verify before its first persist, so these are Verify's corrected facts, and Repair has not yet
 * touched them); else the last `planned` snapshot (a run that stopped in Generate); else the
 * final `lesson.json` (after Repair, which can change facts).
 */
export async function loadRunFacts(ref: string): Promise<SavedRunFacts> {
  const dir = runDirOf(ref);
  const result = JSON.parse(await readFile(join(dir, "result.json"), "utf8")) as {
    brief: string;
    labPlan?: { objectives?: SavedRunFacts["objectives"] } | null;
    experiment?: { arm?: string } | null;
  };
  const snapshots = existsSync(join(dir, "snapshots"))
    ? (await readdir(join(dir, "snapshots"))).filter((f) => f.endsWith(".json")).sort()
    : [];
  const factsIn = async (file: string) =>
    (JSON.parse(await readFile(join(dir, file), "utf8")) as { lesson: Lesson }).lesson.facts;
  const candidates = [
    ...snapshots.filter((f) => /^\d+-generated-/.test(f)).slice(0, 1),
    ...snapshots.filter((f) => /^\d+-planned-/.test(f)).slice(-1),
  ].map((f) => `snapshots/${f}`);
  let lessonFacts: LessonFacts | undefined;
  let factsFrom = "lesson.json";
  for (const file of candidates) {
    lessonFacts = await factsIn(file);
    if (lessonFacts) {
      factsFrom = file;
      break;
    }
  }
  if (!lessonFacts) {
    const lesson = JSON.parse(await readFile(join(dir, "lesson.json"), "utf8")) as Lesson;
    lessonFacts = lesson.facts;
  }
  if (!lessonFacts) throw new Error(`from-facts: ${dir} has no saved facts`);
  const objectives =
    result.labPlan?.objectives ?? lessonFacts.objectives.map((o) => ({ text: o.text }));
  if (objectives.length !== lessonFacts.objectives.length)
    throw new Error(
      `from-facts: ${dir}: ${objectives.length} objectives in result.json, ${lessonFacts.objectives.length} in the facts`,
    );
  return {
    run: basename(dir),
    dir,
    briefId: result.brief,
    factsFrom,
    objectives,
    lessonFacts,
    facts: toOutlineFacts(lessonFacts),
    arm: result.experiment?.arm ?? null,
  };
}
