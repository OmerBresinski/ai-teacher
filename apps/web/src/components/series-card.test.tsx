import { afterAll, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import type { SeriesWithLessons } from "@/mocks/library-schema";

const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => mock(),
}));

const { SeriesCard } = await import("./series-card");

const item: SeriesWithLessons = {
  series: {
    id: "series-1",
    title: "Water unit",
    lessonIds: ["lesson-1", "lesson-2", "lesson-3"],
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-06T11:00:00.000Z",
  },
  lessons: ["One", "Two", "Three"].map((title, index) => ({
    id: `lesson-${index + 1}`,
    kind: "lesson" as const,
    title,
    count: 4,
    updatedAt: "2026-09-06T11:00:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
    themeId: "chalk",
    yearGroup: "Year 4",
  })),
};

function renderCard(value = item) {
  const onAction = mock();
  return render(
    <TooltipProvider>
      <SeriesCard item={value} onAction={onAction} onRename={() => {}} />
    </TooltipProvider>,
  );
}

describe("SeriesCard", () => {
  it("shows a stack of up to three thumbnails and the required menu order", async () => {
    const { container } = renderCard();
    expect(container.querySelectorAll("[aria-hidden]").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("list")).toBeVisible();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      (await screen.findAllByRole("menuitem")).map((menuItem) => menuItem.textContent?.trim()),
    ).toEqual(["Present series", "RenameF2", "Duplicate", "Delete"]);
  });

  it("caps the stack at three sheets with the documented transforms", () => {
    const firstLesson = item.lessons[0];
    if (!firstLesson) throw new Error("Series needs a lesson");
    const fourLessons = [...item.lessons, { ...firstLesson, id: "lesson-4", title: "Four" }];
    const { container } = renderCard({ ...item, lessons: fourLessons });
    const sheets = container.querySelectorAll("[style*='rotate']");
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toHaveAttribute("style", expect.stringContaining("rotate(-4deg)"));
    expect(sheets[1]).toHaveAttribute("style", expect.stringContaining("rotate(3.5deg)"));
  });

  it("hides the primary Present series action when there are no lessons", () => {
    renderCard({ ...item, series: { ...item.series, lessonIds: [] }, lessons: [] });
    expect(screen.queryByRole("button", { name: "Present series" })).not.toBeInTheDocument();
  });

  it("delegates Present series through the page action", () => {
    const onAction = mock();
    render(
      <TooltipProvider>
        <SeriesCard item={item} onAction={onAction} onRename={() => {}} />
      </TooltipProvider>,
    );

    screen.getByRole("button", { name: "Present series" }).click();
    expect(onAction).toHaveBeenCalledWith("present", item);
  });
});

afterAll(() => mock.restore());
