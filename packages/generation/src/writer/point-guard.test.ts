// D47: the D45 slides that kept a pointing task after their picture was lost (fault-ledger "D45 FULL RUNS" A).
import { describe, expect, test } from "bun:test";
import { FROM_MEMORY, pointTaskFault, stripPointTasks } from "./point-guard";

const qs = (questions: string[], instruction: string) => ({
  template: "question-set",
  heading: "h",
  questions,
  instruction,
});
const words = (s: Record<string, unknown>) =>
  [s.lead, s.instruction, ...((s.questions as string[]) ?? []), ...((s.points as string[]) ?? [])]
    .filter(Boolean)
    .join(" ");

const D45 = {
  "base7c y1 s7 Find the families": qs(
    ["Match each adult to its young.", "Name each adult.", "Name each young animal."],
    "Point and say.",
  ),
  "base7c y1 s10 Back to the hen": qs(
    [
      "Which young animal can grow into a hen?",
      "Name the other young animal.",
      "How will the chick change as it grows?",
    ],
    "Look: hen, yellow chick, small puppy. Point, name and explain.",
  ),
  "base7 y1 s6 Try a match": qs(
    [
      "Which young animal goes with the sheep?",
      "What is the young animal called?",
      "Say: A ___ is a young sheep.",
    ],
    "Look, choose and say.",
  ),
  "base7 y1 s11 Match the families": {
    ...qs(
      [
        "Match each adult to its young.",
        "Name each adult and its young.",
        "Say one whole animal-family sentence.",
      ],
      "Look and answer on your own.",
    ),
    template: "practice",
  },
  "base7c y2 s6 Name the shaded part": qs(
    [
      "What fraction of A is shaded?",
      "What fraction of B is shaded?",
      "What fraction of C is shaded?",
    ],
    "Say half or quarter.",
  ),
  "base7 y2 s5 Two parts: always halves?": {
    template: "visual-text",
    heading: "Two parts: always halves?",
    lead: "Two parts are halves only if they are equal.",
    points: [
      "The left square is split into two equal parts. One part is a half.",
      "The right square is split into unequal parts, so neither part is a half.",
    ],
  },
};

describe("pointGuard (D47) on the D45 slides", () => {
  for (const [name, s] of Object.entries(D45))
    test(`${name}: flagged before, nothing points after`, () => {
      expect(pointTaskFault(words(s))).toBeDefined();
      const { slide, removed } = stripPointTasks(s);
      expect(removed.length).toBeGreaterThan(0);
      expect(pointTaskFault(words(slide))).toBeUndefined();
      expect(slide.heading).toBe(s.heading);
    });
  test("a task left on a question slide says answer from memory; picture-free tasks are kept", () => {
    const { slide } = stripPointTasks(D45["base7c y1 s7 Find the families"]);
    expect(slide.instruction).toBe(FROM_MEMORY);
    expect(slide.questions).toEqual([
      "Match each adult to its young.",
      "Name each adult.",
      "Name each young animal.",
    ]);
    const ten = stripPointTasks(D45["base7c y1 s10 Back to the hen"]).slide;
    expect(ten.instruction).toBe(FROM_MEMORY);
  });
  test("questions about lettered shapes go; a slide with no pointing is untouched", () => {
    const { slide } = stripPointTasks(D45["base7c y2 s6 Name the shaded part"]);
    expect(slide.questions).toEqual([]);
    const plain = qs(["How will the chick change as it grows?"], "Answer in full sentences.");
    expect(stripPointTasks(plain).slide).toBe(plain);
    expect(pointTaskFault("Which young animal goes with the sheep?")).toBeUndefined();
  });
});

// v4.18c Gate B (TEACH-247 part bl): two false "dangling" hits, and the true one that must stay.
describe("pointGuard: algebra's left side and noun points are not pointing tasks", () => {
  test("Equations hinge option: 'the left side is 9' is algebra", () => {
    expect(pointTaskFault("Subtract 3 from both sides, so the left side is 9.")).toBeUndefined();
  });
  test("Romans lead: 'guarded crossing points' is a noun", () => {
    // The slide 13 lead as written (Romans r2).
    expect(
      pointTaskFault(
        "The Wall joined guarded crossing points and places where soldiers watched and lived along the frontier.",
      ),
    ).toBeUndefined();
    expect(pointTaskFault("Soldiers guarded the crossing points, day and night.")).toBeUndefined();
    expect(pointTaskFault("The main point is that the fire spread fast.")).toBeUndefined();
  });
  test("a real pointing task still fires", () => {
    expect(pointTaskFault("Point to the gate in the wall.")).toBeDefined();
    expect(pointTaskFault("Now point at the river. Which way does it flow?")).toBeDefined();
    expect(pointTaskFault("Which is bigger? Point and say.")).toBeDefined();
    expect(pointTaskFault("Now point and say its name.")).toBeDefined();
    expect(pointTaskFault("Look at the right picture.")).toBeDefined();
  });
});
