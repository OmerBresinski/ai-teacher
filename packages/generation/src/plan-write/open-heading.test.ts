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
