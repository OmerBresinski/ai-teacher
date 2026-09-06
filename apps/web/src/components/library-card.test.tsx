import { afterAll, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import type { DocumentSummary } from "@/mocks/library-schema";

const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
}));

const { LibraryCard } = await import("./library-card");

const lesson: DocumentSummary = {
  id: "lesson-1",
  kind: "lesson",
  title: "Water cycle",
  count: 7,
  updatedAt: "2026-09-06T11:00:00.000Z",
  createdAt: "2026-09-05T11:00:00.000Z",
  themeId: "chalk",
  yearGroup: "Year 4",
  subject: "Science",
};

function renderCard(doc = lesson, hero = false) {
  const onAction = mock();
  const onRename = mock();
  const result = render(
    <TooltipProvider>
      <LibraryCard
        doc={doc}
        hero={hero}
        now={new Date("2026-09-06T12:00:00.000Z").getTime()}
        onAction={onAction}
        onRename={onRename}
      />
    </TooltipProvider>,
  );
  return { ...result, onAction, onRename };
}

describe("LibraryCard", () => {
  it("has the required menu order and starts rename with F2", async () => {
    const { container, onRename } = renderCard();
    const article = container.querySelector("article");
    if (!article) throw new Error("Library card article is missing");
    fireEvent.keyDown(article, { key: "F2" });
    const input = await screen.findByRole("textbox", { name: "Rename Water cycle" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(lesson, "Renamed");

    const menuTrigger = screen.getAllByRole("button", { name: "More actions" })[0];
    if (!menuTrigger) throw new Error("Library card menu trigger is missing");
    fireEvent.pointerDown(menuTrigger, {
      button: 0,
      ctrlKey: false,
    });
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent?.trim()),
    ).toEqual(["Open", "Present", "Duplicate", "Export JSON", "RenameF2", "Delete"]);
  });

  it("uses Print for worksheet cards and has hero metadata", () => {
    const worksheet = { ...lesson, id: "worksheet-1", kind: "worksheet" as const, count: 4 };
    renderCard(worksheet);
    expect(screen.getByRole("button", { name: "Print" })).toBeVisible();

    renderCard(lesson, true);
    expect(screen.getAllByText(/7 slides/)).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Present" })).not.toHaveLength(0);
  });
});

afterAll(() => mock.restore());
