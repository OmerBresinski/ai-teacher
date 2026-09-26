import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { Slide } from "@tj/domain/documents";
import { COUNTER_NAME } from "@tj/slides";
import { docFromText } from "../model/factories";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";

const theme = getTheme("chalk");
const slide: Slide = {
  id: "s",
  kind: "content",
  elements: [
    {
      id: "c",
      type: "text",
      x: 800,
      y: 43,
      w: 100,
      h: 28,
      name: COUNTER_NAME,
      doc: docFromText("1 / 1"),
      style: { preset: "caption" },
    },
  ],
};

describe("slide counter", () => {
  test("drawn from the slide's place in the deck, not the stored words", () => {
    const { container } = render(
      <SlideView slide={slide} theme={theme} mode="present" position={{ index: 6, total: 12 }} />,
    );
    expect(container.querySelector('[data-element-id="c"]')?.textContent).toBe("7 / 12");
  });

  test("not drawn where the place is unknown (the editor, thumbnails)", () => {
    const { container } = render(<SlideView slide={slide} theme={theme} mode="edit" />);
    expect(container.querySelector('[data-element-id="c"]')).toBeNull();
  });
});
