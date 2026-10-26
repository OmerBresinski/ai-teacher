import { describe, expect, test } from "bun:test";
import { checkLesson } from "./checks";
import greatFire from "./fixtures/verify3-greatfire-y2.json";
import romans from "./fixtures/verify3-romans-y4.json";
import { text } from "./fixtures.test-helpers";
import type { Lesson } from "./lesson";
import type { Slide, SlideElement } from "./slide";
import { walkElements } from "./text";
import type { Worksheet, WorksheetBlock } from "./worksheet";

/*
 * TEACH-247 part ak: the editor's "things to check" badge on two fresh lessons (genlab verify3,
 * 26 Oct 2026: Great Fire Y2 Detailed, Romans Y4 Standard) showed 4 and 5 findings, all false:
 * every objective "not covered by any slide", the exit ticket's "EXIT TICKET" eyebrow read as a
 * task that asks nothing, and the practice heading "You are guarding the frontier" read as the
 * task. The fixtures are the saved lessons (`debug.json` `lesson.slides`) with the facts the plan
 * approved; strings over 500 characters (picture URLs and attributions) are trimmed, as no check
 * reads them.
 */

const load = (raw: unknown): Lesson => structuredClone(raw) as Lesson;
const greatFireLesson = () => load(greatFire);
const romansLesson = () => load(romans);

const slideOf = (l: Lesson, id: string): Slide => {
  const slide = l.slides.find((s) => s.id === id);
  if (!slide) throw new Error(`fixture has no slide ${id}`);
  return slide;
};

const named = (slide: Slide, name: string): SlideElement[] => {
  const out: SlideElement[] = [];
  walkElements(slide.elements, (e) => {
    if (e.name === name) out.push(e);
  });
  return out;
};

const setText = (element: SlideElement | undefined, value: string) => {
  if (element?.type !== "text") throw new Error("fixture changed");
  element.doc = text(value);
};

/** Drop every element with one of the names, groups included. */
const dropNamed = (elements: SlideElement[], names: ReadonlySet<string>): SlideElement[] =>
  elements
    .filter((e) => e.name === undefined || !names.has(e.name))
    .map((e) => (e.type === "group" ? { ...e, children: dropNamed(e.children, names) } : e));

const of = (l: Lesson, check: string, w?: Worksheet) =>
  checkLesson(l, w).filter((f) => f.check === check);

describe("live checks on recorded lessons (TEACH-247 part ak)", () => {
  test("the saved slides carry no provenance, as the writer pipeline saves them", () => {
    for (const l of [greatFireLesson(), romansLesson()]) {
      const refs: string[] = [];
      for (const slide of l.slides) {
        walkElements(slide.elements, (e) => refs.push(...(e.generatedFrom?.factRefs ?? [])));
      }
      expect(refs).toEqual([]);
      expect(l.facts?.objectives).toHaveLength(3);
    }
  });

  test("the Great Fire lesson raises no finding", () => {
    expect(checkLesson(greatFireLesson())).toEqual([]);
  });

  test("the Romans lesson raises no finding", () => {
    expect(checkLesson(romansLesson())).toEqual([]);
  });
});

describe("objective-coverage by wording when no slide carries provenance", () => {
  const addObjective = (l: Lesson, objectiveText: string) => {
    l.facts?.objectives.push({ id: "o4", text: objectiveText });
  };

  test("an objective no slide teaches is still one error", () => {
    const l = greatFireLesson();
    addObjective(l, "Explain why Christopher Wren rebuilt St Paul's Cathedral after the fire.");
    const findings = of(l, "objective-coverage");
    expect(findings.map((f) => [f.target, f.message.includes("any slide")])).toEqual([
      [{ factId: "o4" }, true],
    ]);
  });

  test("the objectives slide naming an objective does not cover it", () => {
    const l = greatFireLesson();
    const wording = "Explain why Christopher Wren rebuilt St Paul's Cathedral after the fire.";
    addObjective(l, wording);
    setText(named(slideOf(l, "s2"), "Item")[2], wording);
    expect(of(l, "objective-coverage").map((f) => f.target)).toEqual([{ factId: "o4" }]);
  });

  test("words spread across slides do not cover an objective; one slide must carry half", () => {
    const l = greatFireLesson();
    // Every word but "connect" is in the lesson, yet no one slide holds four of the seven.
    addObjective(l, "Connect the bakery, Pudding Lane, sparks, buckets and the memorial.");
    expect(of(l, "objective-coverage").map((f) => f.target)).toEqual([{ factId: "o4" }]);
  });

  test("a slide with provenance puts the lesson back on the id path", () => {
    const l = greatFireLesson();
    const lead = named(slideOf(l, "s3"), "Lead")[0];
    if (!lead) throw new Error("fixture changed");
    lead.generatedFrom = { factRefs: ["o1"], promptVersion: "test" } as never;
    expect(of(l, "objective-coverage").map((f) => f.target)).toEqual([
      { factId: "o2" },
      { factId: "o3" },
    ]);
  });

  test("worksheet blocks with no provenance are matched by wording too", () => {
    const block = (id: string, stem: string): WorksheetBlock =>
      ({
        id,
        type: "question",
        doc: text(stem),
        answerLines: 2,
        answer: "an answer",
        authoredBy: "ai",
      }) as WorksheetBlock;
    const worksheet = (blocks: WorksheetBlock[]) => ({ blocks }) as unknown as Worksheet;
    const covering = [
      block("b1", "Where in London did the Great Fire start, and when?"),
      block("b2", "How did wooden houses, narrow streets and strong winds spread the fire?"),
      block("b3", "How did people use buckets, fire hooks and pulled-down houses?"),
    ];
    expect(of(greatFireLesson(), "objective-coverage", worksheet(covering))).toEqual([]);
    const findings = of(greatFireLesson(), "objective-coverage", worksheet(covering.slice(0, 2)));
    expect(findings.map((f) => [f.target, f.message.includes("the worksheet")])).toEqual([
      [{ factId: "o3" }, true],
    ]);
  });
});

describe("degenerate-question reads a practice or exit ticket's own task lines", () => {
  test("the exit ticket's eyebrow is not a task; a task line that asks nothing still is", () => {
    const l = greatFireLesson();
    const exit = slideOf(l, "s13");
    setText(named(exit, "Task")[1], "Pudding Lane.");
    const findings = of(l, "degenerate-question");
    expect(findings.map((f) => [f.target, f.message])).toEqual([
      [{ slideId: "s13" }, 'Slide "exit-ticket" sets a task that asks nothing: "Pudding Lane."'],
    ]);
  });

  test("an exit ticket with no task lines is an error", () => {
    const l = romansLesson();
    const exit = slideOf(l, "s10");
    exit.elements = dropNamed(exit.elements, new Set(["Task"]));
    const findings = of(l, "degenerate-question");
    expect(findings.map((f) => [f.target, f.message])).toEqual([
      [{ slideId: "s10" }, 'Slide "exit-ticket" sets no task: it has no questions.'],
    ]);
  });

  test("an older exit ticket's numbered body lines are still read, without the eyebrow", () => {
    const l = romansLesson();
    const exit = slideOf(l, "s10");
    const task = named(exit, "Task")[0];
    exit.elements = dropNamed(exit.elements, new Set(["Task"]));
    if (task?.type !== "text") throw new Error("fixture changed");
    exit.elements.push({
      ...task,
      id: "exit-lines",
      name: "Body",
      doc: text("1. Where was Hadrian’s Wall built?\n2. Forts and milecastles."),
    });
    expect(of(l, "degenerate-question").map((f) => f.message)).toEqual([
      'Slide "exit-ticket" sets a task that asks nothing: "Forts and milecastles."',
    ]);
  });

  test("a practice slide's heading is not its task; a task line that asks nothing still is", () => {
    const l = romansLesson();
    const practice = slideOf(l, "s9");
    expect(of(l, "degenerate-question")).toEqual([]);
    setText(named(practice, "Task")[0], "Traders with carts of goods at the gateway.");
    expect(of(l, "degenerate-question").map((f) => [f.target, f.message])).toEqual([
      [
        { slideId: "s9" },
        'Slide "open-response" sets a task that asks nothing: "Traders with carts of goods at the gateway."',
      ],
    ]);
  });
});
