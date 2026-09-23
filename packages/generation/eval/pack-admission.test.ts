import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadExperiment } from "./experiments/np1";
import {
  admitPack,
  type CheckVerdict,
  failedTests,
  loadPackGatesV2,
  type PackCheckReport,
} from "./pack-arms";
import { FACT_TYPES, type Pack, PackSchema } from "./packs/schema";

/*
 * The pre-registered admission rule (np1.json `packAdmission`): a pack fact reaches the grounded
 * and packed arms only if both checkers said correct = yes and neither said supportedByEvidence =
 * no. Code reads the recorded verdicts; it judges nothing.
 */

const rule = loadExperiment().packAdmission;
const packOf = (topic: string): Pack =>
  PackSchema.parse(
    JSON.parse(readFileSync(join(import.meta.dir, "packs", `${topic}.luna-rewrite.json`), "utf8")),
  );
const count = (p: Pack) =>
  p.sections.reduce((n, s) => n + FACT_TYPES.reduce((m, t) => m + s.facts[t].length, 0), 0);
const pass = (fact: number): CheckVerdict => ({
  fact,
  supportedByEvidence: "yes",
  correct: "yes",
});
function allPass(p: Pack): PackCheckReport {
  return {
    sections: p.sections.map((s) => {
      const n = FACT_TYPES.reduce((m, t) => m + s.facts[t].length, 0);
      const vs = Array.from({ length: n }, (_, i) => pass(i));
      return { id: s.id, checks: { luna: vs, sol: vs.map((v) => ({ ...v })) } };
    }),
  };
}

describe("admitPack", () => {
  test("the rule is registered in np1.json", () => {
    expect(rule).toBeDefined();
    expect(rule?.checkers).toEqual(["luna", "sol"]);
  });

  test("keeps every fact when both checkers pass it; partly is not a rejection", () => {
    const p = packOf("romans");
    const r = allPass(p);
    const s0 = r.sections[0];
    if (!s0?.checks.luna?.[0]) throw new Error("fixture");
    s0.checks.luna[0].supportedByEvidence = "partly";
    const out = admitPack(p, r, rule!);
    expect(out.dropped).toEqual([]);
    expect(count(out.pack)).toBe(count(p));
  });

  test("drops on correct != yes from either checker, on supported = no, and on a missing verdict", () => {
    const p = packOf("romans");
    const r = allPass(p);
    const [a, b] = r.sections;
    if (!a || !b) throw new Error("fixture");
    a.checks.sol![0]!.correct = "unsure"; // keyIdeas[0]
    a.checks.luna![1]!.correct = "no"; // keyIdeas[1]
    a.checks.luna![2]!.supportedByEvidence = "no"; // keyIdeas[2] or next type
    b.checks.sol = b.checks.sol!.filter((v) => v.fact !== 0); // missing verdict
    const out = admitPack(p, r, rule!);
    expect(out.dropped.map((d) => `${d.section}:${d.fact}`)).toEqual([
      "sec1:0",
      "sec1:1",
      "sec1:2",
      "sec2:0",
    ]);
    expect(out.dropped[3]?.verdicts.sol).toBeNull();
    expect(count(out.pack)).toBe(count(p) - 4);
  });

  test("renumbers misconception refs and removes refs to a dropped misconception", () => {
    const p = packOf("romans");
    const sec = p.sections.find((s) =>
      s.facts.questions.some((q) => q.distractors?.some((d) => d.misconceptionRef)),
    );
    if (!sec || sec.facts.misconceptions.length === 0) throw new Error("fixture: no refs");
    const r = allPass(p);
    const first = sec.facts.keyIdeas.length; // flat position of misconceptions[0]
    const checks = r.sections.find((s) => s.id === sec.id)!.checks;
    checks.sol!.find((v) => v.fact === first)!.correct = "no";
    const out = admitPack(p, r, rule!);
    const after = out.pack.sections.find((s) => s.id === sec.id)!;
    expect(after.facts.misconceptions.length).toBe(sec.facts.misconceptions.length - 1);
    const refs = [
      ...after.facts.workedExamples.map((x) => x.misconceptionRef),
      ...after.facts.questions.flatMap((q) => (q.distractors ?? []).map((d) => d.misconceptionRef)),
    ].filter((x) => x !== undefined);
    const before = [
      ...sec.facts.workedExamples.map((x) => x.misconceptionRef),
      ...sec.facts.questions.flatMap((q) => (q.distractors ?? []).map((d) => d.misconceptionRef)),
    ].filter((x) => x !== undefined);
    expect(refs.length).toBe(before.filter((x) => x.index !== 0).length);
    for (const x of refs) expect(x.index).toBeLessThan(after.facts.misconceptions.length);
    expect(() => PackSchema.parse(out.pack)).not.toThrow();
  });

  // The verdicts live in the gitignored results dir: this pins the pre-registered count locally.
  const recorded = existsSync(join(import.meta.dir, "results", "packs", "romans.luna-rewrite"));
  test.skipIf(!recorded)(
    "on the recorded np1 luna-rewrite verdicts it drops the 7 Sol-flagged facts",
    () => {
      const dropped: Record<string, string[]> = {};
      for (const topic of [
        "romans",
        "ww1-causes",
        "cells",
        "russian-revolution",
        "externalities",
      ]) {
        const p = packOf(topic);
        const report = JSON.parse(
          readFileSync(join(import.meta.dir, "results", "packs", p.id, "report.json"), "utf8"),
        );
        const out = admitPack(p, report, rule!);
        dropped[topic] = out.dropped.map((d) => `${d.section}:${d.fact}`);
        for (const d of out.dropped) expect(d.verdicts.sol?.correct).not.toBe("yes");
      }
      expect(dropped).toEqual({
        romans: ["sec3:6", "sec3:11"],
        "ww1-causes": ["sec1:1", "sec1:9", "sec2:1", "sec2:8"],
        cells: [],
        "russian-revolution": [],
        externalities: ["sec1:5"],
      });
    },
  );

  describe("np2 gates (pack-gates.v2.json)", async () => {
    const gates = await loadPackGatesV2();
    const v2 = (fact: number): CheckVerdict => ({
      ...pass(fact),
      valuesStated: "none",
      pitched: "yes",
    });
    function allPassV2(p: Pack): PackCheckReport {
      const r = allPass(p);
      for (const s of r.sections)
        for (const k of ["luna", "sol"] as const) s.checks[k] = s.checks[k]!.map((v) => v2(v.fact));
      return r;
    }

    test("is registered apart from np1 and adds the two gates", () => {
      expect(gates.checkers).toEqual(["luna", "sol"]);
      expect(gates.gates).toEqual({ rejectPitched: "no", rejectValuesStated: "no" });
      expect(rule?.rule).not.toContain("pitched");
    });

    test("keeps v2 passes, including valuesStated yes or none", () => {
      const p = packOf("romans");
      const r = allPassV2(p);
      r.sections[0]!.checks.sol![0]!.valuesStated = "yes";
      expect(admitPack(p, r, gates).dropped).toEqual([]);
    });

    test("drops on pitched = no or valuesStated = no from either checker, and names the test", () => {
      const p = packOf("romans");
      const r = allPassV2(p);
      const a = r.sections[0]!;
      a.checks.luna![0]!.pitched = "no";
      a.checks.sol![1]!.valuesStated = "no";
      const out = admitPack(p, r, gates);
      expect(out.dropped.map((d) => [d.fact, d.failed])).toEqual([
        [0, ["luna:pitched"]],
        [1, ["sol:valuesStated"]],
      ]);
    });

    test("a v1 verdict (no pitched, no valuesStated) cannot pass the gates", () => {
      expect(failedTests(pass(0), gates)).toEqual(["pitched", "valuesStated"]);
      expect(failedTests(pass(0), rule!)).toEqual([]);
      expect(failedTests(null, gates)).toEqual(["missing"]);
    });
  });
});
