import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { GroupElement } from "@tj/domain/documents";
import { drawFigure, FIGURE_RECT } from "@tj/slides";
import { getTheme } from "../../model/themes";
import { GroupView } from "./GroupView";

/* TEACH-77: a Figure is one group that a screen reader announces by its alt text. */

afterEach(cleanup);

const theme = getTheme("chalk");

const renderGroup = (element: GroupElement) =>
  render(
    <GroupView
      element={element}
      theme={theme}
      mode="view"
      slideId="s1"
      hidden={false}
      ghost={false}
      revealAnswer={false}
    />,
  );

describe("GroupView", () => {
  test("a group with alt is one image named by its alt text", () => {
    const figure = drawFigure(
      "right-triangle",
      {
        base: { length: 3, label: "3 cm" },
        height: { length: 4, label: "4 cm" },
        hypotenuse: { label: "x" },
      },
      theme,
      FIGURE_RECT,
    );
    const { container } = renderGroup(figure);
    const image = screen.getByRole("img", {
      name: "Right-angled triangle. Base 3 cm, height 4 cm, hypotenuse x.",
    });
    expect(image).toBe(container.firstElementChild as HTMLElement);
    // The labels are drawn inside the image, not beside it.
    expect(image.textContent).toContain("3 cm");
    expect(image.textContent).toContain("4 cm");
  });

  test("a group without alt is a plain box, as before", () => {
    const group: GroupElement = {
      id: "g",
      type: "group",
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      children: [],
    };
    const { container } = renderGroup(group);
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute("role")).toBeNull();
    expect(box.getAttribute("aria-label")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
