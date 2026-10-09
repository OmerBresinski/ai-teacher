import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetExceeded } from "../types";
import { writerBundle } from "./bundle";
import { type Brief, fillTemplate, pupilWordLimit } from "./fixes";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import type { ChatReq, WriterServices } from "./services";
import { PUPIL_WORDING_DEADLINE_MS, runWriter } from "./stage";

/*
 * TEACH-110 part f (Greg): the pupil-wording call starts with the writer, once the objectives are
 * confirmed, and slide 2 is laid with its lines before editable. Slide 2 never changes after the
 * lesson is editable. A failed or late call keeps the teacher's wording; a budget or abort error
 * still stops the lesson.
 */

const B = "y5-maths-fractions-of-amounts";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const objectives = (
  read("objectives.json") as { objectives: { teacher: string }[] }
).objectives.map((o) => o.teacher);
const PUPIL = objectives.map((_, k) => `We can do thing ${k + 1}.`);

/** Slide 2's text, as the deck shows it. */
const slide2Text = (slides: { elements: unknown[] }[]) => JSON.stringify(slides[1]?.elements ?? []);

function run(pupil: (r: ChatReq) => Promise<unknown>) {
  const events: string[] = [];
  const replay = replayServices(B);
  let pupilReq: ChatReq | undefined;
  const services: WriterServices = {
    ...replay,
    chat: async (r) => {
      if (r.name !== "pupil_objectives") return replay.chat(r);
      pupilReq = r;
      events.push("pupil-start");
      return { out: await pupil(r), usd: 0, ms: 0 };
    },
    writer: async () => {
      events.push("writer-start");
      // The writer takes a while; the pupil call is already running.
      await new Promise((r) => setTimeout(r, 20));
      events.push("writer-done");
      return {
        text: (read("main.json") as { text: string }).text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      };
    },
  };
  let editable = "";
  const out = runWriter({
    brief: read("brief.json") as Brief,
    objectives,
    services,
    visual: recordedVisuals(B),
    placeMore: recordedVisuals(B).placeMore,
    held: recordedHeld(B),
    onEditable: (slides) => {
      events.push("editable");
      editable = slide2Text(slides as never);
    },
  });
  return { out, events, editable: () => editable, pupilReq: () => pupilReq };
}

describe("pupil wording", () => {
  test("starts with the writer and is on slide 2 at editable, unchanged after", async () => {
    const r = run(async () => ({ pupil: PUPIL }));
    const out = await r.out;
    expect(r.events.indexOf("pupil-start")).toBeLessThan(r.events.indexOf("writer-done"));
    expect(r.pupilReq()?.timeoutMs).toBe(PUPIL_WORDING_DEADLINE_MS);
    for (const line of PUPIL) expect(r.editable()).toContain(line);
    expect(slide2Text(out.slides as never)).toBe(r.editable());
  });

  test("a failed or timed-out call keeps the teacher's wording", async () => {
    const r = run(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const out = await r.out;
    for (const line of PUPIL) expect(r.editable()).not.toContain(line);
    expect(r.editable()).toContain(objectives[0]?.slice(0, 20) as string);
    expect(slide2Text(out.slides as never)).toBe(r.editable());
  });

  test("a budget stop on the pupil call stops the lesson", async () => {
    const r = run(async () => {
      throw new BudgetExceeded("usd");
    });
    await expect(r.out).rejects.toBeInstanceOf(BudgetExceeded);
    expect(r.events).not.toContain("editable");
  });
});

describe("pupilWordLimit (WRITER-FIX-PLAN fault 1)", () => {
  // A reading target per stage, capped by the slide's room: 2 / 3 / 4 objectives.
  const table: [Brief["keyStage"], number[]][] = [
    ["ks1", [8, 8, 7]],
    ["ks2", [12, 12, 9]],
    ["ks3", [15, 15, 10]],
    ["ks4", [15, 15, 10]],
    ["ks5", [15, 15, 10]],
  ];
  for (const [stage, limits] of table)
    test(`${stage}: ${limits.join(" / ")}`, () => {
      expect([2, 3, 4].map((n) => pupilWordLimit(stage, n))).toEqual(limits);
    });
  test("an objective count with no measured room takes the reading target", () => {
    expect(pupilWordLimit("ks1", 1)).toBe(8);
    expect(pupilWordLimit("ks2", 5)).toBe(12);
    expect(pupilWordLimit("ks4", 1)).toBe(15);
  });
  test("the user turn prints the capped limit", () => {
    const brief = { yearGroup: "Year 1", keyStage: "ks1", subject: "Science" } as Brief;
    const u = fillTemplate(writerBundle().pupilObjectivesUser, brief, {
      objectives: [
        { teacher: "a", pupil: "" },
        { teacher: "b", pupil: "" },
      ],
      maxWords: pupilWordLimit("ks1", 2),
    });
    expect(u).toContain("Word limit per line: 8\n");
  });
});
