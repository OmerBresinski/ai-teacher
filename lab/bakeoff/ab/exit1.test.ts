import { describe, expect, test } from "bun:test";
import { fillTemplate } from "../harness";
import { AB_CONFIG, AB_REF } from "./arms";
import { BEFORE_YOU_GO, exitTicketSlide, readExitTicket } from "./exit-ticket";

const et = { questions: ["Q1?", "Q2?", "Q3?"] };

describe("exit1 (rulings 141/148)", () => {
  test("exit1 = base6b's code switches (base6 without titleSub) + exitTicket", () => {
    const { exitTicket, delta: _d, ...rest } = AB_CONFIG.exit1;
    const { delta: _b, titleSub: _t, ...base6 } = AB_CONFIG.base6;
    expect(exitTicket).toBe(true);
    expect(rest).toEqual(base6);
    expect(AB_REF.exit1?.ref).toBe("base6");
    expect(AB_CONFIG.base6.exitTicket).toBeUndefined();
  });
  test("on slides: 'Before you go' with the questions, last, inside the count", () => {
    const x = exitTicketSlide(et, true, 11);
    expect(x.slide).toEqual({
      template: "exit-ticket",
      heading: BEFORE_YOU_GO,
      questions: et.questions,
      instruction: "Answer on your own.",
    });
    expect(x.flow.slide).toBe(12);
    expect(x.placed).toEqual({
      questions: et.questions,
      onSlides: true,
      slide: 12,
      template: "exit-ticket",
    });
  });
  test("on the worksheet: ruling 141's pointer slide; the questions stay in the record only", () => {
    const x = exitTicketSlide({ questions: ["Q1?", "Q2?"] }, false, 9);
    expect(x.slide).toEqual({
      template: "explain",
      heading: "Exit ticket",
      lead: "Complete it on your worksheet.",
      points: ["2 questions, on your own."],
    });
    expect(JSON.stringify(x.slide)).not.toContain("Q1?");
    expect(x.placed.questions).toEqual(["Q1?", "Q2?"]);
    expect(x.placed.slide).toBe(10);
    expect(x.flow.teaches).toEqual([]);
  });
  test("readExitTicket drops blanks and refuses a missing field", () => {
    expect(readExitTicket({ questions: [" A? ", "", null] })).toEqual({ questions: ["A?"] });
    expect(readExitTicket(undefined)).toBeUndefined();
    expect(readExitTicket({ questions: [] })).toBeUndefined();
  });
  test("the user template's writerSlides is the brief's range less one", () => {
    const b = { slides: { min: 9, max: 12 } } as Parameters<typeof fillTemplate>[1];
    expect(
      fillTemplate("Slides: {{writerSlides.min}} to {{writerSlides.max}}", b, {
        "writerSlides.min": 8,
        "writerSlides.max": 11,
      }),
    ).toBe("Slides: 8 to 11");
  });
});
