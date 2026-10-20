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
 * equation-hero whose steps ran off the slide, is saved split onto a continuation (Greg 70 B),
 * with no finding; a slide that cannot split is saved with one (71 A).
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

const runWrite = async (main = fixture.main) => {
  const ai = () =>
    labAi({
      extra: (call) => {
        const v = call.context?.promptVersion ?? "";
        return v.endsWith("/lesson") && v.startsWith(`${WRITER_VERSION}/`)
          ? { text: main }
          : answers(call);
      },
      route: writerRoute,
    });
  const planned = await checkedWriterObjectives(initialState(romansLesson()), recordingDeps(ai()));
  const deps = recordingDeps(ai());
  const out = await write(planned, deps);
  return { out, saved: deps.persisted.at(-1)?.lesson };
};

describe("the production write stage", () => {
  test("saves an off-slide slide split onto a continuation, in order, with no finding", async () => {
    const { out, saved } = await runWrite();
    const ids = (saved?.slides ?? []).map((s) => s.id);
    expect(ids.indexOf("s9c1")).toBe(ids.indexOf("s9") + 1);
    const both = JSON.stringify(saved?.slides.filter((s) => s.id === "s9" || s.id === "s9c1"));
    expect(both.indexOf("Mia has £30.")).toBeLessThan(both.indexOf("Mia spends £12."));
    expect(saved?.generation?.slideStates?.s9c1).toBe("done");
    expect((saved?.generation?.findings ?? []).filter((f) => f.check === OVERFLOW_CHECK)).toEqual(
      [],
    );
    expect(out.lesson.slides.map((s) => s.id)).toEqual(ids);
  });

  test("saves a slide that cannot split with a things-to-check finding on it", async () => {
    const main = JSON.parse(fixture.main);
    main.slides[6].points = [
      Array(12).fill("One fifth: £30 ÷ 5 = £6 and then two fifths.").join(" "),
    ];
    const { saved } = await runWrite(JSON.stringify(main));
    const flagged = (saved?.generation?.findings ?? []).filter((f) => f.check === OVERFLOW_CHECK);
    expect(flagged.map((f) => f.target.slideId)).toEqual(["s9"]);
    expect(flagged[0]?.severity).toBe("warning");
  });
});
