import { describe, expect, test } from "bun:test";
import { checkPack, type Pack, PackSchema, presentTypes, sectionToObjectiveFacts } from "./schema";

const SENTENCES = [
  {
    id: "s1.1",
    heading: "Roman Britain",
    text: "The Romans invaded Britain in AD 43 under the emperor Claudius.",
  },
  {
    id: "s1.2",
    heading: "Roman Britain",
    text: "Britain had metals, grain and cattle that Rome wanted.",
  },
  {
    id: "s1.3",
    heading: "Roman Britain",
    text: "Boudica led a revolt against Roman rule in AD 60 or 61.",
  },
];

export function samplePack(): Pack {
  const url = "https://en.wikipedia.org/wiki/Roman_Britain";
  return PackSchema.parse({
    id: "romans-test",
    topic: "romans",
    subject: "History",
    yearGroup: "Year 4",
    arm: "hand",
    writtenAt: "2026-09-23T12:00:00.000Z",
    provenance: { writer: "none", writerPrompt: "hand" },
    sources: [
      {
        id: "s1",
        url,
        title: "Roman Britain",
        revision: "1",
        fetchedAt: "2026-09-23T12:00:00.000Z",
        licence: "CC-BY-SA-4.0",
        sentences: SENTENCES,
      },
    ],
    sections: [
      {
        id: "sec1",
        outcome: "Explain why the Romans invaded Britain",
        sentenceIds: ["s1.1", "s1.2"],
        facts: {
          keyIdeas: [
            {
              statement: "Rome wanted Britain's resources.",
              explanation: "Britain had metals, grain and cattle.",
              example: "Claudius ordered the invasion in AD 43.",
              evidence: [{ url, sentenceIds: ["s1.2"], snippet: "metals, grain and cattle" }],
            },
          ],
          misconceptions: [
            {
              belief: "The Romans came only to fight.",
              correction: "They came for wealth too.",
              evidence: [{ url, sentenceIds: ["s1.2"], snippet: "Rome wanted" }],
            },
          ],
          vocabulary: [
            {
              term: "emperor",
              sense: "ruler of the Roman empire",
              band: "Y3-4",
              definition: "The ruler of all Rome's lands.",
              evidence: [{ url, sentenceIds: ["s1.1"], snippet: "the emperor Claudius" }],
            },
          ],
          workedExamples: [],
          questions: [
            {
              stem: "When did the Romans invade Britain?",
              answer: "AD 43",
              reasoning: "The invasion under Claudius was in AD 43.",
              tier: "easy",
              use: "any",
              demand: "recall",
              forms: ["open-response"],
              evidence: [{ url, sentenceIds: ["s1.1"], snippet: "invaded Britain in AD 43" }],
            },
          ],
        },
      },
    ],
  });
}

describe("pack schema", () => {
  test("a sound pack has no structural issues", () => {
    expect(checkPack(samplePack())).toEqual([]);
  });

  test("a snippet that is not verbatim, too long, or cites an unknown sentence is an issue", () => {
    const pack = samplePack();
    const k = pack.sections[0]?.facts.keyIdeas[0];
    if (!k) throw new Error("fixture");
    k.evidence = [
      {
        url: k.evidence[0]?.url ?? "",
        sentenceIds: ["s1.2"],
        snippet: "metals grain cattle and gold",
      },
      { url: k.evidence[0]?.url ?? "", sentenceIds: ["s1.9"], snippet: "x" },
      {
        url: k.evidence[0]?.url ?? "",
        sentenceIds: ["s1.1"],
        snippet: Array.from({ length: 26 }, (_, i) => `w${i}`).join(" "),
      },
    ];
    const issues = checkPack(pack).map((i) => i.issue);
    expect(issues).toContain("snippet-not-verbatim");
    expect(issues).toContain("unknown-sentence");
    expect(issues).toContain("snippet-too-long");
  });

  test("a multiple-choice form declared with fewer than three distractors is an issue", () => {
    const pack = samplePack();
    const q = pack.sections[0]?.facts.questions[0];
    if (!q) throw new Error("fixture");
    q.forms = ["multiple-choice"];
    q.distractors = [{ text: "AD 60" }];
    expect(checkPack(pack).map((i) => i.issue)).toContain("distractor-count-below-declared-form");
  });

  test("a misconception ref outside the section's list is an issue", () => {
    const pack = samplePack();
    const q = pack.sections[0]?.facts.questions[0];
    if (!q) throw new Error("fixture");
    q.distractors = [{ text: "AD 60", misconceptionRef: { type: "misconception", index: 3 } }];
    expect(checkPack(pack).map((i) => i.issue)).toContain("misconception-ref-out-of-range");
  });

  test("sectionToObjectiveFacts copies fields and drops evidence, sense and band", () => {
    const section = samplePack().sections[0];
    if (!section) throw new Error("fixture");
    const out = sectionToObjectiveFacts(section);
    expect(out.keyIdeas).toEqual([
      {
        statement: "Rome wanted Britain's resources.",
        explanation: "Britain had metals, grain and cattle.",
        example: "Claudius ordered the invasion in AD 43.",
      },
    ]);
    expect(out.vocabulary).toEqual([
      { term: "emperor", definition: "The ruler of all Rome's lands." },
    ]);
    expect(out.questions[0]).not.toHaveProperty("evidence");
    expect(out.questions[0]?.forms).toEqual(["open-response"]);
    expect(sectionToObjectiveFacts(section, ["vocabulary"]).keyIdeas).toEqual([]);
    expect(presentTypes(section)).toEqual([
      "keyIdeas",
      "misconceptions",
      "vocabulary",
      "questions",
    ]);
  });
});
