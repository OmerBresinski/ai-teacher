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
