import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { recordingDeps } from "../src/testing";
import { loadExperiment } from "./experiments/np1";
import { type AuthorDeps, attachLinks, authorPack, flatten, windowFor } from "./pack-author";
import { assertNoStubs, packKnowledgePrompt, packRewritePrompt } from "./packs/prompts";
import { checkPack, PackSchema, type PackSource } from "./packs/schema";

/*
 * The authoring script with every model call faked (no network): one rewrite arm and the
 * knowledge + link arm, the overlap measure over the answers, both checkers recorded apart, and
 * the stub guard that keeps a placeholder prompt from ever running live.
 */

const url = "https://en.wikipedia.org/wiki/Roman_Britain";
const SOURCE: PackSource = {
  id: "s1",
  url,
  title: "Roman Britain",
  revision: "1",
  fetchedAt: "2026-09-23T12:00:00.000Z",
  licence: "CC-BY-SA-4.0",
  sentences: [
    {
      id: "s1.1",
      heading: "Roman Britain",
      text: "The Romans invaded Britain in AD 43 under the emperor Claudius, who wanted a famous victory.",
    },
    {
      id: "s1.2",
      heading: "Roman Britain",
      text: "Britain had metals, grain and cattle that Rome wanted to tax and trade.",
    },
    { id: "s1.3", heading: "Roman Britain > Other", text: "Boudica led a revolt in AD 60." },
  ],
};

const written = {
  keyIdeas: [
    {
      statement: "Rome wanted Britain's resources.",
      explanation: "Britain had metals, grain and cattle that Rome wanted to tax and trade.",
      example: "Claudius ordered the invasion in AD 43.",
      evidence: [{ sentenceIds: ["s1.2"], snippet: "metals, grain and cattle" }],
    },
  ],
  misconceptions: [
    {
      belief: "The Romans came only to fight.",
      correction: "They came for wealth and glory too.",
      evidence: [{ sentenceIds: ["s1.1"], snippet: "wanted a famous victory" }],
    },
  ],
  vocabulary: [
    {
      term: "emperor",
      sense: "ruler of Rome",
      band: "Y3-4",
      definition: "The ruler of all Rome's lands.",
      evidence: [{ sentenceIds: ["s1.1"], snippet: "the emperor Claudius" }],
    },
  ],
  workedExamples: [],
  questions: [1, 2, 3].map((n) => ({
    stem: `Question ${n}: when did the Romans invade Britain?`,
    answer: "AD 43",
    reasoning: "Claudius invaded in AD 43.",
    tier: "easy",
    use: "any",
    demand: "recall",
    forms: ["open-response"],
    evidence: [{ sentenceIds: ["s1.1"], snippet: "invaded Britain in AD 43" }],
  })),
};

const verdicts = (correct: "yes" | "no") =>
  JSON.stringify({
    verdicts: Array.from({ length: 6 }, (_, fact) => ({
      fact,
      supportedByEvidence: "yes",
      valuesStated: "none",
      correct,
      pitched: "yes",
      note: "",
    })),
  });

function topic() {
  const exp = loadExperiment();
  return {
    exp,
    topic: {
      id: "romans",
      brief: "y4-history-romans",
      subject: "History",
      yearGroup: "Year 4",
      sources: [
        { kind: "wikipedia" as const, ref: "Roman_Britain", licence: "CC-BY-SA-4.0" as const },
      ],
      sections: [
        { outcome: "Explain why the Romans invaded Britain", headings: ["Roman Britain"] },
      ],
    },
  };
}

function deps(
  writerScript: string[],
  linkerScript: string[] = [],
): AuthorDeps & { luna: ReturnType<typeof createFakeAi>; sol: ReturnType<typeof createFakeAi> } {
  const writer = createFakeAi({
    script: writerScript,
    modelIds: { standard: "openai/gpt-5.6-luna" },
  });
  const linker = createFakeAi({
    script: linkerScript,
    modelIds: { standard: "openai/gpt-5.6-luna" },
  });
  const luna = createFakeAi({
    fallback: verdicts("yes"),
    modelIds: { standard: "openai/gpt-5.6-luna" },
  });
  const sol = createFakeAi({
    fallback: verdicts("no"),
    modelIds: { standard: "openai/gpt-6-sol" },
  });
  return {
    writer: recordingDeps(writer),
    linker: recordingDeps(linker),
    checkerLuna: recordingDeps(luna),
    checkerSol: recordingDeps(sol),
    luna,
    sol,
  };
}

describe("pack-author", () => {
  test("windowFor takes the sentences under the section's headings, in order, capped", () => {
    expect(windowFor([SOURCE], ["Roman Britain"], 80).map((s) => s.id)).toEqual(["s1.1", "s1.2"]);
    expect(windowFor([SOURCE], ["Roman Britain"], 1).map((s) => s.id)).toEqual(["s1.1"]);
    expect(windowFor([SOURCE], ["Nowhere"], 80)).toEqual([]);
  });

  test("luna-rewrite: the pack parses, overlap is measured, both checkers are recorded apart", async () => {
    const { exp, topic: t } = topic();
    const d = deps([JSON.stringify(written)]);
    const { pack, report } = await authorPack(exp, t, "luna-rewrite", d, {
      loadSources: async () => [SOURCE],
      now: () => new Date("2026-09-23T12:00:00Z"),
    });
    expect(PackSchema.safeParse(pack).success).toBe(true);
    expect(checkPack(pack)).toEqual([]);
    expect(report.status).toEqual({ executed: true, complete: true, incomplete: [] });
    expect(report.facts).toBe(6);
    // The key idea's explanation copies eleven words of s1.2: flagged. The others do not.
    const flagged = report.sections[0]?.overlap.filter((o) => o.overlap.flagged) ?? [];
    expect(flagged.map((o) => `${o.type}[${o.index}]`)).toEqual(["keyIdeas[0]"]);
    expect(flagged[0]?.overlap.sentenceId).toBe("s1.2");
    // Two checkers, two verdict lists, never merged: luna said yes to every fact, sol said no.
    const checks = report.sections[0]?.checks;
    expect(checks?.luna?.every((v) => v.correct === "yes")).toBe(true);
    expect(checks?.sol?.every((v) => v.correct === "no")).toBe(true);
    expect(d.luna.calls.length).toBe(1);
    expect(d.sol.calls.length).toBe(1);
    expect(pack.provenance).toEqual({
      writer: "openai/gpt-5.6-luna",
      writerPrompt: packRewritePrompt.version,
    });
    expect(pack.sections[0]?.sentenceIds).toEqual(["s1.1", "s1.2"]);
  });

  test("sol-knowledge: facts the link call cannot support are left out and reported", async () => {
    const { exp, topic: t } = topic();
    const known = {
      ...written,
      keyIdeas: written.keyIdeas.map(({ evidence: _e, ...k }) => k),
      misconceptions: written.misconceptions.map(({ evidence: _e, ...m }) => m),
      vocabulary: written.vocabulary.map(({ evidence: _e, ...v }) => v),
      questions: written.questions.map(({ evidence: _e, ...q }) => q),
    };
    const flat = flatten(known as never);
    const links = {
      links: flat.map((_, fact) =>
        fact === 1
          ? { fact, supported: "no", evidence: [] }
          : {
              fact,
              supported: "yes",
              evidence: [{ sentenceIds: ["s1.1"], snippet: "invaded Britain in AD 43" }],
            },
      ),
    };
    const d = deps([JSON.stringify(known)], [JSON.stringify(links)]);
    const { pack, report } = await authorPack(exp, t, "sol-knowledge", d, {
      loadSources: async () => [SOURCE],
      check: false,
    });
    expect(report.sections[0]?.unlinked).toEqual([
      {
        type: "misconceptions",
        text: "The Romans came only to fight. They came for wealth and glory too.",
        supported: "no",
      },
    ]);
    expect(pack.sections[0]?.facts.misconceptions).toEqual([]);
    expect(pack.sections[0]?.facts.keyIdeas.length).toBe(1);
    expect(report.facts).toBe(5);
    expect(report.sections[0]?.checks).toEqual({ luna: null, sol: null });
    expect(pack.provenance.linker).toBe("openai/gpt-5.6-luna");
  });

  test("attachLinks remaps misconception ordinals to the kept list", () => {
    const facts = {
      keyIdeas: [],
      misconceptions: [
        { belief: "a", correction: "b" },
        { belief: "c", correction: "d" },
      ],
      vocabulary: [],
      workedExamples: [],
      questions: [
        {
          stem: "q",
          answer: "a",
          reasoning: "r",
          tier: "easy" as const,
          use: "any" as const,
          demand: "recall" as const,
          forms: ["open-response" as const],
          distractors: [
            { text: "x", misconceptionRef: { type: "misconception" as const, index: 1 } },
          ],
        },
      ],
    };
    const ev = [{ sentenceIds: ["s1.1"], snippet: "AD 43" }];
    const { facts: out, unlinked } = attachLinks(
      facts,
      [
        { fact: 0, supported: "no", evidence: [] },
        { fact: 1, supported: "yes", evidence: ev },
        { fact: 2, supported: "yes", evidence: ev },
      ],
      [SOURCE],
    );
    expect(unlinked.length).toBe(1);
    expect(out.misconceptions.length).toBe(1);
    expect(out.questions[0]?.distractors?.[0]?.misconceptionRef).toEqual({
      type: "misconception",
      index: 0,
    });
  });

  test("a failed writing call leaves the section out and the report incomplete", async () => {
    const { exp, topic: t } = topic();
    const d = deps(["not json at all", "still not json"]);
    const { pack, report } = await authorPack(exp, t, "luna-rewrite", d, {
      loadSources: async () => [SOURCE],
    });
    expect(pack.sections).toEqual([]);
    expect(report.status.complete).toBe(false);
    expect(report.status.incomplete[0]).toMatch(/^sec1: writing failed/);
  });

  test("a stub prompt is refused live", () => {
    // pack-rewrite is written (v1); pack-knowledge is the arm-3 stub np1's reduced scope leaves.
    expect(() => assertNoStubs([packKnowledgePrompt])).toThrow(/prompt stubs not yet written/);
    expect(() => assertNoStubs([packRewritePrompt])).not.toThrow();
  });
});
