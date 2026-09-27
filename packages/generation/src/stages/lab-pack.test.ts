import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import { labAi, recordingDeps, romansLesson } from "../testing";
import { runLessonPipeline } from "../workflow";

/*
 * Lab l6kp2 (knowledge packs on the objectives-first planner): `deps.labPack` puts the pack's
 * outcomes in the objectives call and the teach calls as the curriculum extract, and each
 * objective's reference text in that objective's teach call only. Without it nothing changes.
 */

const OUTCOMES = "Unit outcomes (one per section):\n1. PACK-OUTCOME-MARKER";
const promptOf = (c: { promptText: string }) => c.promptText;
const version = (c: { context?: { promptVersion?: string } }) => c.context?.promptVersion ?? "";

async function run(withPack: boolean) {
  // With an extract the objectives schema asks for an anchor per objective.
  const ai = labAi(
    withPack
      ? { objectives: romans.objectives.map((o) => ({ ...o, curriculumAnchor: "outcome 1" })) }
      : {},
  );
  const seen: string[][] = [];
  const deps = {
    ...recordingDeps(ai),
    ...(withPack
      ? {
          labPack: {
            curriculum: { text: OUTCOMES },
            referencesFor: async (objectives: { text: string }[]) => {
              seen.push(objectives.map((o) => o.text));
              return objectives.map((_, i) =>
                i === 1 ? "- Key idea: PACK-REF-MARKER" : undefined,
              );
            },
          },
        }
      : {}),
  };
  const planned = await runLessonPipeline({ lesson: romansLesson() }, deps, {
    stopAfter: "planned",
    planner: "objectives-first",
  });
  const lesson = {
    ...planned.lesson,
    plan: { revision: 1, state: "confirmed", confirmedAt: "2026-09-27T10:00:00.000Z" },
  } as Lesson;
  await runLessonPipeline({ lesson }, deps);
  return { ai, seen };
}

describe("labPack on the objectives-first planner", () => {
  test("outcomes reach the objectives and teach calls; a reference reaches its own teach call only", async () => {
    const { ai, seen } = await run(true);
    const objectives = ai.calls.filter((c) => version(c).startsWith("plan-objectives"));
    expect(objectives.length).toBeGreaterThan(0);
    expect(objectives.every((c) => promptOf(c).includes("PACK-OUTCOME-MARKER"))).toBe(true);
    const teach = ai.calls.filter((c) => version(c).startsWith("plan-teach-objective"));
    expect(teach.length).toBeGreaterThan(1);
    expect(teach.every((c) => promptOf(c).includes("PACK-OUTCOME-MARKER"))).toBe(true);
    const withRef = teach.filter((c) => promptOf(c).includes("PACK-REF-MARKER"));
    expect(withRef).toHaveLength(1);
    expect(seen).toHaveLength(1);
    const sets = ai.calls.filter((c) => version(c).startsWith("plan-question-set"));
    expect(sets.some((c) => promptOf(c).includes("PACK-REF-MARKER"))).toBe(false);
  });

  test("without labPack no call carries pack text", async () => {
    const { ai } = await run(false);
    expect(ai.calls.some((c) => promptOf(c).includes("PACK-"))).toBe(false);
  });
});
