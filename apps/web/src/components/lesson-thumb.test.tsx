import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { newLesson } from "@tj/editor";
import { LessonThumb } from "./lesson-thumb";

describe("LessonThumb", () => {
  it("renders the cover slide through the fluid static renderer", () => {
    const cover = newLesson("Fractions", "playground").slides[0] ?? null;
    const { container } = render(
      <LessonThumb lesson={{ title: "Fractions", themeId: "playground", cover }} />,
    );
    const slide = container.querySelector("[data-slide-root]") as HTMLElement;
    expect(container.querySelector("[data-slide-fluid]")).not.toBeNull();
    expect(slide.dataset.slideMode).toBe("thumb");
    expect(slide.style.background.toUpperCase()).toBe("#FFF7EF");
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to the theme swatch and initial without a cover", () => {
    const { container } = render(<LessonThumb lesson={{ title: "Rivers", themeId: "chalk" }} />);
    expect(container.querySelector("[data-slide-root]")).toBeNull();
    expect(container).toHaveTextContent("R");
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).toBeTruthy();
  });
});
