import { describe, expect, test } from "bun:test";
import { catalogue, rankByObjectives } from "./catalogue";

/*
 * Library turn-on step 5 (flag `libraryMenuRank`): within the filtered menu, models relevant to
 * the lesson's objectives come first (a deterministic word match); none is dropped.
 */
const Y6 = [
  "Identify the heart, blood and blood vessels as the main parts of the human circulatory system.",
  "Describe how the heart pumps blood to the lungs to collect oxygen and around the body.",
];

describe("menu ranked by objectives", () => {
  test("y6 heart: heart_circulation first, the same models as unranked", async () => {
    const f = { yearGroup: "Year 6", subject: "Science" };
    const plain = (await catalogue("KS2", f)).map((e) => e.id);
    const ranked = (await catalogue("KS2", { ...f, objectives: Y6 })).map((e) => e.id);
    expect(ranked[0]).toBe("heart_circulation");
    expect([...ranked].sort()).toEqual([...plain].sort());
  });
  test("ties keep gallery order; no objective words keeps the order", () => {
    const e = [
      { id: "a", teaches: "fractions of amounts" },
      { id: "b", teaches: "rivers" },
      { id: "c", teaches: "fractions" },
    ];
    expect(rankByObjectives(e, ["Find fractions of an amount"]).map((x) => x.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(rankByObjectives(e, [""]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
