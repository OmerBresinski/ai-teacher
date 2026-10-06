import { expect, test } from "bun:test";
import { renderWritten } from "./fit";
import { adapt, fromTeacher3 } from "./simple";

// CANDIDATE y9 s9: an open response set in parts floated with no heading; the writer's heading
// now reaches the slide spec.
test("an open response carries the writer's heading to its spec (y9 s9)", () => {
  const [light] = fromTeacher3([], {
    titlePicture: null,
    slides: [
      {
        objectives: [],
        form: "open-response",
        heading: "9. Independent practice: explain the crisis",
        content: ["Write one paragraph independently."],
        questions: [
          {
            question:
              "How did Germany’s hyperinflation develop, why did its effects differ, and how was it brought under control?",
            answer: "A model paragraph.",
          },
        ],
        picture: null,
        notes: "",
      },
    ],
  } as never).slides;
  const a = adapt(light as never);
  const r = renderWritten(a.form, a.layout, a.out);
  expect(r.spec.kind).toBe("open-response");
  expect((r.spec as { heading?: string }).heading).toBe("Independent practice: explain the crisis");
});

// CANDIDATE y1 s9: a one-question open response showed its question alone; the writer's heading
// and its task lines (draw, label, tell) were dropped by code.
test("a one-question open response carries the writer's heading and task lines (y1 s9)", () => {
  const [light] = fromTeacher3([], {
    titlePicture: null,
    slides: [
      {
        objectives: [1],
        form: "open-response",
        heading: "Try it on your own",
        content: [
          "Draw a chick and an adult hen.",
          "Label them: chick, hen.",
          "Tell or write what changes.",
        ],
        questions: [
          {
            question: "How does a chick change as it grows into a hen?",
            answer: "It gets bigger and grows feathers.",
          },
        ],
        picture: null,
        notes: "",
      },
    ],
  } as never).slides;
  const a = adapt(light as never);
  const r = renderWritten(a.form, a.layout, a.out);
  const spec = r.spec as { heading?: string; stem?: string; task?: string[] };
  expect(spec.heading).toBe("Try it on your own");
  expect(spec.stem).toBe("How does a chick change as it grows into a hen?");
  expect(spec.task).toEqual([
    "Draw a chick and an adult hen.",
    "Label them: chick, hen.",
    "Tell or write what changes.",
  ]);
});

// FULL-RUN y5 s9/s10: the writer numbered its questions ("1. Find ⅙ of 54 stickers."), and the
// plain list numbered them again ("1  1. Find …").
test("a set's questions lose a number the writer wrote, so the list numbers them once", () => {
  const r = renderWritten("check-set", "default", {
    questions: [
      { question: "1. Find ⅙ of 54 stickers.", answer: "9" },
      { question: "2) What is ⅝ of 48 kg?", answer: "30 kg" },
      { question: "10 sweets are shared. How many each?", answer: "5" },
    ],
    notes: "",
  });
  expect((r.spec as { items?: string[] }).items).toEqual([
    "Find ⅙ of 54 stickers.",
    "What is ⅝ of 48 kg?",
    "10 sweets are shared. How many each?",
  ]);
});

// FULL-RUN y5 s6/s8: a worked example's "Your turn" question was dropped by code while the notes
// told pupils to answer it.
test("a worked example keeps its your-turn question on the slide, its answer in the notes", () => {
  const [light] = fromTeacher3([], {
    titlePicture: null,
    slides: [
      {
        objectives: [1],
        form: "worked-example",
        heading: "Fractions of measures",
        content: ["One eighth: 40 ÷ 8 = 5 cm.", "Three eighths: 5 × 3 = 15 cm."],
        questions: [
          { question: "What is ⅜ of a 40 cm ribbon?", answer: "15 cm." },
          { question: "Your turn: A jug holds 35 litres. What is ⅖ of it?", answer: "14 litres." },
        ],
        picture: null,
        notes: "Pupils answer the jug question.",
      },
    ],
  } as never).slides;
  const a = adapt(light as never);
  const steps = (a.out as { steps?: string[] }).steps ?? [];
  expect(steps[steps.length - 1]).toBe("Your turn: A jug holds 35 litres. What is ⅖ of it?");
  expect(String((a.out as { notes?: string }).notes)).toContain("14 litres.");
});
