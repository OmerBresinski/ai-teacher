import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { summarise } from "@tj/domain/documents";
import { newLesson } from "@tj/editor";
import { demoWorksheet } from "@tj/editor/starter";
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

  it("paints a worksheet cover as the real sheet, greyscale, not the initial (TEACH-193)", () => {
    // The sheet mounts once the card is near the viewport; happy-dom's observer never fires, so
    // stand in one that reports the box on screen at once.
    const RealObserver = globalThis.IntersectionObserver;
    class OnScreen {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe() {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = OnScreen as never;
    const sheet = demoWorksheet();
    const summary = summarise(sheet);
    const { container } = render(
      <LessonThumb lesson={{ title: sheet.title, themeId: sheet.themeId, cover: summary.cover }} />,
    );
    expect(container.querySelector(".ws-thumb .ws-page")).not.toBeNull();
    expect(container.querySelector(".ws-title")?.textContent).toBe("Fractions practice");
    expect(container.querySelector("[data-slide-root]")).toBeNull();
    expect(container.querySelector(".font-display")).toBeNull();
    // Marks on for this sheet: the label prints in the miniature as on the page.
    expect(container.querySelectorAll(".ws-marks").length).toBeGreaterThan(0);
    globalThis.IntersectionObserver = RealObserver;
  });

  it("falls back to the theme swatch and initial without a cover", () => {
    const { container } = render(<LessonThumb lesson={{ title: "Rivers", themeId: "chalk" }} />);
    expect(container.querySelector("[data-slide-root]")).toBeNull();
    expect(container).toHaveTextContent("R");
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).toBeTruthy();
  });
});
