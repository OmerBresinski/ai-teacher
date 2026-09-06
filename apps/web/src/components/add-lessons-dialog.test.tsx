import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DocumentSummary } from "@/mocks/library-schema";
import { AddLessonsDialog } from "./add-lessons-dialog";

afterEach(cleanup);

const candidates: DocumentSummary[] = ["One", "Two", "Three"].map((title, index) => ({
  id: `lesson-${index + 1}`,
  kind: "lesson",
  title,
  count: 4,
  updatedAt: "2026-09-06T12:00:00.000Z",
  createdAt: "2026-09-06T12:00:00.000Z",
  themeId: "chalk",
  yearGroup: "Year 4",
  subject: "Science",
}));

describe("AddLessonsDialog", () => {
  it("labels the selection count and submits candidates in their listed order", async () => {
    const onAdd = mock();
    render(
      <AddLessonsDialog
        open
        onOpenChange={() => {}}
        candidates={candidates}
        hasLessons
        onAdd={onAdd}
      />,
    );

    fireEvent.click(screen.getByLabelText("Three"));
    fireEvent.click(screen.getByLabelText("One"));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 lessons" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(["lesson-1", "lesson-3"]));
  });

  it("distinguishes empty libraries, exhausted candidates, and search misses", () => {
    const { rerender } = render(
      <AddLessonsDialog
        open
        onOpenChange={() => {}}
        candidates={[]}
        hasLessons={false}
        onAdd={() => {}}
      />,
    );
    expect(screen.getByText("No lessons yet")).toBeVisible();
    expect(screen.getByText("Make one in the library first.")).toBeVisible();

    rerender(
      <AddLessonsDialog open onOpenChange={() => {}} candidates={[]} hasLessons onAdd={() => {}} />,
    );
    expect(screen.getByText("No lessons left to add")).toBeVisible();

    rerender(
      <AddLessonsDialog
        open
        onOpenChange={() => {}}
        candidates={candidates}
        hasLessons
        onAdd={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search titles" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("Nothing matches that")).toBeVisible();
  });
});
