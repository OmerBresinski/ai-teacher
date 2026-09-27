import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  keyStageOf,
  OakFillFactSchema,
  oakFactLines,
  type PackOakFillInput,
  PackOakFillOutputSchema,
  packOakFillPrompt,
} from "./oak-fill";

/*
 * pack-oak-fill.v1 (28 Sept 2026). The system text is pinned by hash and the user turn by a full
 * render, so a wording change is a deliberate version bump. The schema tests hold the per-kind
 * field pairing, which is prose in the prompt and a refinement in code.
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const input: PackOakFillInput = {
  subject: "History",
  yearGroup: "Year 6",
  brief: "Year 6 History. Topic: Evacuation of children in the Second World War. 60-minute lesson.",
  section: {
    title: "Bombing and evacuation",
    outcome:
      "I can explain why evacuation was a huge turning point for many children during the Second World War.",
  },
  existing: oakFactLines({
    keyIdeas: [
      {
        statement:
          "The government had prepared for this by evacuating many children away from the cities the moment the war started.",
      },
    ],
    vocabulary: [
      { term: "evacuee", definition: "a person who has been moved to another place for safety" },
    ],
    misconceptions: [
      {
        belief: "Pupils may think that children were only evacuated to areas in Britain.",
        correction:
          "Children were sent to other countries like Australia and South Africa in 1940.",
      },
    ],
  }),
  kinds: ["date", "figure", "namedSpecific"],
};

describe("pack-oak-fill.v1", () => {
  test("version, system text and word count are pinned", () => {
    expect(packOakFillPrompt.version).toBe("pack-oak-fill.v1");
    expect(sha(packOakFillPrompt.system)).toBe("854812007ec0adfe");
    expect(words(packOakFillPrompt.system)).toBe(199);
  });

  test("the user turn renders the packet in order, with the key stage from code", () => {
    expect(packOakFillPrompt.user(input)).toBe(
      [
        "Subject: History; Year group: Year 6 (Key Stage 2)",
        "Brief: Year 6 History. Topic: Evacuation of children in the Second World War. 60-minute lesson.",
        "Section: Bombing and evacuation",
        "Outcome: I can explain why evacuation was a huge turning point for many children during the Second World War.",
        "Facts already in the section:",
        "- The government had prepared for this by evacuating many children away from the cities the moment the war started.",
        "- term: evacuee: a person who has been moved to another place for safety",
        "- misconception: Pupils may think that children were only evacuated to areas in Britain. Response: Children were sent to other countries like Australia and South Africa in 1940.",
        "Kinds this section lacks: date, figure, namedSpecific",
      ].join("\n"),
    );
  });

  test("a set text adds one line after the brief; no set text adds none", () => {
    const lit = packOakFillPrompt.user({
      ...input,
      subject: "English",
      yearGroup: "Year 10",
      kinds: ["quotation"],
      text: { name: "The Tempest (Shakespeare)", edition: "Project Gutenberg #1540" },
    });
    expect(lit.split("\n")[2]).toBe("Set text: The Tempest (Shakespeare), Project Gutenberg #1540");
    expect(packOakFillPrompt.user(input)).not.toContain("Set text");
    expect(keyStageOf("Year 10")).toBe(" (Key Stage 4)");
    expect(keyStageOf("KS4")).toBe("");
  });

  test("each kind needs its own fields; confidence is the last field the model writes", () => {
    const keys = Object.keys(OakFillFactSchema.shape);
    expect(keys.at(-1)).toBe("confidence");
    expect(keys.indexOf("locator")).toBeLessThan(keys.indexOf("confidence"));
    const ok = (f: unknown) => OakFillFactSchema.safeParse(f).success;
    expect(
      ok({
        kind: "quotation",
        quote: "This island's mine by Sycorax my mother",
        locator: "1.2, Caliban",
        statement: "Caliban claims the island as his by inheritance.",
        confidence: "certain",
      }),
    ).toBe(true);
    expect(ok({ kind: "quotation", locator: "1.2, Caliban", confidence: "certain" })).toBe(false);
    expect(
      ok({
        kind: "date",
        statement: "Evacuation began on 1 September 1939.",
        confidence: "unsure",
      }),
    ).toBe(false);
    expect(
      ok({
        kind: "figure",
        statement: "About 1.5 million people were evacuated in the first three days.",
        locator: "IWM",
        confidence: "certain",
      }),
    ).toBe(true);
    expect(
      ok({
        kind: "workedExample",
        problem: "Share £60 in the ratio 2:3.",
        steps: ["2 + 3 = 5 parts", "£60 ÷ 5 = £12 a part", "2 × £12 = £24; 3 × £12 = £36"],
        answer: "£24 and £36",
        confidence: "certain",
      }),
    ).toBe(true);
    expect(ok({ kind: "workedExample", problem: "Share £60 in 2:3.", confidence: "certain" })).toBe(
      false,
    );
    expect(ok({ kind: "misconception", statement: "x", locator: "y", confidence: "certain" })).toBe(
      false,
    );
    expect(PackOakFillOutputSchema.safeParse({ facts: [] }).success).toBe(true);
  });
});
