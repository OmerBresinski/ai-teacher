import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import { lesson as baseLesson, creditedLesson } from "@tj/domain/documents/fixtures";
import { LessonPrint } from "./LessonPrint";

/* TEACH-161: the "Image credits" page at the end of the lesson print route, in every layout. */

afterEach(cleanup);

const main = () => screen.getByRole("main");
const creditsPage = () => main().querySelector<HTMLElement>("[data-credits-page]");

describe("LessonPrint image credits", () => {
  it("ends the one-per-page print on a landscape credits page with links and visible addresses", () => {
    render(<LessonPrint lesson={creditedLesson()} />);
    const page = creditsPage();
    if (!page) throw new Error("no credits page");
    expect(page.className).toContain("td-print-page");
    // Last in the document, after every slide page, and counted.
    expect(main().lastElementChild).toBe(page);
    expect(main().dataset.pageCount).toBe("5");
    const view = within(page);
    expect(view.getByRole("heading", { level: 1, name: "Image credits" })).toBeTruthy();
    expect(view.getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Photo by Ada on Pexels",
      "Photo by Bob on Pexels",
      "Sky by Cy, CC BY 2.0 · View the original",
    ]);
    const ada = view.getByRole("link", { name: "Ada" });
    expect(ada.getAttribute("href")).toBe("https://www.pexels.com/@ada");
    expect(page.querySelector(".td-credits-urls")?.textContent).toBe(
      "https://www.pexels.com/@ada  ·  https://www.pexels.com/photo/1001/",
    );
    expect(view.getByRole("link", { name: "View the original" }).getAttribute("href")).toBe(
      "https://openverse.org/x",
    );
  });

  it("takes the A4 page of the notes and three-per-page layouts", () => {
    const { unmount } = render(<LessonPrint lesson={creditedLesson()} options={{ notes: true }} />);
    expect(creditsPage()?.className).toContain("td-handout-page");
    expect(main().dataset.pageCount).toBe("5");
    unmount();
    render(<LessonPrint lesson={creditedLesson()} options={{ handout3: true }} />);
    expect(creditsPage()?.className).toContain("td-handout3-page");
    // Four slides at three to a page is two pages, plus the credits.
    expect(main().dataset.pageCount).toBe("3");
  });

  it("lists only the pictures on the slides in the range", () => {
    render(<LessonPrint lesson={creditedLesson()} options={{ slides: "1-2" }} />);
    const items = within(creditsPage() as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Photo by Ada on Pexels",
      "Photo by Bob on Pexels",
    ]);
    expect(main().dataset.pageCount).toBe("3");
  });

  it("adds no page when nothing printed is credited", () => {
    const { unmount } = render(<LessonPrint lesson={baseLesson()} />);
    expect(creditsPage()).toBeNull();
    expect(main().dataset.pageCount).toBe(String(baseLesson().slides.length));
    expect(screen.queryByText("Image credits")).toBeNull();
    unmount();
    // Slide 4 has a picture with no credit at all.
    render(<LessonPrint lesson={creditedLesson()} options={{ slides: "4" }} />);
    expect(creditsPage()).toBeNull();
    expect(main().dataset.pageCount).toBe("1");
  });
});
