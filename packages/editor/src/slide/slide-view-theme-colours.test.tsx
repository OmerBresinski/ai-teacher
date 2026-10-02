import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { Slide, TextElement } from "@tj/domain/documents";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";

/*
 * `withThemeColours` in `SlideView`: every view draws a theme-token colour in the slide's theme,
 * but the editor hands its text renderers the doc as stored. Its Tiptap editors save the doc they
 * were seeded with, so a themed doc would write the remapped colour into the lesson on the first
 * keystroke (exam-hall reads `#FFFFFF` as its surface, `#F3F5F8`).
 */

const exam = getTheme("exam-hall");
const white: TextElement = {
  id: "t",
  type: "text",
  x: 100,
  y: 100,
  w: 600,
  h: 80,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "White words",
            marks: [{ type: "textStyle", attrs: { color: "#FFFFFF" } }],
          },
        ],
      },
    ],
  },
  style: { preset: "body" },
};
const slide: Slide = { id: "s", kind: "blank", elements: [white] };

const markColour = (mode: "edit" | "view" | "present") => {
  const { container } = render(<SlideView slide={slide} theme={exam} mode={mode} />);
  // The mark's own span, inside the text box (whose colour is the theme's ink).
  const span = [...container.querySelectorAll<HTMLElement>(".td-rt span[style]")].find(
    (el) => el.textContent === "White words",
  );
  return span?.style.color.toLowerCase();
};

describe("theme colours in SlideView", () => {
  test("view and present draw the token in the slide's theme", () => {
    expect(markColour("view")).toMatch(/#f3f5f8|rgb\(243, 245, 248\)/);
    expect(markColour("present")).toMatch(/#f3f5f8|rgb\(243, 245, 248\)/);
  });

  test("the editor draws the stored doc, so its text editors never save a themed colour", () => {
    expect(markColour("edit")).toMatch(/#ffffff|rgb\(255, 255, 255\)/);
  });
});
