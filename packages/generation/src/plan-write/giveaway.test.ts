import { describe, expect, test } from "bun:test";
import type { PlanSlide } from "../prompts/plan-lesson";
import { checksToInsert } from "./check";
import {
  boldTerm,
  firstUses,
  giveaways,
  holdsAnswer,
  termsOffSlide,
  visualHolds,
} from "./giveaway";
import type { PassSlide } from "./slide-check";

const row = (o: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  tests: [],
  teaches: [],
  purpose: "",
  parts: 3,
  form: "explain",
  layout: "default",
  imageBrief: null,
  figureBrief: null,
  ...o,
});
const s = (number: number, r: Partial<PlanSlide>, out: Record<string, unknown>): PassSlide => ({
  number,
  row: row(r),
  out,
});

describe("answer in the stem (audit problem 1)", () => {
  test("the audit's giveaways are caught", () => {
    expect(
      holdsAnswer(
        "What secures Ariel's obedience in Prospero's threat?",
        "Threatened punishment",
        [],
      ),
    ).not.toEqual([]);
    expect(holdsAnswer("What charge does a positive ion have?", "Positive", [])).not.toEqual([]);
    expect(holdsAnswer("Which metal names the Iron Age?", "Iron", [])).not.toEqual([]);
    // round 2: a tautology (answer restates the stem) is the same giveaway
    expect(
      holdsAnswer(
        "Which electrode in an electrolysis cell is negative?",
        "The negative electrode",
        ["electrolysis"],
      ),
    ).not.toEqual([]);
  });
  test("a real check passes, and the topic word is exempt", () => {
    expect(
      holdsAnswer("What happens to the particles when ice melts?", "They move further apart", []),
    ).toEqual([]);
    expect(holdsAnswer("Which gas forms at the cathode in brine?", "Hydrogen", [])).toEqual([]);
    expect(holdsAnswer("Where did Roman towns develop?", "In Roman Britain", ["roman"])).toEqual(
      [],
    );
  });
  test("a choice question naming its options is not a giveaway", () => {
    const flags = giveaways(
      [
        s(
          3,
          { role: "retrieve", form: "starter-set" },
          {
            questions: [
              { question: "Which has a shell, a tortoise or a rabbit?", answer: "A tortoise" },
            ],
          },
        ),
      ],
      "Animals and their young",
    );
    expect(flags).toEqual([]);
  });
  test("a quick check re-using a worked example's numbers is a shown case", () => {
    const flags = giveaways(
      [
        s(
          5,
          { form: "worked-example" },
          {
            heading: "Mean rate",
            question: "Find the mean rate when 40 cm³ forms in 20 s.",
            steps: ["40 ÷ 20 = 2 (gas over time)"],
          },
        ),
        s(
          6,
          { role: "check", form: "check-set" },
          {
            questions: [{ question: "Find the mean rate for 40 cm³ in 20 s.", answer: "2 cm³/s" }],
          },
        ),
      ],
      "Rates of reaction",
    );
    expect(flags.map((f) => f.kind)).toEqual(["shown-case"]);
    expect(flags[0]?.item).toBe(0);
  });
});

describe("a teach picture under a question", () => {
  test("a table holding the answer is caught", () => {
    expect(
      visualHolds(
        "Savers | Lost buying power | Borrowers | Debts shrank",
        ["Lost buying power"],
        "Weimar hyperinflation",
      ),
    ).toBeDefined();
    expect(visualHolds("Solid | Liquid | Gas", ["Hydrogen"], "Electrolysis")).toBeUndefined();
  });
});

describe("key terms on the slide (audit problems 3 and 4)", () => {
  const deck = [
    s(
      3,
      { role: "retrieve", form: "starter-set" },
      { questions: [{ question: "Who lost the war?", answer: "Germany" }] },
    ),
    s(
      4,
      {},
      {
        heading: "Printing money raised prices",
        body: ["The bills: the state printed money."],
        notes: "Hyperinflation is an extremely rapid rise in prices.",
      },
    ),
    s(
      5,
      { role: "check", form: "check-set" },
      {
        questions: [{ question: "What is hyperinflation?", answer: "A very rapid rise in prices" }],
      },
    ),
  ];
  test("a term first on screen in a question is flagged, targeted at the slide whose notes have it", () => {
    expect(termsOffSlide(deck, ["hyperinflation"])).toEqual([
      { term: "hyperinflation", askedOn: 5, kind: "asked-first", target: 4 },
    ]);
  });
  test("a name only on the title slide is on screen, not nowhere", () => {
    expect(termsOffSlide(deck, ["Sigmund Freud"], "Freud's theories, Sigmund Freud")).toEqual([]);
    expect(termsOffSlide(deck, ["Sigmund Freud"])).toEqual([
      { term: "Sigmund Freud", kind: "nowhere" },
    ]);
  });
  test("first use found on screen, notes ignored", () => {
    expect(firstUses(deck, ["hyperinflation"]).get("hyperinflation")).toBe(5);
  });
  test("bold marks the first whole-word use only, not a bold label", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hyperinflation:", marks: [{ type: "bold" }] },
            { type: "text", text: " hyperinflation is a rapid rise. Hyperinflation hurts savers." },
          ],
        },
      ],
    } as never;
    const { doc: out, done } = boldTerm(doc, "hyperinflation");
    expect(done).toBe(true);
    const texts =
      (out as { content: { content: { text: string; marks?: unknown[] }[] }[] }).content[0]
        ?.content ?? [];
    expect(texts.map((t) => [t.text, !!t.marks])).toEqual([
      ["Hyperinflation:", true],
      [" ", false],
      ["hyperinflation", true],
      [" is a rapid rise. Hyperinflation hurts savers.", false],
    ]);
  });
});

describe("code-added checks (audit problem 1)", () => {
  test("no quick check straight after a worked example", () => {
    const rows = [
      row({ form: "title" }),
      row({ form: "objectives" }),
      row({ teaches: ["mean rate"] }),
      row({ form: "worked-example", teaches: ["mean rate method"] }),
      row({ objectives: [2], teaches: ["collision theory"] }),
    ];
    expect(checksToInsert(rows).map((c) => c.after)).toEqual([5]);
  });
});
