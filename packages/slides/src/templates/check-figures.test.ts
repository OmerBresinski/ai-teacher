import { describe, expect, test } from "bun:test";
import { getTheme, THEMES } from "../themes";
import { EXIT_VISUAL, ticketW } from "./exit-ticket";
import { HINGE_CAPS } from "./hinge";
import { layoutTemplate, type TemplateInput } from "./index";
import { capOf } from "./practice";

/*
 * TEACH-247 part cj (Greg, 1 Nov): check slides may show the picture of the thing the question
 * works from. The exit ticket takes practice's white card on the left, the hinge
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

describe("a figure the writer asked for", () => {
  test("keeps the exit ticket's old layout exactly", () => {
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
