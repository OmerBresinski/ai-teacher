import { describe, expect, test } from "bun:test";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { blind, errorClass, stripItem } from "./blind";
import {
  longestOverlap,
  longestSharedRun,
  missingNamesGap,
  scoreRewrite,
  scoreSelect,
  seededShuffle,
  selectVerdict,
  sentencesById,
  words,
} from "./metrics";
import { placeholdersIn, renderPrompt, renderTemplate } from "./render";
import {
  type JudgePacket,
  judge,
  judgeDryRun,
  judgeItems,
  judgePackets,
  summariseJudge,
} from "./rubric-judge";
import type { ItemResult, RunFile } from "./run";
import { dryRun } from "./run";
import {
  DEFAULT_JUDGE_MODEL,
  judgeOutputSchema,
  PLACEHOLDERS,
  PromptFileSchema,
  type RewriteOutput,
  RewriteOutputSchema,
  SelectOutputSchema,
  SUPPORT_EFFORT,
  SUPPORT_MODEL,
  sentenceIdsOf,
} from "./schemas";
import {
  checkSupport,
  factView,
  type SupportPacket,
  summariseSupport,
  supportDryRun,
  supportPackets,
} from "./support-checker";

describe("render", () => {
  const values = { subject: "History", band: "Year 4", objective: "Explain X", cards: "[c1] …" };

  test("replaces each placeholder once and reports what was used", () => {
    const r = renderTemplate(
      "Subject: {{subject}}; {{ band }}\n{{cards}}",
      values,
      PLACEHOLDERS.select,
    );
    expect(r.text).toBe("Subject: History; Year 4\n[c1] …");
    expect(r.used).toEqual(["subject", "band", "cards"]);
  });

  test("a placeholder left out is simply not shown", () => {
    const r = renderTemplate("Only {{objective}}", values, PLACEHOLDERS.select);
    expect(r.text).toBe("Only Explain X");
    expect(r.used).toEqual(["objective"]);
  });

  test("an unknown placeholder is an error, so is a repeat", () => {
    expect(() => renderTemplate("{{sentences}}", values, PLACEHOLDERS.select)).toThrow(
      "unknown placeholder",
    );
    expect(() => renderTemplate("{{band}} {{band}}", values, PLACEHOLDERS.select)).toThrow(
      "used 2 times",
    );
  });

  test("a repeat across system and user is an error too", () => {
    expect(() =>
      renderPrompt({ system: "{{band}}", user: "{{band}}" }, values, PLACEHOLDERS.select),
    ).toThrow("both system and user");
    const ok = renderPrompt(
      { system: "S {{band}}", user: "U {{objective}}" },
      values,
      PLACEHOLDERS.select,
    );
    expect(ok.system).toBe("S Year 4");
    expect(ok.user).toBe("U Explain X");
  });

  test("placeholdersIn lists names in order", () => {
    expect(placeholdersIn("a {{x}} b {{ y }} {{x}}")).toEqual(["x", "y", "x"]);
  });

  test("dry run prices every item from the rendered length", () => {
    const rows = dryRun("select", { system: "s", user: "{{cards}}" }, [
      { id: "i1", values: { ...values, cards: "x".repeat(4000) } },
    ]);
    expect(rows[0]?.inputTokens).toBe(1000 + 1 + 200);
    expect(rows[0]?.usd).toBeGreaterThan(0);
  });
});

describe("schemas", () => {
  const select = { cardId: "c2", covers: "partial", missing: ["the Bosnian crisis"] };

  test("select: cardId null exactly when none; missing empty unless partial", () => {
    expect(SelectOutputSchema.safeParse(select).success).toBe(true);
    expect(
      SelectOutputSchema.safeParse({ cardId: null, covers: "none", missing: [] }).success,
    ).toBe(true);
    expect(
      SelectOutputSchema.safeParse({ cardId: null, covers: "full", missing: [] }).success,
    ).toBe(false);
    expect(
      SelectOutputSchema.safeParse({ cardId: "c1", covers: "none", missing: [] }).success,
    ).toBe(false);
    expect(
      SelectOutputSchema.safeParse({ cardId: "c1", covers: "full", missing: ["x"] }).success,
    ).toBe(false);
    expect(
      SelectOutputSchema.safeParse({ cardId: "c4", covers: "full", missing: [] }).success,
    ).toBe(false);
    expect(
      SelectOutputSchema.safeParse({ cardId: "c1", covers: "partial", missing: ["x".repeat(81)] })
        .success,
    ).toBe(false);
  });

  const fact = (evidence = ["s1"]) => ({ statement: "A", evidence });
  const rewrite = {
    keyIdeas: [fact(), fact(["s2", "s3"])],
    misconceptions: [],
    vocabulary: [
      { term: "t", definition: "d", evidence: ["s1"] },
      { term: "u", definition: "d", evidence: ["s1"] },
    ],
    workedExamples: [],
    questions: [
      {
        stem: "q",
        answer: "a",
        distractors: [],
        demand: "recall",
        forms: ["open-response"],
        evidence: ["s1"],
      },
      {
        stem: "q",
        answer: "a",
        distractors: ["x", "y", "z"],
        demand: "apply",
        forms: ["multiple-choice"],
        evidence: ["s1"],
      },
      {
        stem: "q",
        answer: "a",
        distractors: [],
        demand: "judgement",
        forms: ["true-false", "open-response"],
        evidence: ["s1"],
      },
    ],
  };

  test("rewrite: array bounds, distractors 0 or 3, evidence ids shaped, strings ≤ 300", () => {
    expect(RewriteOutputSchema.safeParse(rewrite).success).toBe(true);
    expect(RewriteOutputSchema.safeParse({ ...rewrite, keyIdeas: [fact()] }).success).toBe(false);
    expect(RewriteOutputSchema.safeParse({ ...rewrite, keyIdeas: [fact(["12"])] }).success).toBe(
      false,
    );
    expect(
      RewriteOutputSchema.safeParse({ ...rewrite, keyIdeas: [fact([]), fact()] }).success,
    ).toBe(false);
    const twoDistractors = { ...rewrite.questions[1], distractors: ["x", "y"] };
    expect(
      RewriteOutputSchema.safeParse({
        ...rewrite,
        questions: [rewrite.questions[0], twoDistractors, rewrite.questions[2]],
      }).success,
    ).toBe(false);
    expect(
      RewriteOutputSchema.safeParse({
        ...rewrite,
        keyIdeas: [{ statement: "x".repeat(301), evidence: ["s1"] }, fact()],
      }).success,
    ).toBe(false);
  });

  test("prompt file needs both texts", () => {
    expect(PromptFileSchema.safeParse({ system: "s", user: "u" }).success).toBe(true);
    expect(PromptFileSchema.safeParse({ system: "s" }).success).toBe(false);
  });

  test("sentenceIdsOf reads the ids at line starts", () => {
    expect([...sentenceIdsOf("[s1] (w: T § lead) a.\n[s2] (w: T § X) b.\nnot [s3]")]).toEqual([
      "s1",
      "s2",
    ]);
  });
});

describe("overlap metric", () => {
  test("words normalises case and punctuation", () => {
    expect(words("The id's role, in Freud’s model.")).toEqual([
      "the",
      "ids",
      "role",
      "in",
      "freuds",
      "model",
    ]);
  });

  test("longest shared run is contiguous", () => {
    expect(longestSharedRun(words("a b c d e"), words("x b c d y"))).toBe(3);
    expect(longestSharedRun(words("a b c"), words("c b a"))).toBe(1);
    expect(longestSharedRun([], words("a"))).toBe(0);
  });

  test("overlap is the max over all sentences and flags at 8", () => {
    const block =
      "[s1] (wikipedia: V § lead) A volcano is a vent or fissure in the crust of a planetary-mass object that allows hot lava to escape.\n[s2] (wikipedia: V § lead) Short one here.";
    const copied = "A volcano is a vent or fissure in the crust of the Earth.";
    expect(longestOverlap(copied, [...sentencesById(block).values()])).toBe(11);
    const own = "Volcanoes are openings where molten rock reaches the surface.";
    expect(longestOverlap(own, [...sentencesById(block).values()])).toBeLessThan(8);
    const output = {
      keyIdeas: [
        { statement: copied, evidence: ["s1"] },
        { statement: own, evidence: ["s9"] },
      ],
      misconceptions: [],
      vocabulary: [
        { term: "vent", definition: "an opening", evidence: ["s1"] },
        { term: "lava", definition: "molten rock at the surface", evidence: ["s2"] },
      ],
      workedExamples: [],
      questions: [],
    };
    const score = scoreRewrite(output as never, block);
    expect(score).toEqual({ facts: 4, flaggedOverlap: 1, maxOverlap: 11, invalidEvidenceFacts: 1 });
  });

  test("support packets carry one fact and only its cited sentences", () => {
    const block = "[s1] (w: T § a) First sentence here.\n[s2] (w: T § a) Second sentence here.";
    const output = {
      keyIdeas: [
        { statement: "one", evidence: ["s2"] },
        { statement: "two", evidence: ["s3"] },
      ],
      misconceptions: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
    };
    const { packets, invalid } = supportPackets("it", output as never, block);
    expect(packets).toEqual([
      {
        factRef: "it/keyIdea/0",
        fact: "Key idea: one",
        cited: [{ id: "s2", text: "Second sentence here." }],
      },
    ]);
    expect(invalid.map((r) => r.invalidEvidence)).toEqual([["s3"]]);
  });
});

describe("select scoring", () => {
  const L = {
    a: { cardId: "c2" as const, covers: "full" as const, missing: [] },
    b: { cardId: null, covers: "none" as const, missing: [] },
    c: {
      cardId: "c1" as const,
      covers: "partial" as const,
      missing: ["Combining audio"],
      zOutcome: "I can export a completed podcast",
    },
  };

  test("verdict classes", () => {
    expect(selectVerdict({ cardId: "c2", covers: "full", missing: [] }, L.a)).toBe("correct");
    expect(selectVerdict({ cardId: "c1", covers: "full", missing: [] }, L.a)).toBe("wrong-card");
    expect(selectVerdict({ cardId: "c2", covers: "partial", missing: ["x"] }, L.a)).toBe(
      "partial-should-be-full",
    );
    expect(selectVerdict({ cardId: null, covers: "none", missing: [] }, L.a)).toBe("missed");
    expect(selectVerdict({ cardId: "c1", covers: "full", missing: [] }, L.b)).toBe(
      "full-should-be-none",
    );
    expect(selectVerdict({ cardId: "c1", covers: "partial", missing: ["x"] }, L.b)).toBe(
      "partial-should-be-none",
    );
    expect(selectVerdict({ cardId: "c1", covers: "full", missing: [] }, L.c)).toBe(
      "full-should-be-partial",
    );
  });

  test("missing names the gap by shared content words", () => {
    expect(missingNamesGap(["export a podcast"], L.c)).toBe(true);
    expect(missingNamesGap(["exporting a podcast"], L.c)).toBe(false);
    expect(missingNamesGap(["audio combining"], L.c)).toBe(true);
    expect(missingNamesGap(["feedback"], L.c)).toBe(false);
  });

  test("precision counts predicted matches, recall labelled ones; failures count as unanswered", () => {
    const rows = [
      {
        id: "a",
        ok: true,
        output: { cardId: "c2", covers: "full", missing: [] },
        schemaFailures: 0,
      },
      {
        id: "b",
        ok: true,
        output: { cardId: "c1", covers: "full", missing: [] },
        schemaFailures: 1,
      },
      { id: "c", ok: false, schemaFailures: 2 },
    ];
    const s = scoreSelect(rows, L);
    expect(s.answered).toBe(2);
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(0.5);
    expect(s.verdicts["full-should-be-none"]).toBe(1);
    expect(s.schemaFailures).toBe(3);
    expect(() => scoreSelect([{ id: "zz", ok: true, output: {}, schemaFailures: 0 }], L)).toThrow(
      "no label",
    );
  });
});

describe("blind", () => {
  const run = (dir: string, promptFile: string, sha: string): { dir: string; file: RunFile } => ({
    dir,
    file: {
      task: "select",
      set: "test",
      model: "m",
      effort: "medium",
      promptFile,
      promptSha256: sha,
      placeholdersUsed: ["cards"],
      startedAt: "2026-09-23T00:00:00Z",
      items: [
        {
          id: "sel-02",
          ok: true,
          output: { cardId: null, covers: "none", missing: [] },
          attempts: 1,
          schemaFailures: 0,
          latencyMs: 5,
          costUsd: 0.001,
          inputTokens: 10,
          outputTokens: 2,
        },
        {
          id: "sel-01",
          ok: false,
          attempts: 2,
          schemaFailures: 2,
          latencyMs: 9,
          error: `plan: the model did not produce a valid bakeoff-select.v1 answer (${dir})`,
        },
      ],
      totals: { items: 2, ok: 1, schemaFailures: 2, costUsd: 0.001, meanLatencyMs: 7 },
      ledger: {},
    },
  });

  test("labels are a seeded shuffle and the key maps them back", () => {
    const runs = [
      run("/runs/alice", "/p/alice-select.json", "aaa111"),
      run("/runs/bob", "/p/bob-select.json", "bbb222"),
      run("/runs/carol", "/p/carol-select.json", "ccc333"),
    ];
    const one = blind(runs, 7);
    const again = blind(runs, 7);
    expect(one.key.assignments).toEqual(again.key.assignments);
    expect(one.key.assignments.map((a) => a.label)).toEqual(["A", "B", "C"]);
    expect(new Set(one.key.assignments.map((a) => a.runDir))).toEqual(
      new Set(["/runs/alice", "/runs/bob", "/runs/carol"]),
    );
    const other = blind(runs, 8);
    const differs = [7, 8, 9, 10, 11, 12].some(
      (s) => blind(runs, s).key.assignments[0]?.runDir !== one.key.assignments[0]?.runDir,
    );
    expect(differs || other).toBeTruthy();
  });

  test("the anonymised sets carry no identity, and items are sorted by id", () => {
    const runs = [
      run("/runs/alice", "/p/alice-select.json", "aaa111"),
      run("/runs/bob", "/p/bob-select.json", "bbb222"),
    ];
    const { sets } = blind(runs, 1);
    const text = JSON.stringify(sets);
    for (const s of [
      "alice",
      "bob",
      "aaa111",
      "bbb222",
      "/p/",
      "/runs/",
      "promptFile",
      "promptSha256",
      "startedAt",
      "bakeoff-select.v1",
    ])
      expect(text).not.toContain(s);
    expect(sets[0]?.items.map((i) => i.id)).toEqual(["sel-01", "sel-02"]);
    expect(Object.keys(stripItem(runs[0]?.file.items[0] as ItemResult))).toEqual([
      "id",
      "ok",
      "attempts",
      "schemaFailures",
      "latencyMs",
      "output",
      "inputTokens",
      "outputTokens",
      "costUsd",
    ]);
  });

  test("an error message is reduced to its class, never copied", () => {
    const runs = [
      run("/runs/alice", "/p/alice-select.json", "aaa111"),
      run("/runs/bob", "/p/bob-select.json", "bbb222"),
    ];
    const { sets } = blind(runs, 1);
    expect(
      sets
        .flatMap((s) => s.items)
        .filter((i) => !i.ok)
        .map((i) => i.error),
    ).toEqual(["schema", "schema"]);
    expect(errorClass("plan: model call timeout after 240000 ms")).toBe("timeout");
    expect(errorClass("lesson budget exceeded (usd cap)")).toBe("budget");
    expect(errorClass("socket hang up")).toBe("other");
  });

  test("an identity that survives in an output is refused rather than leaked", () => {
    const leaky = run("/runs/alice", "/p/alice-select.json", "aaa111");
    (leaky.file.items[0] as ItemResult).output = { note: "see /runs/alice" };
    expect(() => blind([leaky, run("/runs/bob", "/p/bob-select.json", "bbb222")], 1)).toThrow(
      "still contains",
    );
  });

  test("mixed tasks are refused", () => {
    const a = run("/runs/a", "/p/a", "1");
    const b = run("/runs/b", "/p/b", "2");
    b.file.task = "rewrite";
    expect(() => blind([a, b], 1)).toThrow("expected select/test");
  });

  test("seededShuffle is a permutation and stable", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    expect([...seededShuffle(xs, 3)].sort()).toEqual(xs);
    expect(seededShuffle(xs, 3)).toEqual(seededShuffle(xs, 3));
  });
});

describe("model-based scorers (stubbed model)", () => {
  const block =
    "[s1] (w: T § a) Shield volcanoes have gentle eruptions.\n[s2] (w: T § a) Stratovolcanoes are steep.\n[s3] (w: T § a) Unrelated sentence.";
  const output: RewriteOutput = {
    keyIdeas: [
      { statement: "Shield volcanoes erupt gently.", example: "Hawaii.", evidence: ["s1"] },
    ],
    misconceptions: [
      {
        wrong: "All volcanoes explode.",
        right: "Shield volcanoes erupt gently.",
        evidence: ["s1"],
      },
    ],
    vocabulary: [
      { term: "shield volcano", definition: "A broad volcano.", evidence: ["s1"] },
      { term: "stratovolcano", definition: "A steep volcano.", evidence: ["s2"] },
    ],
    workedExamples: [{ problem: "P", steps: ["one", "two"], answer: "A", evidence: ["s2"] }],
    questions: [
      {
        stem: "Which erupts gently?",
        answer: "Shield volcanoes",
        distractors: ["Stratovolcanoes", "Cinder cones", "Calderas"],
        demand: "recall",
        forms: ["multiple-choice"],
        evidence: ["s1"],
      },
      {
        stem: "Q2",
        answer: "A2",
        distractors: [],
        demand: "apply",
        forms: ["open-response"],
        evidence: ["s2"],
      },
      {
        stem: "Q3",
        answer: "A3",
        distractors: [],
        demand: "recall",
        forms: ["true-false"],
        evidence: ["s1", "s2"],
      },
    ],
  };
  const usage = { inputTokens: 500, outputTokens: 120 };

  test("factView labels the parts that are false by design", () => {
    expect(factView(output, "keyIdea", 0)).toBe(
      "Key idea: Shield volcanoes erupt gently.\nExample: Hawaii.",
    );
    expect(factView(output, "misconception", 0)).toBe(
      "Misconception (false by design, not a claim): All volcanoes explode.\nCorrection: Shield volcanoes erupt gently.",
    );
    expect(factView(output, "workedExample", 0)).toBe(
      "Problem: P\nSteps:\n1. one\n2. two\nAnswer: A",
    );
    expect(factView(output, "question", 0)).toBe(
      "Question: Which erupts gently?\nCorrect answer: Shield volcanoes\nWrong options (false by design, not claims): Stratovolcanoes; Cinder cones; Calderas",
    );
    expect(factView(output, "question", 1)).toBe("Question: Q2\nCorrect answer: A2");
    expect(() => factView(output, "vocabulary", 9)).toThrow("no vocabulary at index 9");
  });

  test("checkSupport sends one fact with only its cited sentences and maps the verdict", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ reason: "gentle eruptions are not stated", verdict: "partly" })],
      usage,
      modelIds: { standard: SUPPORT_MODEL },
    });
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const { packets } = supportPackets("it", output, block);
    const p = packets.find((x) => x.factRef === "it/question/0") as SupportPacket;
    const r = await checkSupport(p, { ai, budget });
    expect(r).toMatchObject({
      factRef: "it/question/0",
      verdict: "partly",
      note: "gentle eruptions are not stated",
    });
    expect(r.costUsd).toBeGreaterThan(0);
    const call = ai.calls[0];
    expect(call?.modelId).toBe(SUPPORT_MODEL);
    expect(call?.promptText).toContain("[s1] Shield volcanoes have gentle eruptions.");
    expect(call?.promptText).not.toContain("Stratovolcanoes are steep");
    expect(call?.promptText).not.toContain("Unrelated");
    expect(call?.promptText).toContain("Wrong options (false by design, not claims)");
    expect(call?.providerOptions).toMatchObject({ openai: { reasoningEffort: SUPPORT_EFFORT } });
  });

  test("checkSupport retries a schema miss once with the issues, then answers", async () => {
    const ai = createFakeAi({
      script: [
        JSON.stringify({ reason: "x", verdict: "maybe" }),
        JSON.stringify({ reason: "all stated", verdict: "supported" }),
      ],
      usage,
    });
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const { packets } = supportPackets("it", output, block);
    const r = await checkSupport(packets[0] as SupportPacket, { ai, budget });
    expect(r.verdict).toBe("supported");
    expect(ai.calls.length).toBe(2);
  });

  test("summariseSupport counts invalid-evidence facts as unsupported", () => {
    const s = summariseSupport(
      "A",
      [
        { factRef: "a", verdict: "supported", note: "", costUsd: 0.001 },
        { factRef: "b", verdict: "partly", note: "n", costUsd: 0.001 },
      ],
      2,
    );
    expect(s.facts).toBe(4);
    expect(s.verdicts).toEqual({ supported: 1, partly: 1, unsupported: 2, contradicted: 0 });
    expect(s.supportRate).toBe(0.375);
  });

  test("judge schema: refs are an enum and each appears exactly once", () => {
    const schema = judgeOutputSchema(["keyIdea/0", "question/0"]);
    const ok = {
      items: [
        { ref: "keyIdea/0", reason: "r", useful: 5 },
        { ref: "question/0", reason: "r", useful: 3 },
      ],
      pitch: { reason: "p", score: 4 },
    };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, items: [ok.items[0]] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, items: [ok.items[0], ok.items[0]] }).success).toBe(false);
    expect(
      schema.safeParse({ ...ok, items: [ok.items[0], { ...ok.items[1], ref: "vocabulary/9" }] })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ ...ok, pitch: { reason: "p", score: 6 } }).success).toBe(false);
    expect(() => judgeOutputSchema([])).toThrow();
  });

  test("judge sees the section input and one labelled set, no evidence ids, and keys by label", async () => {
    const input = {
      subject: "Geography",
      band: "Year 5",
      outcome: "I can explain how volcanoes form",
      sentences: block,
    };
    const packets = judgePackets(
      [
        {
          label: "B",
          items: [
            { id: "it", ok: true, output, attempts: 1, schemaFailures: 0, latencyMs: 1 },
            { id: "it2", ok: false, attempts: 2, schemaFailures: 2, latencyMs: 1 },
          ],
        },
      ],
      { it: input, it2: input },
    );
    expect(packets.length).toBe(1);
    const refs = judgeItems(output).map((i) => i.ref);
    expect(refs).toEqual([
      "keyIdea/0",
      "misconception/0",
      "vocabulary/0",
      "vocabulary/1",
      "workedExample/0",
      "question/0",
      "question/1",
      "question/2",
    ]);
    const answer = {
      items: refs.map((ref, i) => ({ ref, reason: `r${i}`, useful: (i % 5) + 1 })),
      pitch: { reason: "fine", score: 4 },
    };
    const ai = createFakeAi({
      script: [JSON.stringify(answer)],
      usage: { inputTokens: 3000, outputTokens: 400 },
      modelIds: { standard: DEFAULT_JUDGE_MODEL },
    });
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const r = await judge(packets[0] as JudgePacket, { ai, budget });
    expect(r.label).toBe("B");
    expect(r.items.length).toBe(8);
    expect(r.pitch).toEqual({ score: 4, reason: "fine" });
    expect(r.costUsd).toBeGreaterThan(0);
    const text = ai.calls[0]?.promptText ?? "";
    expect(text).toContain("Year group: Year 5");
    expect(text).toContain("Outcome: I can explain how volcanoes form");
    expect(text).toContain("[s3] (w: T § a) Unrelated sentence.");
    expect(text).toContain(
      "[question/0] Question (recall; multiple-choice): Which erupts gently? Answer: Shield volcanoes Distractors: Stratovolcanoes; Cinder cones; Calderas",
    );
    expect(text).not.toContain("evidence");
    expect(text).not.toContain("Label");
    const s = summariseJudge("B", [r]);
    expect(s.items).toBe(8);
    expect(s.meanPitch).toBe(4);
    expect(s.unusable).toBe(refs.filter((_, i) => (i % 5) + 1 <= 2).length);
  });

  test("dry runs price by list rate and grow with the packet", () => {
    const { packets } = supportPackets("it", output, block);
    const d = supportDryRun(packets);
    expect(d.calls).toBe(8);
    expect(d.usd).toBeGreaterThan(0);
    expect(d.usd).toBeLessThan(0.01);
    const input = { subject: "G", band: "Year 5", outcome: "O", sentences: block };
    const j = judgeDryRun([{ label: "A", itemId: "it", input, output }], DEFAULT_JUDGE_MODEL);
    expect(j.calls).toBe(1);
    expect(j.outputTokens).toBe(80 + 40 * 8);
    expect(j.usd).toBeGreaterThan(0);
    expect(judgeDryRun([], "nobody/unpriced").usd).toBeNull();
  });
});
