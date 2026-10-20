import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai/testing";
import { labAi, romansLesson } from "../planner/testing";
import { initialState, recordingDeps, writerFixture } from "../testing";
import { WRITER_VERSION, writerRoute } from "../writer/ai-services";
import { OVERFLOW_CHECK } from "../writer/overflow-findings";
import { checkedWriterObjectives } from "./objectives";
import { write } from "./write";

/*
 * UX-C J8: the recorded y5 writer output through the production write stage (checks only log, so
 * no fit repair runs; every other call answered as the local fake answers it). Slide 9, the
 * equation-hero whose steps run off the slide, is saved with a "things to check" finding.
 */

const fixture = writerFixture();
const answers = (call: FakeCall) => {
  const v = call.context?.promptVersion ?? "";
  if (!v.startsWith(`${WRITER_VERSION}/`)) return undefined;
  if (v.endsWith("/lesson")) return { text: fixture.main };
  if (v.endsWith("/notes")) return fixture.notes;
  if (v.endsWith("/objectives"))
    return JSON.stringify({
      objectives: [
        "Describe who invaded Britain in AD 43.",
        "Explain why the Romans invaded Britain.",
        "Evaluate how far the invasion changed Britain.",
      ],
    });
  if (v.endsWith("/pupil_objectives")) return JSON.stringify({ pupil: ["a", "b", "c"] });
  return "{}";
};

describe("a slide the writer stage could not fit", () => {
  test("is saved with a things-to-check finding on it", async () => {
    const ai = () => labAi({ extra: answers, route: writerRoute });
    const planned = await checkedWriterObjectives(
      initialState(romansLesson()),
      recordingDeps(ai()),
    );
    const deps = recordingDeps(ai());
    const out = await write(planned, deps);
    const saved = deps.persisted.at(-1)?.lesson;
    const s9 = saved?.slides.find((s) => s.id === "s9");
    expect(JSON.stringify(s9)).toContain("Mia spends £12.");
    const flagged = (saved?.generation?.findings ?? []).filter((f) => f.check === OVERFLOW_CHECK);
    expect(flagged.map((f) => f.target.slideId)).toContain("s9");
    for (const f of flagged) {
      expect(f.severity).toBe("warning");
      expect(saved?.slides.some((s) => s.id === f.target.slideId)).toBe(true);
    }
    expect(out.lesson.generation?.findings).toEqual(saved?.generation?.findings ?? []);
  });
});
