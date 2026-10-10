import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai/testing";
import { labAi, romansLesson } from "../planner/testing";
import { initialState, recordingDeps, writerFixture } from "../testing";
import { WRITER_VERSION, writerRoute } from "../writer/ai-services";
import { checkedWriterObjectives } from "./objectives";
import { write } from "./write";

/*
 * TEACH-110 part h: any failure while the writer streams (here a cancel; K3, a budget stop and
 * other throws take the same path) rolls the slides it showed `writing` back to the plan, and no
 * streamed save lands after it.
 */

const fixture = writerFixture();
const answers = (call: FakeCall) => {
  const v = call.context?.promptVersion ?? "";
  if (!v.startsWith(`${WRITER_VERSION}/`)) return undefined;
  if (v.endsWith("/lesson")) return { text: fixture.main, stream: { pieceChars: 120, paceMs: 15 } };
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

describe("a failure while the writer streams", () => {
  test("rolls the streamed slides back to the plan; nothing streamed lands after it", async () => {
    const ai = () => labAi({ extra: answers, route: writerRoute });
    const planned = await checkedWriterObjectives(
      initialState(romansLesson()),
      recordingDeps(ai()),
    );
    // The job is cancelled as soon as the first streamed slide is saved.
    const deps = recordingDeps(ai(), { abortAfterPersist: 1 });
    await expect(write(planned, deps)).rejects.toBeDefined();
    await new Promise((r) => setTimeout(r, 1200));
    const first = deps.persisted[0]?.lesson;
    const last = deps.persisted.at(-1)?.lesson;
    expect(Object.values(first?.generation?.slideStates ?? {})).toContain("writing");
    expect(last?.slides.map((s) => s.kind)).toEqual(planned.lesson.slides.map((s) => s.kind));
    expect(last?.generation?.slideStates).toBeUndefined();
    expect(last?.generation?.stage).toBe("planned");
  });
});

describe("the lesson's title after a full write", () => {
  const run = async (title?: string) => {
    const ai = () => labAi({ extra: answers, route: writerRoute });
    const planned = await checkedWriterObjectives(
      initialState(romansLesson()),
      recordingDeps(ai()),
    );
    const lesson = title ? { ...planned.lesson, title } : planned.lesson;
    const deps = recordingDeps(ai());
    const out = await write({ ...planned, lesson }, deps);
    const heading = JSON.parse(fixture.main).title?.heading as string;
    return { before: planned.lesson, out, last: deps.persisted.at(-1)?.lesson, heading };
  };

  test("a title still from the brief becomes the title slide's heading", async () => {
    const { before, last, out, heading } = await run();
    expect(before.title).toBe(before.brief?.topic.trim().slice(0, 80) ?? "");
    expect(heading).toBeTruthy();
    expect(heading).not.toBe(before.title);
    expect(last?.title).toBe(heading.trim());
    expect(out.lesson.title).toBe(heading.trim());
  });

  test("a title the teacher changed is kept", async () => {
    const { last } = await run("Our Romans lesson");
    expect(last?.title).toBe("Our Romans lesson");
  });
});
