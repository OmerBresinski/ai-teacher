import { describe, expect, test } from "bun:test";
import type { Lesson, Slide, SlideElement } from "@tj/domain/documents";
import { walkElements } from "@tj/domain/documents";
import { docFromText } from "../factories";
import { availableTypes, lessonDigest, misconceptionsOf } from "./digest";
import halves from "./fixtures/y2-halves.json";
import romans from "./fixtures/y4-romans.json";
import rivers from "./fixtures/y9-rivers.json";
import rates from "./fixtures/y11-rates.json";

/*
 * T5 (worksheets plan v2 §6): the digest of four lessons recorded on 9 Nov with the current writer
 * (`tools/genlab/runs/20261109-*-s3base`, `debug.json` → `lesson.slides`). The recordings carry no
 * subject or facts, so each fixture names its subject and year by hand.
 */

type Fixture = { title: string; subject: string; yearGroup: string; slides: unknown[] };

function lessonOf(f: Fixture, extra: Partial<Lesson> = {}): Lesson {
  return {
    version: 1,
    id: "fixture",
    title: f.title,
    themeId: "studio",
    slides: structuredClone(f.slides) as Slide[],
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    subject: f.subject,
    yearGroup: f.yearGroup,
    ...extra,
  } as Lesson;
}

const FIXTURES = { halves, romans, rivers, rates } as Record<string, Fixture>;

function elementById(lesson: Lesson, id: string): SlideElement {
  const found: SlideElement[] = [];
  for (const s of lesson.slides)
    walkElements(s.elements, (e) => {
      if (e.id === id) found.push(e);
    });
  const el = found[0];
  if (!el) throw new Error(`no element ${id}`);
  return el;
}

function retext(lesson: Lesson, id: string, text: string) {
  (elementById(lesson, id) as { doc: unknown }).doc = docFromText(text);
}

describe("lessonDigest on the recorded lessons", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    test(`${name}: snapshot`, () => {
      const digest = lessonDigest(lessonOf(f));
      expect(digest).toMatchSnapshot();
      expect(availableTypes(digest)).toMatchSnapshot();
    });
  }

  test("rivers: 3 objectives, 1 multiple choice keyed on the inner bank, 8 named items", () => {
    const d = lessonDigest(lessonOf(rivers as Fixture));
    expect(d.lesson).toMatchObject({ subject: "Geography", yearGroup: "Year 9", keyStage: "KS3" });
    expect(d.objectives).toHaveLength(3);
    const mc = d.asked.filter((a) => a.kind === "mc");
    expect(mc).toHaveLength(1);
    expect(mc[0]?.answer).toStartWith("On the inner bank");
    expect(mc[0]?.options).toHaveLength(3);
    expect(mc[0]?.options).toContain(mc[0]?.answer as string);
    const items = d.taught.flatMap((t) => t.namedItems ?? []);
    expect(items).toHaveLength(8);
    expect(items.map((i) => i.name)).toEqual(
      expect.arrayContaining(["Hydraulic action", "Abrasion", "Attrition", "Solution"]),
    );
    expect(d.terms).toHaveLength(8);
    expect(d.terms.find((t) => t.term === "Abrasion")?.slide).toBe(3);
  });

  test("rivers: practice and exit items each carry a question and an answer", () => {
    const d = lessonDigest(lessonOf(rivers as Fixture));
    const practice = d.asked.filter((a) => a.kind === "practice");
    const exit = d.asked.filter((a) => a.kind === "exit");
    expect(practice.length).toBeGreaterThanOrEqual(3);
    expect(exit).toHaveLength(3);
    for (const a of [...practice, ...exit]) {
      expect(a.question.trim()).not.toBe("");
      expect(a.answer.trim()).not.toBe("");
    }
    expect(practice[0]).toMatchObject({ slide: 8, answer: "Abrasion" });
    expect(exit[1]?.question).toStartWith("Why does sediment collect on the inner bank");
    expect(d.misconceptions?.length).toBeGreaterThan(0);
    expect(availableTypes(d).every((t) => t.available)).toBe(true);
  });

  test("rates: the worked example's rows, with the substitution and the result", () => {
    const d = lessonDigest(lessonOf(rates as Fixture));
    const worked = d.taught.find((t) => t.slide === 4)?.worked ?? [];
    expect(worked).toEqual([
      "Write the mean rate formula: Mean rate = gas volume ÷ time",
      "Substitute the measured values: Mean rate = 48 cm³ ÷ 24 s",
      "Calculate the rate: Mean rate = 2 cm³/s",
    ]);
    // The plan's "Mean rate = 48 cm³ ÷ 24 s = 2 cm³/s" is these two rows in a row.
    expect(worked.slice(1).map((w) => w.split(": ")[1])).toEqual([
      "Mean rate = 48 cm³ ÷ 24 s",
      "Mean rate = 2 cm³/s",
    ]);
    const exit = d.asked.filter((a) => a.kind === "exit");
    expect(exit[0]).toMatchObject({ answer: "3 cm³/s", working: "45 cm³ ÷ 15 s = 3 cm³/s" });
    expect(d.lesson.keyStage).toBe("KS4");
    expect(availableTypes(d).map((t) => t.type)).toContain("exam-style");
  });

  test("halves: no named items, so Key words is greyed with its reason", () => {
    const d = lessonDigest(lessonOf(halves as Fixture));
    expect(d.taught.flatMap((t) => t.namedItems ?? [])).toHaveLength(0);
    expect(d.terms).toHaveLength(0);
    const kw = availableTypes(d).find((t) => t.type === "key-words");
    expect(kw).toEqual({
      type: "key-words",
      available: false,
      reason: "This lesson doesn't have enough key words for a sheet",
    });
    expect(availableTypes(d).find((t) => t.type === "exit-ticket")?.available).toBe(true);
    expect(availableTypes(d).map((t) => t.type)).not.toContain("exam-style");
    expect(d.asked.filter((a) => a.kind === "mc")).toHaveLength(2);
  });

  test("romans: items-row names and the question-set's Question lines are read", () => {
    const d = lessonDigest(lessonOf(romans as Fixture));
    expect(d.terms.map((t) => t.term)).toEqual(["Forts", "Milecastles", "Gates"]);
    const s10 = d.asked.filter((a) => a.slide === 10);
    expect(s10.map((a) => a.answer)).toEqual(["A fort", "A milecastle", "A gate"]);
    expect(s10[0]?.question).toStartWith("Where could soldiers live");
  });

  test("a teacher-edited slide is read as edited", () => {
    const lesson = lessonOf(rivers as Fixture);
    retext(lesson, "d-s6-Option_text-2", "On the inside of the bend, where water slows.");
    retext(lesson, "d-s3-layout:rows.0.name", "Hydraulic force");
    retext(lesson, "d-s8-Task-0", "Pebbles scrape a river bed. Name the process.");
    retext(lesson, "d-s2-layout:points.0", "Name four ways a river erodes its channel.");
    const d = lessonDigest(lesson);
    expect(d.asked.find((a) => a.kind === "mc")?.answer).toBe(
      "On the inside of the bend, where water slows.",
    );
    expect(d.terms[0]).toMatchObject({ term: "Hydraulic force", slide: 3 });
    expect(d.asked.find((a) => a.slide === 8)?.question).toBe(
      "Pebbles scrape a river bed. Name the process.",
    );
    expect(d.objectives[0]).toBe("Name four ways a river erodes its channel.");
  });

  test("objectives come from the facts unless the teacher edited the objectives slide", () => {
    const facts = { objectives: [{ id: "o1", text: "From the facts." }] } as Lesson["facts"];
    const edited = lessonOf(rivers as Fixture, { facts });
    expect(lessonDigest(edited).objectives[0]).toStartWith("Describe how hydraulic action");
    const fresh = lessonOf(rivers as Fixture, { facts });
    for (const s of fresh.slides) delete s.teacherEdited;
    expect(lessonDigest(fresh).objectives).toEqual(["From the facts."]);
  });

  test("a slide whose model answer is still '…' is not asked", () => {
    const lesson = lessonOf(rivers as Fixture);
    const s8 = lesson.slides.find((s) => s.id === "s8");
    if (s8?.question?.type === "open-response") s8.question.modelAnswer = "1. …\n2. …\n3. …";
    expect(lessonDigest(lesson).asked.some((a) => a.slide === 8)).toBe(false);
  });

  test("an exit ticket with fewer than 2 items greys the Exit ticket sheet", () => {
    const lesson = lessonOf(rivers as Fixture);
    lesson.slides = lesson.slides.filter((s) => s.kind !== "exit-ticket");
    const exit = availableTypes(lessonDigest(lesson)).find((t) => t.type === "exit-ticket");
    expect(exit).toEqual({
      type: "exit-ticket",
      available: false,
      reason: "This lesson has no exit ticket to put on a sheet.",
    });
  });
});

describe("misconceptionsOf", () => {
  test("reads only the prose under the Misconceptions heading", () => {
    const notes =
      "Running\nAsk pupils.\n\nAnswers\n1. A\n\nMisconceptions\nPupils say X.\nNot X.\n\nBackground\nMore.";
    expect(misconceptionsOf(notes)).toEqual(["Pupils say X. Not X."]);
    expect(misconceptionsOf("")).toEqual([]);
    expect(misconceptionsOf("Running\nOnly running.")).toEqual([]);
  });
});
