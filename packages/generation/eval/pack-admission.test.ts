import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadExperiment } from "./experiments/np1";
import {
  admitPack,
  type CheckVerdict,
  failedTests,
  loadPackGates,
  loadPackGatesV2,
  type PackCheckReport,
} from "./pack-arms";
import { FACT_TYPES, type Pack, PackSchema } from "./packs/schema";

/*
 * The pre-registered admission rule (np1.json `packAdmission`): a pack fact reaches the grounded
 * and packed arms only if both checkers said correct = yes and neither said supportedByEvidence =
 * no. Code reads the recorded verdicts; it judges nothing.
 */

/** The value, or a thrown error naming what the fixture lacks (no non-null assertions). */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`fixture: ${what}`);
  return value;
}

const rule = must(loadExperiment().packAdmission, "np1 packAdmission");
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
    const out = admitPack(p, r, rule);
    expect(out.dropped).toEqual([]);
    expect(count(out.pack)).toBe(count(p));
  });

  test("drops on correct != yes from either checker, on supported = no, and on a missing verdict", () => {
    const p = packOf("romans");
    const r = allPass(p);
    const [a, b] = r.sections;
    if (!a || !b) throw new Error("fixture");
    const aSol = must(a.checks.sol, "sec1 sol");
    const aLuna = must(a.checks.luna, "sec1 luna");
    must(aSol[0], "sol 0").correct = "unsure"; // keyIdeas[0]
    must(aLuna[1], "luna 1").correct = "no"; // keyIdeas[1]
    must(aLuna[2], "luna 2").supportedByEvidence = "no"; // keyIdeas[2] or next type
    b.checks.sol = must(b.checks.sol, "sec2 sol").filter((v) => v.fact !== 0); // missing verdict
    const out = admitPack(p, r, rule);
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
    const checks = must(
      r.sections.find((s) => s.id === sec.id),
      "section in report",
    ).checks;
    must(
      must(checks.sol, "sol").find((v) => v.fact === first),
      "sol verdict",
    ).correct = "no";
    const out = admitPack(p, r, rule);
    const after = must(
      out.pack.sections.find((s) => s.id === sec.id),
      "section kept",
    );
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
        const out = admitPack(p, report, rule);
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
        for (const k of ["luna", "sol"] as const)
          s.checks[k] = must(s.checks[k], k).map((v) => v2(v.fact));
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
      must(must(r.sections[0]?.checks.sol, "sol")[0], "sol 0").valuesStated = "yes";
      expect(admitPack(p, r, gates).dropped).toEqual([]);
    });

    test("drops on pitched = no or valuesStated = no from either checker, and names the test", () => {
      const p = packOf("romans");
      const r = allPassV2(p);
      const a = must(r.sections[0], "sec1");
      must(must(a.checks.luna, "luna")[0], "luna 0").pitched = "no";
      must(must(a.checks.sol, "sol")[1], "sol 1").valuesStated = "no";
      const out = admitPack(p, r, gates);
      expect(out.dropped.map((d) => [d.fact, d.failed])).toEqual([
        [0, ["luna:pitched"]],
        [1, ["sol:valuesStated"]],
      ]);
    });

    test("a v1 verdict (no pitched, no valuesStated) cannot pass the gates", () => {
      expect(failedTests(pass(0), gates)).toEqual(["pitched", "valuesStated"]);
      expect(failedTests(pass(0), rule)).toEqual([]);
      expect(failedTests(null, gates)).toEqual(["missing"]);
    });
  });

  describe("np2 gates v3, pitched only (pack-gates.v3.json)", async () => {
    const v3 = await loadPackGates("v3");

    test("is registered with the pitched gate and no valuesStated gate", () => {
      expect(v3.checkers).toEqual(["luna", "sol"]);
      expect(v3.gates).toEqual({ rejectPitched: "no" });
      expect(v3.rule).toContain("valuesStated is not read");
    });

    test("valuesStated no, or missing, no longer fails; pitched no or missing still does", () => {
      const v = { ...pass(0), pitched: "yes", valuesStated: "no" };
      expect(failedTests(v, v3)).toEqual([]);
      expect(failedTests({ ...pass(0), pitched: "yes" }, v3)).toEqual([]);
      expect(failedTests({ ...v, pitched: "no" }, v3)).toEqual(["pitched"]);
      expect(failedTests(pass(0), v3)).toEqual(["pitched"]);
    });

    // The Sol-only v2 recheck reports live in the gitignored results dir.
    const rechecked = existsSync(
      join(import.meta.dir, "results", "packs", "cells.luna-rewrite", "report.pack-check.v2.json"),
    );
    test.skipIf(!rechecked)(
      "on the recorded Sol v2 rechecks it drops the 3 centrosome and 2 turgor facts, no RR dates",
      () => {
        const solOnly = { ...v3, checkers: ["sol"] };
        const dropped: Record<string, string[]> = {};
        for (const id of [
          "cells.luna-rewrite",
          "cells.sol-rewrite",
          "russian-revolution.luna-rewrite",
          "russian-revolution.sol-rewrite",
        ]) {
          const p = PackSchema.parse(
            JSON.parse(readFileSync(join(import.meta.dir, "packs", `${id}.json`), "utf8")),
          );
          const report: PackCheckReport = JSON.parse(
            readFileSync(
              join(import.meta.dir, "results", "packs", id, "report.pack-check.v2.json"),
              "utf8",
            ),
          );
          const checked = new Set(
            report.sections.filter((s) => (s.checks.sol ?? []).length > 0).map((s) => s.id),
          );
          const sub = { ...p, sections: p.sections.filter((s) => checked.has(s.id)) };
          dropped[id] = admitPack(sub, report, solOnly).dropped.map(
            (d) => `${d.section}:${d.fact}:${d.failed.join("+")}`,
          );
        }
        expect(dropped).toEqual({
          "cells.luna-rewrite": ["sec1:2:sol:pitched", "sec1:3:sol:pitched", "sec1:10:sol:pitched"],
          "cells.sol-rewrite": ["sec2:2:sol:pitched", "sec2:7:sol:pitched"],
          "russian-revolution.luna-rewrite": [],
          "russian-revolution.sol-rewrite": [],
        });
      },
    );
  });
});
