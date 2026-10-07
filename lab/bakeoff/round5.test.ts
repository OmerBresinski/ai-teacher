import { describe, expect, test } from "bun:test";
import { armT } from "./arm-t";
import { referentFault } from "./checks";
import { pictureFallbackOk, placedPictureText, withCorrectLetter } from "./harness";
import { lessonNotes } from "./round4";
import { schemaFaults } from "./smoke-diagrams";

describe("round 5 harness", () => {
  test("referent: y11 r4 s6 'Read the results' with no table fails; with the data it passes", () => {
    const words =
      "Read the results\nEach mixture also contains 10 cm³ of the same acid. Identify the trend as the stock thiosulfate volume increases.";
    expect(referentFault(words, false)).toContain("no data, table or graph");
    expect(referentFault(words, true)).toBeUndefined();
    const withData = `${words}\n40 cm³: 20 s · 30 cm³: 27 s · 20 cm³: 40 s · 10 cm³: 80 s`;
    expect(referentFault(withData, false)).toBeUndefined();
    expect(referentFault("Explain why gases compress.", false)).toBeUndefined();
  });
  test("visual or fallback: particles and flows may become pictures; graphs and tables never", () => {
    expect(pictureFallbackOk("particles", "Particles moving faster at a higher temperature")).toBe(
      true,
    );
    expect(pictureFallbackOk("flow", "How hyperinflation spiralled")).toBe(true);
    expect(pictureFallbackOk("line-graph", "Gas volume over time")).toBe(false);
    expect(pictureFallbackOk("table", "Results")).toBe(false);
  });
  test("words only never point at the missing visual", () => {
    const s = {
      template: "visual-text",
      heading: "Inside a solid",
      lead: "Look at the diagram. Particles are closely packed.",
      points: ["The diagram shows fixed positions.", "They vibrate."],
      figure: { kind: "particles", shows: "a solid", labels: [] },
    };
    const w = armT.asWords?.(s) as Record<string, unknown>;
    expect(w.template).toBe("explain");
    expect(w.lead).toBe("Particles are closely packed.");
    expect(w.points).toEqual(["They vibrate."]);
    expect(w.figure).toBeUndefined();
  });
  test("notes: a partial answer (y7: 4 of 12) gets a top-up call for exactly the missing slides", async () => {
    const asked: string[] = [];
    const chat = async (r: { user: string }) => {
      asked.push(r.user);
      if (asked.length === 1)
        return {
          usd: 0,
          ms: 1,
          out: {
            slides: [9, 10, 11, 12].map((n) => ({
              n,
              answers: "a",
              misconceptions: null,
              background: null,
            })),
          },
        };
      return {
        usd: 0,
        ms: 1,
        out: {
          slides: [3, 4, 5, 6, 7, 8].map((n) => ({
            n,
            answers: "b",
            misconceptions: null,
            background: null,
          })),
        },
      };
    };
    const got = await lessonNotes({
      slides: 12,
      first: 3,
      system: "",
      user: "L",
      schema: {},
      chat: chat as never,
      log: () => {},
      onUsd: () => {},
    });
    expect(asked[1]).toContain("these slides only: 3, 4, 5, 6, 7, 8.");
    expect([...got.keys()].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(got.get(5)?.answers).toBe("b");
  });
  test("notes: MCQ answers start with the rendered letter; pictures are described as placed", () => {
    expect(
      withCorrectLetter("More successful collisions.", { template: "hinge", correct: 2 }),
    ).toBe("B: More successful collisions.");
    expect(withCorrectLetter("B. More.", { correct: 2 })).toBe("B. More.");
    expect(withCorrectLetter("x", { template: "practice" })).toBe("x");
    expect(
      placedPictureText(
        { alt: "Marble chips in a dish", subjects: [{ name: "marble chips" }] },
        "magnesium ribbon",
      ),
    ).toBe("Marble chips in a dish (visible: marble chips)");
  });
  test("smoke gate: every diagram kind's spec schema is one OpenAI accepts", () => {
    expect(schemaFaults()).toEqual([]);
  });
});
