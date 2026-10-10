import { afterAll, describe, expect, test } from "bun:test";
import { libraryDiagram } from "./fill";
import { endDrawThread } from "./guard";

/*
 * TEACH-97 part h: a library drawing comes back with what it was drawn from (the model, the
 * checked params, the question slide's held-back step), which the writer puts on the slide's
 * image element so the settings panel (part g) can redraw it.
 */
afterAll(() => endDrawThread());

const ask = {
  key: "diagram",
  model: "equal_groups",
  intent: "Share sixteen counters between two rings.",
  words: "Find one half of 16",
  heading: "Find one half of 16",
  caption: "Share 16 counters into two equal groups.",
  yearGroup: "Year 2",
  lesson: "Maths: halves",
};
const fill = async () => ({ groups: 2, size: 8, division: "sharing" });

describe("libraryDiagram returns its source (TEACH-97 part h)", () => {
  test("a teaching slide: the model and its checked params, no step", async () => {
    const r = await libraryDiagram(ask, fill);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toEqual({ kind: "library", model: "equal_groups", params: r.params });
    expect(r.source.params).toMatchObject({ groups: 2, size: 8 });
  });

  test("a question slide: the step that holds the answer back is kept", async () => {
    const r = await libraryDiagram({ ...ask, question: true }, fill);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source.kind).toBe("library");
    expect(typeof r.source.step).toBe("number");
    expect(JSON.parse(JSON.stringify(r.source))).toEqual(r.source);
  });
});
