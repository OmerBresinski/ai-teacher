import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { GroupElement } from "@tj/domain/documents";
import { drawFigure, FIGURE_RECT } from "@tj/slides";
import * as kit from "@tj/slides/relayout";
import { getTheme } from "../../model/themes";
import { GroupView } from "./GroupView";

/* TEACH-77: a Figure is one group that a screen reader announces by its alt text. */

afterEach(cleanup);

const theme = getTheme("splash");

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

describe("GroupView of an adaptive layout (TEACH-205 part b)", () => {
  const layoutGroup = (): GroupElement => {
    const grid = ["Roots", "Stem"].map((label) => ({ label, text: `The ${label} works.` }));
    return kit.layoutGroup(
      { template: "cards-grid", input: { heading: "Parts", grid } },
      theme,
      "ks2",
      "g1",
    );
  };
  test("view, present, print capture and thumbnails draw it unclipped, as master did", () => {
    for (const mode of ["view", "present", "capture", "thumb"] as const) {
      const { container } = render(
        <GroupView
          element={layoutGroup()}
          theme={theme}
          mode={mode}
          slideId="s1"
          hidden={false}
          ghost={false}
          revealAnswer={false}
        />,
      );
      expect(container.querySelector("[data-layout-frame]")).toBeNull();
      expect(container.innerHTML).not.toContain("overflow: hidden");
      cleanup();
    }
  });

  test("the editor clips it at its frame", () => {
    const { container } = render(
      <GroupView
        element={layoutGroup()}
        theme={theme}
        mode="edit"
        slideId="s1"
        hidden={false}
        ghost={false}
        revealAnswer={false}
      />,
    );
    const frame = container.querySelector<HTMLElement>("[data-layout-frame]");
    expect(frame?.style.overflow).toBe("hidden");
  });
});
