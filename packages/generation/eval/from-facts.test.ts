import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import type { Lesson } from "@tj/domain/documents";
import { runLabPipeline } from "../src/lab/plan-pipeline";
import { FIXTURES, recordingDeps } from "../src/testing";
import { LAB_RESULTS, loadRunFacts } from "./from-facts";
import { fromFactsDryRun } from "./lab";

/*
 * `lab.ts --from-facts` on a real saved np1 run (gitignored results; skipped where absent), every
 * model call stubbed: the saved facts load from the first generated snapshot (post-Verify,
 * pre-Repair), the outline is re-written in code, and Generate is handed that outline with no
 * plan call made.
 */

const RUN = "np1-russian-revolution-live";
const present = existsSync(join(LAB_RESULTS, RUN, "result.json"));
const json = (v: unknown) => JSON.stringify(v);

describe.skipIf(!present)(`from facts: ${RUN}`, () => {
  test("loads the objectives and the facts the slides were written from", async () => {
    const saved = await loadRunFacts(RUN);
    expect(saved.run).toBe(RUN);
    expect(saved.briefId).toBe("y9-history-russian-revolution");
    expect(saved.factsFrom).toMatch(/^snapshots\/\d+-generated-/);
    expect(saved.objectives).toHaveLength(saved.lessonFacts.objectives.length);
    expect(saved.facts.keyIdeas).toHaveLength(saved.lessonFacts.keyIdeas?.length ?? 0);
    // Ordinal refs, not ids: the merged form the outline step reads.
    expect(saved.facts.questions[0]?.objectiveRefs[0]).toEqual({
      type: "objective",
      index: expect.any(Number),
    });
  });

  test("the dry run prints the new outline: every key idea on a content slide", async () => {
    const saved = await loadRunFacts(RUN);
    const lesson = JSON.parse(readFileSync(join(saved.dir, "lesson.json"), "utf8")) as Lesson;
    const lines = fromFactsDryRun(saved, lesson).join("\n");
    expect(lines).toContain("unplaced key ideas 0");
    expect(lines).toContain("content[k1+k2]");
  });

  test("reaches Generate with the new outline and no plan call; facts unchanged", async () => {
    const saved = await loadRunFacts(RUN);
    const original = JSON.parse(readFileSync(join(saved.dir, "lesson.json"), "utf8")) as Lesson;
    const { facts: _f, generation: _g, ...rest } = original;
    const lesson = { ...rest, slides: [] } as Lesson;
    const fallback: FakeScriptEntry = async (call) => {
      const version = call.context?.promptVersion ?? "";
      if (version.startsWith("generate-slide")) {
        const kind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1] ?? "content";
        return json(FIXTURES.slides[kind as keyof typeof FIXTURES.slides]);
      }
      if (version.startsWith("evaluate")) return json({ findings: [] });
      if (version.startsWith("repair")) return json(FIXTURES.repair);
      throw new Error(`unexpected call: ${version}`);
    };
    const ai = createFakeAi({ fallback, usage: { inputTokens: 1000, outputTokens: 400 } });
    const { state, report } = await runLabPipeline({ lesson }, recordingDeps(ai), {
      verify: false,
      fromFacts: {
        source: saved.run,
        objectives: saved.objectives,
        facts: saved.facts as never,
      },
    });
    const versions = ai.calls.map((c) => c.context?.promptVersion ?? "");
    expect(versions.some((v) => v.startsWith("plan-") || v.startsWith("verify"))).toBe(false);
    expect(versions.filter((v) => v.startsWith("generate-slide")).length).toBeGreaterThan(0);
    expect(report.fromFacts).toBe(RUN);
    expect(report.unplaced.keyIdeas).toEqual([]);
    const facts = state.lesson.facts;
    expect(facts?.keyIdeas?.map((k) => k.statement)).toEqual(
      saved.lessonFacts.keyIdeas?.map((k) => k.statement),
    );
    expect(facts?.questions.map((q) => q.stem)).toEqual(
      saved.lessonFacts.questions.map((q) => q.stem),
    );
    // The new outline, not the saved one: three content slides carry all six key ideas.
    const content = facts?.outline.filter((e) => e.kind === "content") ?? [];
    const kis = new Set(content.flatMap((e) => e.factRefs.filter((r) => r.startsWith("k"))));
    expect(kis.size).toBe(saved.facts.keyIdeas.length);
    expect(state.lesson.generation?.stage).toBe("repaired");
  });
});
