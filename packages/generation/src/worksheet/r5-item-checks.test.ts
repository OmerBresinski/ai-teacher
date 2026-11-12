import { describe, expect, test } from "bun:test";
import sheets from "./fixtures/r5-sheet-items.json";
import {
  challengeEasierThan,
  challengeRestates,
  giveawayFault,
  premiseOf,
  sameItemPairs,
} from "./sheet-items";

/*
 * R5 (12 Nov): the item checks measured on real sheets: the 15 saved v5 Practice sheets and the
 * 24 blind-judged v3/v4 sheets (scratchpad/tuning/e2e-11nov), every kept item as it shipped.
 * Each flag below was hand-checked against WS-V5-KEYS.md and WS-BLIND-JUDGE.md; none is wrong.
 */
type Item = { where: string; question: string; answer: string; working: string | null };
const all = sheets as Record<string, Item[]>;

const flagged = () => {
  const give: string[] = [];
  const dup: string[] = [];
  const rest: string[] = [];
  const easier: string[] = [];
  for (const [k, items] of Object.entries(all)) {
    items.forEach((it, i) => {
      if (giveawayFault(it)) give.push(`${k} Q${i + 1}`);
    });
    for (const [a, b] of sameItemPairs(items)) dup.push(`${k} Q${a + 1}~Q${b + 1}`);
    const r = challengeRestates(items);
    if (r) rest.push(`${k} Q${items.length}<${r.map((x) => `Q${x + 1}`).join("+")}`);
    const e = challengeEasierThan(items);
    if (e !== null) easier.push(`${k} Q${items.length}<Q${e + 1}`);
  }
  return { give, dup, rest, easier };
};

describe("R5 item checks on the 39 real sheets", () => {
  test("flag exactly the hand-checked items", () => {
    expect(flagged()).toEqual({
      give: [
        "v5-r2-y2-greatfire Q5",
        "v5-r5-y2-greatfire Q5",
        "blind-y2-greatfire-sheet-D Q3",
        "blind-y2-greatfire-sheet-F Q3",
        "blind-y2-greatfire-sheet-F Q6",
      ],
      dup: ["blind-y2-greatfire-sheet-B Q6~Q3"],
      rest: [
        "v5-r3-y8-photosynthesis Q8<Q6+Q7",
        "v5-r5-y8-photosynthesis Q8<Q5+Q7",
        "blind-y2-greatfire-sheet-B Q6<Q3",
        "blind-y2-greatfire-sheet-F Q6<Q4",
        "blind-y2-greatfire-sheet-J Q6<Q3+Q4",
        "blind-y8-photosynthesis-sheet-D Q7<Q3",
      ],
      easier: [],
    });
  });
});

describe("giveaway", () => {
  const q = (question: string, answer: string) =>
    giveawayFault({ question, answer, working: null });
  test("the stem tells the answer", () => {
    expect(
      q(
        "Pepys saw people escaping by boat and wrote in an open diary. What could his diary tell us about their escape?",
        "It could tell us that people escaped by boat with their belongings.",
      ),
    ).not.toBeNull();
    expect(
      q(
        "Which plan uses both ways people helped stop the fire: carrying water in buckets and pulling down houses?",
        "Carry water in buckets and pull down houses to make gaps.",
      ),
    ).not.toBeNull();
  });
  test("an either/or choice, a tick list, a claim to judge and a yes/no question are not giveaways", () => {
    expect(
      q(
        "Which would help stop flames reaching another house: leaving close wooden houses standing or pulling houses down to make gaps?",
        "Pulling houses down to make gaps.",
      ),
    ).toBeNull();
    expect(
      q(
        "Which could Pepys’s diary tell us about? Tick one. Some people escaping by boat with belongings Every Londoner escaping by boat",
        "Some people escaping by boat with belongings",
      ),
    ).toBeNull();
    expect(
      q(
        "A pupil claims that photosynthesis adds carbon dioxide to the atmosphere and removes oxygen. State the correct change.",
        "Photosynthesis removes carbon dioxide from the atmosphere and releases oxygen.",
      ),
    ).toBeNull();
    expect(
      q(
        "People have made gaps by pulling down houses, and the winds are weaker. Will these changes help stop the fire?",
        "Yes. Gaps and weaker winds helped stop the fire.",
      ),
    ).toBeNull();
  });
  test("the premise is what is told before the ask, less a quoted claim", () => {
    expect(
      premiseOf("A plant makes glucose by photosynthesis. What two products are made?").trim(),
    ).toBe("A plant makes glucose by photosynthesis.");
    expect(premiseOf('A pupil says, "Light is a reactant." Is the pupil right?').trim()).toBe("");
  });
});

describe("near-duplicate and challenge", () => {
  const calc = (where: string, working: string) => ({ where, question: "q", answer: "a", working });
  test("two core items opening on the same step; a warm-up then a core item on it builds", () => {
    expect(
      sameItemPairs([
        calc("core", "35 ÷ 5 = 7; 7 × 4 = 28"),
        calc("core", "35 ÷ 5 = 7; 7 × 6 = 42"),
      ]),
    ).toEqual([[1, 0, "takes the same step (35÷5) as"]]);
    expect(
      sameItemPairs([calc("warm-up", "18 ÷ 4 = 4½"), calc("core", "18 ÷ 4 = 4½; 4½ × 3 = 13½")]),
    ).toEqual([]);
  });
  test("a challenge that only joins two earlier keys", () => {
    const it = (answer: string) => ({ answer, working: null });
    expect(
      challengeRestates([
        it("Stomata allow carbon dioxide to enter the leaf."),
        it("Leaf veins supply water."),
        it("Stomata allow carbon dioxide to enter the leaf. Leaf veins supply water."),
      ]),
    ).toEqual([0, 1]);
    expect(
      challengeRestates([it("Glucose."), it("Plants store energy in glucose for food chains.")]),
    ).toBeNull();
  });
});
