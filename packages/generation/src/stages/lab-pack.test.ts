import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Lesson } from "@tj/domain/documents";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import { REFERENCE_INSTRUCTION } from "../prompts/plan-facts-objective";
import { CURRICULUM_INSTRUCTION, PACK_INSTRUCTION } from "../prompts/plan-objectives";
import { labAi, recordingDeps, romansLesson } from "../testing";
import type { LabPack } from "../types";
import { runLessonPipeline } from "../workflow";

/*
 * Lab l6kp2 plan A, E53 (knowledge packs on the objectives-first planner): no planner call sees the
 * pack. The objectives call is byte-identical to a no-pack run; each objective is matched to a
 * section in code (`matchPackSections`), and that section's reference reaches that objective's
 * teach call only. Without a pack every user turn is pinned by hash (CORE 2026-09-26: the
 * unassigned bytes at pipeline level, not only the template hash).
 */

const promptOf = (c: { promptText: string }) => c.promptText;
const version = (c: { context?: { promptVersion?: string } }) => c.context?.promptVersion ?? "";

// Romans objectives: 0 invasion (no section), 1 Boudica (section 0), 2 settlements (section 1).
const PACK: LabPack = {
  id: "pack-test",
  dropped: ["sec0.f1"],
  sections: [
    {
      outcome: "I can explain why Boudica and the Iceni rebelled against Roman control.",
      text: "- Boudica led the Iceni in a rebellion in AD 60.\n- The rebellion burned Roman towns.",
    },
    {
      outcome: "I can describe how Roman settlements, roads and towns changed everyday life.",
      text: "- Settlements had baths, markets and straight roads.\n- Everyday life changed in towns.",
    },
  ],
  referenceFor: (i) => `- PACK-REF-MARKER-${i}`,
};
const EXPECTED_SECTIONS = [null, 0, 1];

async function run(withPack: boolean) {
  const ai = labAi({});
  const deps = { ...recordingDeps(ai), ...(withPack ? { labPack: PACK } : {}) };
  const planned = await runLessonPipeline({ lesson: romansLesson() }, deps, {
    stopAfter: "planned",
    planner: "objectives-first",
  });
  const lesson = {
    ...planned.lesson,
    plan: { revision: 1, state: "confirmed", confirmedAt: "2026-09-27T10:00:00.000Z" },
  } as Lesson;
  const done = await runLessonPipeline({ lesson }, deps);
  return { ai, planned: planned.lesson, lesson: done.lesson };
}

const objectivesTurns = (ai: {
  calls: { promptText: string; context?: { promptVersion?: string } }[];
}) => ai.calls.filter((c) => version(c).startsWith("plan-objectives")).map(promptOf);

describe("labPack on the objectives-first planner (plan A)", () => {
  test("the objectives call is byte-identical with and without a pack", async () => {
    const withPack = objectivesTurns((await run(true)).ai);
    const without = objectivesTurns((await run(false)).ai);
    expect(withPack.length).toBeGreaterThan(0);
    expect(withPack).toEqual(without);
    expect(withPack.some((t) => t.includes(PACK_INSTRUCTION) || t.includes("PACK-"))).toBe(false);
  });

  test("no call but the matched teach calls sees pack text, and no select call runs", async () => {
    const { ai } = await run(true);
    const teach = (c: { context?: { promptVersion?: string } }) =>
      version(c).startsWith("plan-teach-objective");
    expect(ai.calls.filter((c) => !teach(c)).some((c) => promptOf(c).includes("PACK-"))).toBe(
      false,
    );
    expect(ai.calls.some((c) => version(c).startsWith("pack-select"))).toBe(false);
  });

  test("each objective's section reaches its own teach call as the reference", async () => {
    const { ai } = await run(true);
    const teach = ai.calls.filter((c) => version(c).startsWith("plan-teach-objective"));
    expect(teach).toHaveLength(romans.objectives.length);
    const target = (c: { promptText: string }) =>
      Number(/for objective (\d+):/.exec(c.promptText)?.[1]);
    for (const c of teach) {
      const t = target(c);
      expect(promptOf(c)).not.toContain("Unit outcomes");
      expect(promptOf(c)).not.toContain(CURRICULUM_INSTRUCTION);
      if (EXPECTED_SECTIONS[t] === null) {
        expect(promptOf(c)).not.toContain("PACK-REF-MARKER");
        expect(promptOf(c)).not.toContain(REFERENCE_INSTRUCTION);
      } else {
        expect(promptOf(c)).toContain(REFERENCE_INSTRUCTION);
        expect(promptOf(c)).toContain(`PACK-REF-MARKER-${EXPECTED_SECTIONS[t]}`);
      }
    }
    const sets = ai.calls.filter((c) => version(c).startsWith("plan-question-set"));
    expect(sets.some((c) => promptOf(c).includes("PACK-REF-MARKER"))).toBe(false);
  });

  test("the stored lesson records each objective's section and the pack", async () => {
    const { planned, lesson } = await run(true);
    const expected = EXPECTED_SECTIONS;
    for (const l of [planned, lesson]) {
      expect(l.facts?.objectives.map((o) => o.packSection)).toEqual(expected);
      expect(l.generation?.labPack).toEqual({
        id: "pack-test",
        dropped: ["sec0.f1"],
        packSections: expected,
      });
    }
  });

  test("without labPack no call carries pack text and nothing is recorded", async () => {
    const { ai, lesson } = await run(false);
    expect(ai.calls.some((c) => promptOf(c).includes("PACK-"))).toBe(false);
    expect(ai.calls.some((c) => promptOf(c).includes(PACK_INSTRUCTION))).toBe(false);
    expect(lesson.generation?.labPack).toBeUndefined();
    expect(lesson.facts?.objectives.every((o) => o.packSection === undefined)).toBe(true);
  });

  test("without labPack every user turn is byte-identical to the pinned run", async () => {
    const { ai } = await run(false);
    const turns = ai.calls
      .map(
        (c) =>
          `${version(c)} ${createHash("sha256").update(promptOf(c)).digest("hex").slice(0, 16)}`,
      )
      .sort();
    expect(turns).toEqual(NO_PACK_TURNS);
  });
});

/**
 * The no-pack run's user turns at lab/l6kp2 5a80824a (prompt side of plan A, before this wiring),
 * sorted (waves run concurrently). Checked 27 Sept 2026: the same bytes as master 6484e888 once
 * the terms line (`audienceBlock`, plan A item 4) is removed. Regenerate only for a deliberate prompt or pipeline change, and say why.
 */
const NO_PACK_TURNS: string[] = [
  "check-input.v5 d5690b62b013a5ce",
  "evaluate.v10 16e65e4ac456afc4",
  "generate-slide.v30 3bdcfb133230f6f1",
  "generate-slide.v30 46dae8ff816eb45a",
  "generate-slide.v30 75c49fc53d59abc2",
  "generate-slide.v30 8055613ef8684a29",
  "generate-slide.v30 933f014e211fd274",
  "generate-slide.v30 e2d27b3d2c44f8ea",
  "generate-slide.v30 efa82c68df7ea992",
  "plan-objectives.v19 1a63bbab0ad3b528",
  "plan-question-set.v8 008a4f45b1d9ba2b",
  "plan-question-set.v8 35b9029a14e2c605",
  "plan-question-set.v8 8de4686002a91395",
  "plan-question-set.v8 92ededbb4aea5fa8",
  "plan-question-set.v8 d5c28de753e433e8",
  "plan-question-set.v8 eefda2f89718ab70",
  "plan-teach-objective.v4 1bf907e0b21d741a",
  "plan-teach-objective.v4 82ea1940e0c91479",
  "plan-teach-objective.v4 b495e536357518d1",
  "repair.v17 0908e0b885d023e2",
  "repair.v17 594ecc490bcb1da9",
  "repair.v17 5bc0e9d7a4a248c8",
  "repair.v17 89dd62b61d4442da",
  "repair.v17 9d85a090f39993eb",
  "repair.v17 f8cd7db8dc9a0bd4",
  "verify-facts.v8 338d2b82928ac181",
];
