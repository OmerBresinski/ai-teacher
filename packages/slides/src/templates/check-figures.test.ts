import { describe, expect, test } from "bun:test";
import { getTheme, THEMES } from "../themes";
import { EXIT_VISUAL, ticketW } from "./exit-ticket";
import { HINGE_CAPS } from "./hinge";
import { layoutTemplate, type TemplateInput } from "./index";
import { capOf } from "./practice";
import { QUICK_NAMES, QUICK_VISUAL, quickCaps } from "./question-set";

/*
 * TEACH-247 part cj (Greg, 1 Nov): check slides may show the picture of the thing the question
 * works from. The exit ticket and the quick check take practice's white card on the left, the hinge
 * its figure beside the cards; each reports its fields against caps measured beside a picture.
 */
const PHOTO = { photo: "https://x.test/p.jpg", aspect: 4 / 3, alt: "A picture" };
const theme = getTheme("splash", "ks2");
const images = (els: { type: string }[]) => els.filter((e) => e.type === "image");

describe("exit ticket with a picture", () => {
  const input: TemplateInput = {
    template: "exit-ticket",
    heading: "Fighting the fire",
    questions: ["How did people pass water to a fire?", "Why pull a house down?"],
    answers: ["In buckets", "To make a gap"],
  };

  test("the picture's card sits left and the ticket narrows to its right, nothing over", () => {
    const r = layoutTemplate({ ...input, figure: PHOTO, checkFigure: true }, theme, "ks2");
    expect(r.over).toEqual([]);
    const img = images(r.slide.elements)[0] as { x: number; w: number } | undefined;
    expect(img).toBeDefined();
    expect((img?.x ?? 0) + (img?.w ?? 0)).toBeLessThanOrEqual(64 + EXIT_VISUAL.w);
    const tasks = r.slide.elements.filter((e) => e.name === "Task") as { x: number }[];
    expect(tasks.every((t) => t.x > 64 + EXIT_VISUAL.w)).toBe(true);
    expect(ticketW(true)).toBeLessThan(ticketW(false));
    // Answers stay question data for the Answers slides.
    expect(r.slide.question).toBeDefined();
  });

  test("its fields read the exit+picture caps; without a picture, the plain exit caps", () => {
    const withIt = layoutTemplate({ ...input, figure: PHOTO, checkFigure: true }, theme, "ks2");
    const without = layoutTemplate(input, theme, "ks2");
    expect(withIt.fields?.[0]?.cap).toBe(capOf("primary", "exit+picture", 2)?.cap);
    expect(without.fields?.[0]?.cap).toBe(capOf("primary", "exit", 2)?.cap);
    expect(images(without.slide.elements)).toEqual([]);
  });

  test("questions past the exit+picture hard maximum are over on every theme", () => {
    const max = capOf("early", "exit+picture", 3)?.hardMax ?? 0;
    const long = "Explain how the heart pumps blood through the arteries to every part of the body";
    const qs = [1, 2, 3].map(() => long.slice(0, max + 25));
    for (const t of THEMES) {
      const r = layoutTemplate(
        { template: "exit-ticket", heading: "H", questions: qs, figure: PHOTO, checkFigure: true },
        getTheme(t.id, "ks1"),
        "ks1",
      );
      expect(r.over.length + (r.fields ?? []).filter((f) => f.over).length).toBeGreaterThan(0);
    }
  });
});

describe("quick check with a picture", () => {
  const input: TemplateInput = {
    template: "question-set",
    heading: "Quick check",
    questions: ["Which street?", "Which year?", "Which building?"],
    answers: ["Pudding Lane", "1666", "A bakery"],
    figure: PHOTO,
    checkFigure: true,
  };

  test("a figure the writer asked for keeps the old layouts exactly", () => {
    const { checkFigure: _, ...writers } = input;
    const old = layoutTemplate(writers, theme, "ks2");
    expect(old.slide.elements.some((e) => e.name === QUICK_NAMES.answer)).toBe(false);
    const exitOld = layoutTemplate(
      { template: "exit-ticket", heading: "H", questions: ["Q?"], figure: PHOTO },
      theme,
      "ks2",
    );
    const exitPlain = layoutTemplate(
      { template: "exit-ticket", heading: "H", questions: ["Q?"] },
      theme,
      "ks2",
    );
    expect(images(exitOld.slide.elements)).toEqual([]);
    expect(exitOld.slide.elements.map((e) => [e.name, e.x, e.y, e.w, e.h])).toEqual(
      exitPlain.slide.elements.map((e) => [e.name, e.x, e.y, e.w, e.h]),
    );
  });

  test("stays the quick check (answers revealed one per click) with the card left of the badges", () => {
    const r = layoutTemplate(input, theme, "ks2");
    expect(r.over).toEqual([]);
    const answers = r.slide.elements.filter((e) => e.name === QUICK_NAMES.answer);
    expect(answers).toHaveLength(3);
    expect(answers.every((a) => typeof a.revealStep === "number")).toBe(true);
    const img = images(r.slide.elements)[0] as unknown as { x: number; w: number };
    const qs = r.slide.elements.filter((e) => e.name === QUICK_NAMES.question) as { x: number }[];
    expect(qs.every((q) => q.x > img.x + img.w)).toBe(true);
    expect(img.w).toBeLessThanOrEqual(QUICK_VISUAL.w);
  });

  test("reports its questions against the picture caps", () => {
    const r = layoutTemplate(input, theme, "ks2");
    expect(r.fields?.find((f) => f.path === "questions.0")?.cap).toBe(
      quickCaps("ks2", 3, true).questions.cap,
    );
    expect(quickCaps("ks2", 3, true).questions.cap).toBeLessThan(quickCaps("ks2", 3).questions.cap);
  });
});

describe("hinge with a picture", () => {
  test("its options read the byCountPicture caps", () => {
    const r = layoutTemplate(
      {
        template: "hinge",
        heading: "Which part of the plant makes seeds?",
        options: ["The flower", "The root", "The leaf"],
        correct: 1,
        figure: PHOTO,
      },
      theme,
      "ks2",
    );
    expect(r.over).toEqual([]);
    expect(images(r.slide.elements)).toHaveLength(1);
    expect(r.fields?.[0]?.cap).toBe(HINGE_CAPS.primary.byCountPicture?.["3"]?.chars);
  });
});
