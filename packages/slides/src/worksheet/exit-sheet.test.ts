import { describe, expect, test } from "bun:test";
import { richDocToPlainText, type Slide, type WorksheetBlock } from "@tj/domain/documents";
import { availableTypes, isSpokenTask, lessonDigest, UNAVAILABLE_REASONS } from "./digest";
import {
  answerSpace,
  answerWithWorking,
  DRAW_BOX_PT,
  EXIT_SHEET_HEADING,
  exitTicketBlocks,
  letteredParts,
  WORKING_BOX_PT,
} from "./exit-sheet";
import { fixtureLesson, type WorksheetFixtureName } from "./fixtures";

/*
 * T6 (worksheets plan v2 §2d): the Exit ticket sheet is the exit-ticket slide on paper, built
 * from the digest with no model call. One build test per recorded fixture.
 */

let n = 0;
const ids = () => `b${++n}`;

const text = (b: WorksheetBlock) => ("doc" in b && b.doc ? richDocToPlainText(b.doc).trim() : "");

function questions(name: WorksheetFixtureName) {
  n = 0;
  const built = exitTicketBlocks(lessonDigest(fixtureLesson(name)), ids);
  if (!built.ok) throw new Error(`${name}: ${built.reason}`);
  return {
    blocks: built.blocks,
    qs: built.blocks.flatMap((b) => (b.type === "question" ? [b] : [])),
  };
}

describe("exitTicketBlocks per fixture", () => {
  test("Y2 halves: the packed task splits into lettered parts; a drawing box, working space", () => {
    const { blocks, qs } = questions("halves");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(text(blocks[0] as WorksheetBlock)).toBe(EXIT_SHEET_HEADING);
    expect(blocks[1]?.type).toBe("instructions");
    expect(qs.map(text)).toEqual([
      "a) Draw a square. Shade half.\nb) Find half of 18.",
      "What is one quarter of 16 counters?",
    ]);
    expect(qs.map((q) => q.answer)).toEqual([
      "a) Two equal parts, one shaded; b) 9 (18 ÷ 2 = 9)",
      "4 counters (16 ÷ 4 = 4)",
    ]);
    expect(qs.map((q) => q.number)).toEqual([1, 2]);
    expect(qs.every((q) => q.answerLines === 0 && q.marks === undefined)).toBe(true);
    const spaces = blocks
      .slice(2)
      .map((b) =>
        b.type === "answer-box"
          ? `box:${b.label ?? ""}:${b.heightPt}`
          : b.type === "lines"
            ? `lines:${b.count}`
            : b.type,
      );
    expect(spaces).toEqual([
      "question",
      `box:a):${DRAW_BOX_PT}`,
      `box:b) Working and answer:${WORKING_BOX_PT}`,
      "question",
      `box:Working and answer:${WORKING_BOX_PT}`,
    ]);
  });

  test("Y4 Romans: three tasks with the slide's answers", () => {
    const { qs } = questions("romans");
    expect(qs).toHaveLength(3);
    expect(text(qs[0] as WorksheetBlock)).toBe("When and where did Hadrian order the wall built?");
    expect(qs[0]?.answer).toBe("AD 122; northern England");
    expect(qs.every((q) => (q.answer ?? "").length > 0)).toBe(true);
  });

  test("Y9 rivers: three how/why tasks, three lines each", () => {
    const { qs } = questions("rivers");
    expect(qs.map(text)).toEqual([
      "How does hydraulic action weaken cracks in a river channel?",
      "Why does sediment collect on the inner bank of a meander?",
      "How can erosion of neighbouring bends lead to an oxbow lake?",
    ]);
    expect(qs[1]?.answer).toBe("Water flows more slowly there, so sediment is deposited.");
    expect(qs.map((q) => q.answerLines)).toEqual([3, 3, 3]);
  });

  test("Y11 rates: every task has an answer, working carried", () => {
    const { qs } = questions("rates");
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.every((q) => (q.answer ?? "").trim().length > 0)).toBe(true);
  });
});

describe("Years 1-2 spoken tasks, then the exit minimum", () => {
  function withSpokenTask(name: WorksheetFixtureName, task: string) {
    const lesson = fixtureLesson(name);
    const slide = lesson.slides.find((s) => s.kind === "exit-ticket") as Slide;
    let done = false;
    const visit = (els: Slide["elements"]) => {
      for (const e of els) {
        if (!done && e.type === "text" && e.name === "Task") {
          (e as { doc: unknown }).doc = {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: task }] }],
          };
          done = true;
        }
        if ("children" in e && Array.isArray(e.children)) visit(e.children as Slide["elements"]);
      }
    };
    visit(slide.elements);
    return lesson;
  }

  test("a Year 2 spoken task is dropped, so two tasks become one: greyed with the reason", () => {
    const digest = lessonDigest(withSpokenTask("halves", "Tell your partner what half means."));
    const built = exitTicketBlocks(digest);
    expect(built).toEqual({
      ok: false,
      code: "not-enough-lesson",
      reason: UNAVAILABLE_REASONS["exit-ticket"],
    });
    expect(availableTypes(digest).find((t) => t.type === "exit-ticket")).toMatchObject({
      available: false,
      reason: UNAVAILABLE_REASONS["exit-ticket"],
    });
  });

  test("the same task stays for Year 9 (the filter is Years 1-2 only)", () => {
    const built = exitTicketBlocks(
      lessonDigest(withSpokenTask("rivers", "Tell your partner what erosion means.")),
    );
    expect(built.ok && built.blocks.filter((b) => b.type === "question")).toHaveLength(3);
  });

  test("lead verbs", () => {
    expect(isSpokenTask("Say the number.")).toBe(true);
    expect(isSpokenTask("Show me a half.")).toBe(true);
    expect(isSpokenTask("1. Discuss with a partner")).toBe(true);
    expect(isSpokenTask("Draw a square.")).toBe(false);
    expect(isSpokenTask("Sayings of the Romans")).toBe(false);
  });
});

test("answerWithWorking keeps an answer that already shows its working", () => {
  expect(answerWithWorking({ answer: "9 (18 ÷ 2 = 9)", working: "18 ÷ 2 = 9" })).toBe(
    "9 (18 ÷ 2 = 9)",
  );
  expect(answerWithWorking({ answer: "9" })).toBe("9");
});

test("answer space by task type, and lettered parts only when the answer has matching parts", () => {
  expect(answerSpace("Label the diagram.", undefined)).toBe("draw");
  expect(answerSpace("Work out 84 ÷ 28.", undefined)).toBe("calculation");
  expect(answerSpace("What is half of 8?", "8 ÷ 2 = 4")).toBe("calculation");
  expect(answerSpace("Why does sediment collect there?", undefined)).toBe("explain");
  expect(answerSpace("Name the emperor.", undefined)).toBe("short");
  expect(
    letteredParts({ question: "When and where was it built?", answer: "AD 122; northern England" }),
  ).toBeUndefined();
  expect(
    letteredParts({ question: "Draw a square. Shade half.", answer: "A square, half shaded" }),
  ).toBeUndefined();
});
