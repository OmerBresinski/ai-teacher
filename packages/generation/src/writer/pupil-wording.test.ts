import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetExceeded } from "../types";
import type { Brief } from "./fixes";
import {
  fillTemplate,
  fitObjectives,
  pupilCharLimit,
  pupilLinesProblem,
  shortenObjective,
} from "./fixes";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import type { ChatReq, WriterServices } from "./services";
import { PUPIL_WORDING_DEADLINE_MS, pupilFallback, runWriter } from "./stage";

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

/*
 * TEACH-110 part an (lesson 1, 25 Oct 2026): the pupil call returned five lines for three
 * objectives and slide 2 matched them by position, so objective 3 showed objective 2's words.
 * The schema is pinned to one line per objective, the lines are checked against the slide's
 * measured room, one re-ask follows a failed check, then the teacher's wording.
 */
describe("pupil lines are checked", () => {
  const FIVE = [
    "Name the parts.",
    "Describe how roots take in water.",
    "Describe how stems hold plants up.",
    "Describe how leaves make food.",
    "Describe how flowers make seeds.",
  ];

  test("the schema asks for exactly one line per objective, and the room in characters", async () => {
    const r = run(async () => ({ pupil: PUPIL }));
    await r.out;
    const schema = r.pupilReq()?.schema as {
      properties: { pupil: { minItems: number; maxItems: number } };
    };
    expect(schema.properties.pupil.minItems).toBe(objectives.length);
    expect(schema.properties.pupil.maxItems).toBe(objectives.length);
  });

  test("a wrong count is asked again once; a good second answer is shown", async () => {
    let calls = 0;
    const r = run(async () => (++calls === 1 ? { pupil: FIVE } : { pupil: PUPIL }));
    await r.out;
    expect(calls).toBe(2);
    for (const line of PUPIL) expect(r.editable()).toContain(line);
    expect(r.editable()).not.toContain("flowers make seeds");
  });

  test("a wrong count twice: every line is the teacher's wording, none of the model's", async () => {
    let calls = 0;
    const r = run(async () => {
      calls++;
      return { pupil: FIVE };
    });
    const out = await r.out;
    expect(calls).toBe(2);
    for (const line of FIVE) expect(r.editable()).not.toContain(line);
    expect(r.editable()).toContain("Calculate unit fractions");
    expect(slide2Text(out.slides as never)).toBe(r.editable());
  });

  test("a line over the room is asked again, then that line alone falls back", async () => {
    const long = `${"Work out a fraction of a whole number amount ".repeat(4).trim()}.`;
    const r = run(async () => ({ pupil: [PUPIL[0], long, PUPIL[2]] }));
    await r.out;
    expect(r.editable()).toContain(PUPIL[0] as string);
    expect(r.editable()).toContain(PUPIL[2] as string);
    expect(r.editable()).not.toContain(long);
    expect(r.editable()).toContain("Calculate non-unit fractions");
  });
});

describe("pupil line helpers", () => {
  test("pupilLinesProblem: count, empty, characters and words", () => {
    expect(
      pupilLinesProblem(["Name the parts.", "Say what roots do.", "Say what leaves do."], 3, "ks1"),
    ).toBeUndefined();
    expect(pupilLinesProblem(["a", "b", "c", "d", "e"], 3, "ks1")).toBe("5 lines for 3 objectives");
    expect(pupilLinesProblem(["a", " ", "c"], 3, "ks1")).toBe("line 2 is empty");
    const room = pupilCharLimit("ks1", 3);
    expect(pupilLinesProblem(["a", "b", "x".repeat(room + 1)], 3, "ks1")).toBe(
      `line 3 is ${room + 1} characters, room ${room}`,
    );
  });

  test("shortenObjective cuts whole clauses, then whole words, never mid-word", () => {
    const o2 =
      "Describe how roots take in water and hold the plant in place, and how the stem holds it up and carries water.";
    expect(shortenObjective(o2, 200)).toBe(o2);
    expect(shortenObjective(o2, 70)).toBe(
      "Describe how roots take in water and hold the plant in place.",
    );
    expect(shortenObjective(o2, 40)).toBe("Describe how roots take in water.");
    const cut = shortenObjective("Identify and name the roots stem leaves flowers fruit seeds", 30);
    expect(cut.length).toBeLessThanOrEqual(30);
    expect(cut).toMatch(/^Identify and name the [a-z ]+\.$/);
    expect(cut).not.toMatch(/\b(and|the)\.$/);
  });

  test("fitObjectives shortens the longest line until the slide holds them", () => {
    const fits = (ls: string[]) => ls.every((l) => l.length <= 50);
    const out = fitObjectives(
      [
        "Short one.",
        "Describe how roots take in water and hold the plant in place, and how the stem carries water.",
      ],
      fits,
    );
    expect(out[0]).toBe("Short one.");
    expect(fits(out)).toBe(true);
  });

  test("pupilFallback keeps good lines only when the count is right", () => {
    const teacher = [
      "Name the roots, stem, leaves and flowers of a plant.",
      "Say what roots do for a plant.",
      "Say what leaves do.",
    ];
    expect(pupilFallback(["Name the parts.", "x ".repeat(40), "Leaves."], teacher, "ks1")).toEqual([
      "Name the parts.",
      "Say what roots do for a plant.",
      "Leaves.",
    ]);
    expect(pupilFallback(["a", "b", "c", "d"], teacher, "ks1")[0]).toBe(
      shortenObjective(teacher[0] as string, pupilCharLimit("ks1", 3)),
    );
  });

  test('an extra fills a {{x ?? "d"}} token before the brief does', () => {
    const b = { subject: "Science" } as unknown as Brief;
    expect(fillTemplate('Room: {{maxChars ?? "about 40"}}', b, { maxChars: 44 })).toBe("Room: 44");
    expect(fillTemplate('Room: {{maxChars ?? "about 40"}}', b)).toBe("Room: about 40");
  });
});
