import { describe, expect, test } from "bun:test";
import {
  BlockSpecSchema,
  blockSpecSchemaFor,
  imageTextSpecSchemaFor,
  PICTURE_NONE,
  PICTURE_NONE_ANY,
  PICTURE_PLURAL,
  SlideSpecSchema,
  slideSpecSchemaFor,
  stripEnumerator,
  TASK_NOT_VISIBLE,
} from "./specs";

/*
 * The spec sanitiser (Generation quality §3; TEACH-210): a degenerate or leaking spec is a
 * validation issue with a message the model can act on, an escaped entity is decoded.
 */

const base = { factRefs: ["o1"] };

const issuesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  result.success
    ? []
    : (result.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message }));

describe("spec sanitiser", () => {
  test("row 1: HTML entities in a text slot are decoded, not rejected", () => {
    const parsed = SlideSpecSchema.parse({
      kind: "exit-ticket",
      ...base,
      heading: "Rodent Teeth &amp; Classifying",
      items: [
        "What is a rodent?",
        "Name two rodents &lt;3 letters&gt;",
        "Why the &quot;incisors&quot;?",
      ],
    });
    if (parsed.kind !== "exit-ticket") throw new Error("kind");
    expect(parsed.heading).toBe("Rodent Teeth & Classifying");
    expect(parsed.items[1]).toBe("Name two rodents <3 letters>");
    expect(parsed.items[2]).toBe('Why the "incisors"?');
  });

  test("decoding happens before the length cap: an entity-heavy heading that fits once decoded passes", () => {
    const heading = `${"a".repeat(74)} &amp;&amp;`; // 84 chars raw, 78 decoded (cap 80)
    expect(
      SlideSpecSchema.safeParse({ kind: "content", ...base, heading, body: "b" }).success,
    ).toBe(true);
  });

  test("row 2: matching with two equal right-hand sides names the pairs", () => {
    const issues = issuesOf(
      SlideSpecSchema.safeParse({
        kind: "matching",
        ...base,
        stem: "Match each animal to its group",
        pairs: [
          { left: "Rat", right: "One pair of ever-growing incisors" },
          { left: "Mouse", right: "one pair of ever-growing incisors" },
          { left: "Rabbit", right: "Two pairs of upper incisors" },
        ],
      }),
    );
    expect(issues).toContainEqual({
      path: ["pairs"],
      message: expect.stringContaining("different"),
    });
    const block = issuesOf(
      BlockSpecSchema.safeParse({
        type: "matching",
        ...base,
        pairs: [
          { left: "Rat", right: "A" },
          { left: "rat", right: "B" },
          { left: "Mouse", right: "C" },
        ],
      }),
    );
    expect(block).toContainEqual({
      path: ["pairs"],
      message: expect.stringContaining("different"),
    });
  });

  test("multiple-choice options must differ (case and whitespace aside); slide and block alike", () => {
    const options = [
      { text: "Evaporation", correct: true },
      { text: "evaporation ", correct: false },
      { text: "Condensation", correct: false },
      { text: "Freezing", correct: false },
    ];
    expect(
      issuesOf(
        SlideSpecSchema.safeParse({ kind: "multiple-choice", ...base, stem: "Which?", options }),
      ),
    ).toContainEqual({ path: ["options"], message: "Every option must be different." });
    expect(
      issuesOf(
        BlockSpecSchema.safeParse({ type: "multiple-choice", ...base, text: "Which?", options }),
      ),
    ).toContainEqual({ path: ["options"], message: "Every option must be different." });
  });

  test("row 3: a starter footnote equal to one of its items is an issue at footnote", () => {
    const issues = issuesOf(
      SlideSpecSchema.safeParse({
        kind: "starter",
        ...base,
        items: ["Write down two rodents.", "How do you know they are rodents?"],
        footnote: "How do you know they are rodents?",
      }),
    );
    expect(issues).toContainEqual({
      path: ["footnote"],
      message: expect.stringContaining("repeats"),
    });
    // instructions (steps) and exit-ticket (items) share the rule.
    expect(
      issuesOf(
        SlideSpecSchema.safeParse({
          kind: "instructions",
          ...base,
          steps: ["Open your book."],
          footnote: "Open your book",
        }),
      ),
    ).toContainEqual({ path: ["footnote"], message: expect.stringContaining("repeats") });
    expect(
      SlideSpecSchema.safeParse({ kind: "starter", ...base, items: ["A"], footnote: "3 minutes" })
        .success,
    ).toBe(true);
  });

  test("row 4: house-rule language in a pupil-facing slot is an issue naming the slot", () => {
    const issues = issuesOf(
      SlideSpecSchema.safeParse({
        kind: "exit-ticket",
        ...base,
        items: [
          "Name a rodent.",
          "Hand in your answers — no names needed.",
          "One fact about incisors.",
        ],
      }),
    );
    expect(issues).toContainEqual({
      path: ["items", 1],
      message: expect.stringContaining("house rules"),
    });
    // A block slot too, and the JSON word.
    expect(
      issuesOf(BlockSpecSchema.safeParse({ type: "paragraph", ...base, text: "Answer in JSON." })),
    ).toContainEqual({ path: ["text"], message: expect.stringContaining("house rules") });
  });

  test("row 5: repair commentary in notes is an issue at notes; the same words in a body are not", () => {
    expect(
      issuesOf(
        SlideSpecSchema.safeParse({
          kind: "content",
          ...base,
          heading: "Rodents",
          body: "Rodents have one pair of incisors.",
          notes: "Corrected the rodent definition so that it matches the facts.",
        }),
      ),
    ).toContainEqual({
      path: ["notes"],
      message: expect.stringContaining("Notes are for the teacher"),
    });
    expect(
      SlideSpecSchema.safeParse({
        kind: "content",
        ...base,
        heading: "Rodents",
        body: "Rodents have one pair of incisors.",
        notes: "Ask: which of these is not a rodent, and why? Watch for 'rabbit'.",
      }).success,
    ).toBe(true);
  });

  test("row 6: a classify task as sort is an issue at stem; same-first-word steps at steps", () => {
    const sort = (stem: string, steps: string[]) =>
      issuesOf(SlideSpecSchema.safeParse({ kind: "sort", ...base, stem, steps }));
    expect(sort("Classify these animals", ["Rat", "Mouse", "Rabbit", "Hamster"])).toContainEqual({
      path: ["stem"],
      message: expect.stringContaining("genuine sequence"),
    });
    expect(
      sort("Put the stages in order", [
        "Rodent: rat",
        "Rodent: mouse",
        "Rodent: vole",
        "Rodent: gerbil",
      ]),
    ).toContainEqual({ path: ["steps"], message: expect.stringContaining("not an order") });
    expect(sort("Put in order", ["Melt", "Melt", "Boil", "Freeze"])).toContainEqual({
      path: ["steps"],
      message: "sort: every step must be different.",
    });
    expect(
      SlideSpecSchema.safeParse({
        kind: "sort",
        ...base,
        stem: "Put the water cycle in order",
        steps: ["Evaporation", "Condensation", "Precipitation", "Collection"],
      }).success,
    ).toBe(true);
  });

  test("a true/false statement joining two long claims with 'and' is an issue at statement", () => {
    const half =
      "the Orcish clans first crossed into Azeroth through the Dark Portal opened by Medivh";
    expect(
      issuesOf(
        SlideSpecSchema.safeParse({
          kind: "true-false",
          ...base,
          statement: `${half} and ${half.replace("first", "later")}`,
          correct: true,
        }),
      ),
    ).toContainEqual({ path: ["statement"], message: expect.stringContaining("one claim") });
    expect(
      SlideSpecSchema.safeParse({
        kind: "true-false",
        ...base,
        statement: "Rats and mice are rodents.",
        correct: true,
      }).success,
    ).toBe(true);
  });

  test("the per-kind schemas keep working with the refinements in place", () => {
    for (const kind of [
      "starter",
      "matching",
      "sort",
      "true-false",
      "multiple-choice",
      "exit-ticket",
    ]) {
      expect(slideSpecSchemaFor(kind)).toBeDefined();
    }
  });
});

describe("image-text written to its photograph (TEACH-220)", () => {
  const flower = {
    visible: ["petals", "sepals"],
    count: "one" as const,
    mustShow: ["petals", "sepals", "stamens", "carpel"],
  };
  const spec = (body: string, heading = "Flower parts") => ({
    kind: "image-text",
    ...base,
    heading,
    body,
  });
  const messages = (photo: Parameters<typeof imageTextSpecSchemaFor>[0], body: string) => {
    const result = imageTextSpecSchemaFor(photo)?.safeParse(spec(body));
    return result?.success ? [] : (result?.error.issues.map((i) => i.message) ?? []);
  };

  test("row 7: a plural picture word with one photo and a task on a hidden item are two issues", () => {
    expect(messages(flower, "Use the pictures to spot the carpel.")).toEqual([
      PICTURE_PLURAL,
      TASK_NOT_VISIBLE("carpel"),
    ]);
  });

  test("a task that names only visible items passes; a description of a hidden item is not a task", () => {
    expect(messages(flower, "Look at the photograph and find the petals and sepals.")).toEqual([]);
    expect(
      messages(flower, "The carpel sits in the middle; the photograph shows the petals."),
    ).toEqual([]);
  });

  test("with no photograph any picture reference is rejected; plain content passes", () => {
    expect(messages("none", "Look at the picture of the flower.")).toEqual([PICTURE_NONE]);
    expect(messages("none", "A flower has four main parts.")).toEqual([]);
  });

  test("several photos may be called pictures; undefined evidence keeps the base schema", () => {
    expect(messages({ ...flower, count: "several" }, "The photos show the petals.")).toEqual([]);
    expect(messages(undefined, "Use the pictures to spot the carpel.")).toEqual([]);
  });
});

describe("list enumerators and picture references (TEACH-223)", () => {
  test("row 1: a leading enumerator on a list member is stripped, whatever its style", () => {
    expect(stripEnumerator("1. Explain how")).toBe("Explain how");
    expect(stripEnumerator("2) Name one")).toBe("Name one");
    expect(stripEnumerator("a) List two")).toBe("List two");
    expect(stripEnumerator("- Give three")).toBe("Give three");
    expect(stripEnumerator("• Four")).toBe("Four");
    expect(stripEnumerator("10 is a number")).toBe("10 is a number");
    expect(stripEnumerator("Explain 1. then 2.")).toBe("Explain 1. then 2.");
    const parsed = slideSpecSchemaFor("exit-ticket")?.safeParse({
      kind: "exit-ticket",
      ...base,
      heading: "Show what you know",
      items: ["1. Explain how its teeth help.", "2) Name two features.", "- List one more."],
    });
    expect(parsed?.success).toBe(true);
    if (parsed?.success && parsed.data.kind === "exit-ticket") {
      expect(parsed.data.items).toEqual([
        "Explain how its teeth help.",
        "Name two features.",
        "List one more.",
      ]);
    }
  });

  test("row 2: a picture word on any slide that is not image-text, in the text or the notes, is an issue naming the field", () => {
    const worked = slideSpecSchemaFor("worked-example")?.safeParse({
      kind: "worked-example",
      ...base,
      heading: "Decide whether this animal is a rodent",
      question: "A photo shows an animal with one pair of large upper incisors. Is it a rodent?",
      steps: ["Look at the front teeth.", "Find one pair at the top."],
      notes: "Point to the evidence in the photo.",
    });
    expect(worked?.success).toBe(false);
    if (!worked?.success) {
      expect(worked?.error.issues.map((i) => [i.path.join("."), i.message]).sort()).toEqual([
        ["notes", PICTURE_NONE_ANY],
        ["question", PICTURE_NONE_ANY],
      ]);
    }
    const block = blockSpecSchemaFor("question")?.safeParse({
      type: "question",
      ...base,
      text: "Look at the picture. What is it?",
      answer: "A rat.",
      answerLines: 1,
      marks: 1,
    });
    expect(block?.success).toBe(false);
    // "diagram" is a word a teacher draws on the board: not a picture reference.
    const content = slideSpecSchemaFor("content")?.safeParse({
      kind: "content",
      ...base,
      heading: "States of matter",
      body: "Draw the three particle diagrams.",
    });
    expect(content?.success).toBe(true);
  });

  test("row 3: an image-text slide with its photograph may say 'the photograph'", () => {
    const withPhoto = imageTextSpecSchemaFor({
      visible: ["front teeth"],
      count: "one",
      mustShow: ["front teeth"],
    })?.safeParse({
      kind: "image-text",
      ...base,
      heading: "Look closely",
      body: "The photograph shows the front teeth. Find them.",
    });
    expect(withPhoto?.success).toBe(true);
  });
});

describe("TEACH-247: worked-example steps fit the working card", () => {
  const spec = (step: string) => ({
    kind: "worked-example",
    factRefs: ["x1"],
    question: "Why does a puddle vanish?",
    steps: [step, "Second", "Third", "Fourth"],
  });
  test("a 56-character step is accepted; 57 is refused at the step", () => {
    const schema = slideSpecSchemaFor("worked-example");
    if (!schema) throw new Error("schema");
    expect(schema.safeParse(spec("x".repeat(56))).success).toBe(true);
    const long = schema.safeParse(spec("x".repeat(57)));
    expect(long.success).toBe(false);
    if (long.success) return;
    expect(long.error.issues[0]?.path).toEqual(["steps", 0]);
  });
  test("the question is capped at 120 characters — two lines at the floor", () => {
    const schema = slideSpecSchemaFor("worked-example");
    if (!schema) throw new Error("schema");
    expect(schema.safeParse({ ...spec("x"), question: "q".repeat(120) }).success).toBe(true);
    expect(schema.safeParse({ ...spec("x"), question: "q".repeat(121) }).success).toBe(false);
  });
});
