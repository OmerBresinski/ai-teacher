import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import { LessonPrint } from "./LessonPrint";

/*
 * TEACH-251 part av: a lesson is editable, and so printable to PDF, while a picture is still on
 * its way. The print route (the PDF export) draws the slide; the pending slot is
 * the placeholder picture, never the editor's sheen, and nothing throws.
 */
afterEach(cleanup);

function withPending() {
  const base = creditedLesson();
  const slide = {
    id: "pending-slide",
    kind: "content" as const,
    elements: [
      {
        id: "coming",
        type: "image" as const,
        x: 980,
        y: 200,
        w: 800,
        h: 600,
        src: PLACEHOLDER_IMAGE,
        alt: "Plant roots in soil",
      },
    ],
  };
  return { ...base, slides: [...base.slides, slide] } as never as ReturnType<typeof creditedLesson>;
}

describe("PDF (print route) with a picture still pending", () => {
  it("prints the slide in every layout, without the editor's sheen", () => {
    for (const options of [{}, { notes: true }, { handout3: true }]) {
      const { unmount } = render(<LessonPrint lesson={withPending()} options={options} />);
      const main = screen.getByRole("main");
      const at = withPending().slides.length - 1;
      // The pending slide is printed, after every other slide.
      expect(main.querySelector(`[data-slide-index="${at}"]`)).toBeTruthy();
      expect(main.querySelector("[data-slot-sheen]")).toBeNull();
      expect(main.querySelector("[data-slot-placeholder]")).toBeNull();
      unmount();
    }
  });
});
