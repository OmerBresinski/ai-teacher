import { describe, expect, test } from "bun:test";
import {
  columnReadings,
  DISCUSSION_COUNTS_AS_CHECK,
  inOrderCoverage,
  lookSlides,
  matchQuote,
  norm,
  objectivesRole,
  objectivesSlideText,
  pictureText,
  type Slide,
  slideText,
  stripGlosses,
  summariseObjectives,
  verifyCite,
} from "./score";

const teach = (n: number, texts: string[], pictures: Slide["pictures"] = []): Slide => ({
  n,
  role: "teach",
  texts: texts.map((text) => ({ text })),
  questions: [],
  pictures,
});
const ask = (n: number, qs: string[]): Slide => ({
  n,
  role: "question",
  texts: qs.map((text) => ({ text })),
  questions: qs.map((text) => ({ text, options: [] })),
  pictures: [],
});

// base5-1 y12 s4: a drawn table whose alt is one generic sentence.
const TABLE_ALT = "Sensory register, STM and LTM differ in coding, capacity and duration.";
const table = {
  kind: "diagram",
  alt: TABLE_ALT,
  labels: [
    TABLE_ALT,
    "Store",
    "Coding",
    "Capacity",
    "Duration",
    "STM",
    "Mainly acoustic",
    "7 ± 2 items",
    "18–30 seconds",
  ],
  background: false,
};

describe("fix 1: norm strips a slash", () => {
  test("a label / text quote matches a slide that joins them with a newline (base5-1 y1 s4)", () => {
    const s = teach(4, ["Cow and calf", "A calf is a young cow."]);
    expect(
      verifyCite({ 4: s }, { slide: 4, quote: "Cow and calf / A calf is a young cow." }, "teach"),
    ).toBe(true);
  });
  test("still strips the old punctuation and squeezes spaces", () => {
    expect(norm("“Half” — of 1/2!")).toBe("half of 1 2");
  });
  test("a quote that is not on the slide still fails", () => {
    expect(
      verifyCite(
        { 4: teach(4, ["Cow and calf"]) },
        { slide: 4, quote: "A lamb is a young sheep." },
        "teach",
      ),
    ).toBe(false);
  });
});

describe("fix 2: a drawn table is shown by its cells, not only its alt", () => {
  test("objectives text carries the cells once, without repeating the alt", () => {
    const t = pictureText(table);
    expect(t).toBe(
      `[diagram: ${TABLE_ALT} Labels: Store; Coding; Capacity; Duration; STM; Mainly acoustic; 7 ± 2 items; 18–30 seconds]`,
    );
    expect(
      objectivesSlideText(teach(4, ["Three stores, different properties"], [table])),
    ).toContain("Mainly acoustic");
  });
  test("a quote from a cell verifies on that slide", () => {
    const s = teach(4, ["Three stores, different properties"], [table]);
    expect(verifyCite({ 4: s }, { slide: 4, quote: "Mainly acoustic; 7 ± 2 items" }, "teach")).toBe(
      true,
    );
  });
  test("other calls keep the alt-only text, so their cached requests stay valid", () => {
    expect(slideText(teach(4, [], [table]))).toBe(`[diagram: ${TABLE_ALT}]`);
  });
  test("a picture with no labels, or no alt, renders as before", () => {
    expect(pictureText({ kind: "photo", alt: "A hen", labels: [] })).toBe("[photo: A hen]");
    expect(pictureText({ kind: "diagram", alt: "", labels: ["A", "B"] })).toBe("[diagram: A; B]");
  });
  test("labels are capped", () => {
    const many = Array.from({ length: 60 }, (_, i) => `c${i}`);
    expect(pictureText({ kind: "diagram", alt: "t", labels: many }).split("; ").length).toBe(40);
  });
});

describe("fault 3: a look-only slide is reported, never counted (v3)", () => {
  // base5-1 y2: o1's look listed practice slide 12, checked was empty.
  const deck = {
    objectives: [
      { id: "o1", text: "Recognise halves and quarters of shapes." },
      { id: "o2", text: "Find half of a number." },
      { id: "o3", text: "Calculate a mean rate." },
    ],
    slides: [
      ask(2, ["What is half of 4?"]),
      teach(3, ["One half: one of two equal parts."]),
      teach(6, ["Share 10 counters into two equal groups."]),
      ask(11, ["Find half of 18 apples."]),
      ask(12, ["Draw a rectangle. Split it into halves. Shade one half."]),
      ask(13, [
        "Calculate a mean rate",
        "A reaction makes 48 cm³ in 60 s. Calculate its mean rate in cm³/s.",
      ]),
    ],
  };
  const resp = {
    objectives: [
      {
        id: "o1",
        look: "2, 3, 12",
        taught: [{ slide: 3, quote: "One half: one of two equal parts." }],
        checked: [],
      },
      {
        id: "o2",
        look: "6, 11, 12",
        taught: [{ slide: 6, quote: "Share 10 counters into two equal groups." }],
        checked: [{ slide: 11, quote: "Find half of 18 apples." }],
      },
      // polish2-1 y11: cited, and the quote merges the heading into the question. v3 failed it; v4's in-order
      // match (F2) accepts it.
      {
        id: "o3",
        look: "13",
        taught: [],
        checked: [{ slide: 13, quote: "Calculate a mean rate in cm³/s." }],
      },
    ],
  };
  const [o1, o2, o3] = summariseObjectives(deck, resp);
  test("a question slide in look with no cite does not count (v1 behaviour)", () => {
    expect(o1.checked).toEqual([]);
    expect(o1.lookOnly).toEqual([{ slide: 12, reason: "no cite" }]);
  });
  test("v4: a heading-merged quote now verifies (F2), so it is a check, not look-only", () => {
    expect(o3.checked).toEqual([13]);
    expect(o3.lookOnly).toEqual([]);
  });
  test("a cited slide whose quote is not on the slide does not count", () => {
    const r = summariseObjectives(deck, {
      objectives: [
        { id: "o3", look: "13", taught: [], checked: [{ slide: 13, quote: "Name three gases." }] },
      ],
    });
    expect(r[2].checked).toEqual([]);
    expect(r[2].lookOnly).toEqual([{ slide: 13, reason: "cite quote failed" }]);
  });
  test("retrieval slides before the first teaching slide, and verified checks, are not look-only", () => {
    expect(o1.lookOnly.map((x) => x.slide)).not.toContain(2);
    expect(o2.checked).toEqual([11]);
    expect(o2.lookOnly).toEqual([{ slide: 12, reason: "no cite" }]);
  });
  test("teaching slides in look never become checks", () => {
    const r = summariseObjectives(deck, {
      objectives: [{ id: "o1", look: "3", taught: [], checked: [] }],
    });
    expect(r[0].checked).toEqual([]);
    expect(r[0].lookOnly).toEqual([]);
  });
  test("look parsing takes lists, ranges and words", () => {
    expect(lookSlides("3, 4, 5, 12")).toEqual([3, 4, 5, 12]);
    expect(lookSlides("slides 3-5 and 12")).toEqual([3, 4, 5, 12]);
    expect(lookSlides("none")).toEqual([]);
  });
});

// v4 tests: one block per bug in rootcause/checking-audit.json, from the audit's real slides.
const el = (name: string, text: string) => ({ name, text });
const slide = (
  n: number,
  kind: string,
  texts: { name: string; text: string }[],
  role = "teach",
): Slide => ({
  n,
  kind,
  role,
  texts,
  questions: [],
  pictures: [],
});

describe("N1/F1: a slide's role comes from what pupils do on it, not its kind", () => {
  test("a diagram whose only words are the task is a check (base4-3 y1 s10, base5-1 y2 s4, base4-3 y2 s4)", () => {
    for (const cap of [
      "Point from youngest to oldest. Say what changes.",
      "Is each shaded part one half or one quarter? Explain how you know.",
      "Say half or quarter for A and B. Explain why.",
    ])
      expect(
        objectivesRole(
          slide(4, "diagram", [el("Heading", "Name the shaded part"), el("Caption", cap)]),
        ),
      ).toBe("question");
  });
  test("tasks are read in every element: Caption, Lead, Prompt, Item (base5-1 y5 s4, y2 s7)", () => {
    expect(
      objectivesRole(slide(4, "diagram", [el("Caption", "Write the division and the answer.")])),
    ).toBe("question");
    expect(
      objectivesRole(
        slide(7, "diagram", [
          el("Heading", "Find half of 14"),
          el(
            "Caption",
            "Draw two groups. Share these counters equally. How many are in one group?",
          ),
        ]),
      ),
    ).toBe("question");
    expect(
      objectivesRole(
        slide(5, "content", [el("Lead", "Tell your partner two ways it will change.")]),
      ),
    ).toBe("question");
  });
  test("a slide that states content as well as a task still teaches (base5-1 y2 s6, y5 s9, y8 s7)", () => {
    expect(
      objectivesRole(
        slide(6, "diagram", [
          el("Heading", "Find half of 10"),
          el("Lead", "Share 10 counters into two equal groups."),
          el("Point", "Each group has 5 counters."),
          el("Point", "One half of 10 is 5."),
        ]),
      ),
    ).toBe("teach");
    expect(
      objectivesRole(
        slide(9, "diagram", [
          el("Lead", "Aisha has £24. She spends ¾ of it. How much does she spend?"),
          el("Point", "Aisha spends £18."),
        ]),
      ),
    ).toBe("teach");
    expect(
      objectivesRole(
        slide(4, "content", [
          el("Label", "Cow → calf"),
          el("Text", "A calf is a young cow. Point to the cow, then the calf."),
        ]),
      ),
    ).toBe("teach");
    expect(
      objectivesRole(
        slide(3, "diagram", [
          el("Caption", "Compare the stores. Which holds the least information?"),
        ]),
      ),
    ).toBe("teach");
  });
  test("a reading cue under a table teaches (base5-1 y12 s4), and a heading question is a title (base4-3 y8 s5)", () => {
    expect(
      objectivesRole(
        slide(4, "diagram", [
          el("Heading", "Three stores, different properties"),
          el(
            "Caption",
            "Compare how each store codes information, how much it holds and how long it lasts.",
          ),
        ]),
      ),
    ).toBe("teach");
    expect(objectivesRole(slide(5, "content", [el("Heading", "Mon ou ma ? / Which one?")]))).toBe(
      "teach",
    );
  });
  test("discussion sits behind DISCUSSION_COUNTS_AS_CHECK, default false (base4-3 y1 s12)", () => {
    expect(DISCUSSION_COUNTS_AS_CHECK).toBe(false);
    const s12 = slide(12, "discussion", [
      el("Lead", "This young bird is not fully grown. Tell your partner two ways it will change."),
    ]);
    expect(objectivesRole(s12)).toBe("teach");
  });
  test("question kinds and title/objectives slides keep deck.py's role", () => {
    expect(
      objectivesRole(slide(7, "open-response", [el("Heading", "Calculate")], "question")),
    ).toBe("question");
    expect(objectivesRole(slide(1, "title", [el("Heading", "Rates")], "title"))).toBe("title");
  });
  test("a diagram check is counted, and a practice diagram is no longer cited as taught (base4-3 y1 o2)", () => {
    const deck = {
      objectives: [{ id: "o2", text: "Describe how a chick changes as it grows." }],
      slides: [
        slide(9, "image-text", [
          el("Heading", "A chick grows into a hen"),
          el("Caption", "Small and fluffy"),
        ]),
        slide(10, "diagram", [
          el("Heading", "Put them in order"),
          el("Caption", "Point from youngest to oldest. Say what changes."),
        ]),
      ],
    };
    const [o2] = summariseObjectives(deck, {
      objectives: [
        {
          id: "o2",
          look: "9, 10",
          taught: [
            { slide: 9, quote: "Small and fluffy" },
            { slide: 10, quote: "Point from youngest to oldest." },
          ],
          checked: [{ slide: 10, quote: "Point from youngest to oldest. Say what changes." }],
        },
      ],
    });
    expect(o2.taught).toEqual([9]);
    expect(o2.checked).toEqual([10]);
  });
});

describe("F2: a near-verbatim quote matches by in-order token coverage", () => {
  const s7 =
    "Calculate the mean rate\nA reaction produces 0 cm³ at 0 s and 80 cm³ at 40 s. Calculate its mean rate over these 40 seconds.";
  test("heading joined to an item (base4-3 y11 s7) passes; exact match is tried first", () => {
    expect(matchQuote("Calculate the mean rate over these 40 seconds.", [s7])).toBe("fuzzy");
    expect(matchQuote("Calculate its mean rate over these 40 seconds.", [s7])).toBe("exact");
  });
  test("a dropped gloss in brackets (y8 French s6) passes", () => {
    const t = "Il s’appelle Hugo. (His name is Hugo.) Il a douze ans.";
    expect(stripGlosses(t)).not.toContain("His name");
    expect(matchQuote("Il s’appelle Hugo. Il a douze ans.", [t])).toBe("fuzzy");
  });
  test("a quote from another slide, or one short paraphrase, fails", () => {
    expect(matchQuote("A lamb is a young sheep that eats grass.", [s7])).toBeNull();
    expect(matchQuote("mean rate", ["rate of the mean"])).toBeNull();
    expect(inOrderCoverage("one two three four five", "one two three")).toBe(0.6);
  });
});

describe("N3: a quote that reads one column of a table matches", () => {
  // base5-1 y8 s3: the table's cells reach the model row by row; the model quoted the French column.
  const labels = [
    "French family phrases paired with English meanings.",
    "Français",
    "English",
    "mon père",
    "father",
    "ma mère",
    "mother",
    "mon frère",
    "brother",
    "ma sœur",
    "sister",
    "mes parents",
    "parents",
  ];
  const s3: Slide = {
    n: 3,
    kind: "diagram",
    role: "teach",
    texts: [{ name: "Lead", text: "Écoute et répète. Listen and repeat." }],
    questions: [],
    pictures: [{ kind: "diagram", alt: labels[0], labels, background: false }],
  };
  test("v3's 8-word prefix failed it; v4 verifies it", () => {
    const quote = "mon père; ma mère; mon frère; ma sœur; mes parents";
    expect(norm(objectivesSlideText(s3)).includes(norm(quote))).toBe(false);
    expect(verifyCite({ 3: s3 }, { slide: 3, quote }, "teach")).toBe(true);
  });
  test("cells are read column-wise as well as row-wise", () => {
    expect(columnReadings(["a", "1", "b", "2"])).toContain("a b");
    expect(columnReadings(["a", "1", "b", "2"])).toContain("1 2");
  });
});

describe("F5: a check before any teaching of its objective does not count", () => {
  // R7T y12: o1 checked only by starter s3; the first teaching slide is s4.
  const deck = {
    objectives: [{ id: "o1", text: "Describe the coding, capacity and duration of each store." }],
    slides: [
      slide(
        3,
        "starter",
        [el("Item", "Which store has modality-specific coding and a very large capacity?")],
        "question",
      ),
      slide(4, "diagram", [el("Point", "STM: mainly acoustic, 7 ± 2 items, 18–30 seconds.")]),
      slide(7, "open-response", [el("Item", "State the capacity of STM.")], "question"),
    ],
  };
  test("the starter is reported as early, not checked", () => {
    const [o1] = summariseObjectives(deck, {
      objectives: [
        {
          id: "o1",
          look: "3, 4",
          taught: [{ slide: 4, quote: "STM: mainly acoustic, 7 ± 2 items" }],
          checked: [
            {
              slide: 3,
              quote: "Which store has modality-specific coding and a very large capacity?",
            },
          ],
        },
      ],
    });
    expect(o1.checked).toEqual([]);
    expect(o1.early).toEqual([3]);
  });
  test("a check after the teaching still counts", () => {
    const [o1] = summariseObjectives(deck, {
      objectives: [
        {
          id: "o1",
          look: "4, 7",
          taught: [{ slide: 4, quote: "STM: mainly acoustic, 7 ± 2 items" }],
          checked: [{ slide: 7, quote: "State the capacity of STM." }],
        },
      ],
    });
    expect(o1.checked).toEqual([7]);
  });
});
