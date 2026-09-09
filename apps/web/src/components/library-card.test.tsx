import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentSummary } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";

const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
}));

const { LibraryCard, minutesForMarks, worksheetEffort } = await import("./library-card");

afterEach(cleanup);

const lesson: DocumentSummary = {
  id: "lesson-1",
  kind: "lesson",
  title: "Water cycle",
  itemCount: 7,
  updatedAt: "2026-09-06T11:00:00.000Z",
  createdAt: "2026-09-05T11:00:00.000Z",
  themeId: "chalk",
  cover: null,
  yearGroup: "Year 4",
  subject: "Science",
};

function renderCard(doc = lesson, hero = false) {
  const onAction = mock();
  const onRename = mock();
  const result = render(
    <TooltipProvider>
      <LibraryCard doc={doc} hero={hero} onAction={onAction} onRename={onRename} />
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

  it("shows the kind glyph with its name in a tooltip, above the cover link", async () => {
    const user = userEvent.setup();
    const { container } = renderCard();
    const glyph = container.querySelector("svg.lucide-presentation");
    expect(glyph).not.toBeNull();
    expect(glyph?.parentElement).toHaveClass("z-2");
    await user.hover(glyph as Element);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Lesson");

    renderCard({ ...lesson, id: "worksheet-1", kind: "worksheet" });
    expect(document.querySelector("svg.lucide-file-text")).not.toBeNull();
  });

  it("uses Print for worksheet cards and has hero metadata", () => {
    const worksheet = { ...lesson, id: "worksheet-1", kind: "worksheet" as const, itemCount: 4 };
    renderCard(worksheet);
    expect(screen.getByRole("button", { name: "Print" })).toBeVisible();
    cleanup();

    const hero = renderCard(lesson, true);
    expect(hero.container.querySelector("article")).toHaveClass("col-span-2");
    expect(hero.container).toHaveTextContent(/7 slides.*Edited/);
    expect(screen.getAllByRole("button", { name: "Present" })).not.toHaveLength(0);
  });

  it("shows marks and minutes on worksheet cards, in the grid, the list and the hero (TEACH-186)", () => {
    // A mark and a half each, up to the next five minutes, never under five.
    expect(minutesForMarks(0)).toBe(5);
    expect(minutesForMarks(1)).toBe(5);
    expect(minutesForMarks(4)).toBe(10);
    expect(minutesForMarks(12)).toBe(20);
    expect(worksheetEffort({ kind: "worksheet", marks: 4 })).toBe("4 marks · 10 min");
    expect(worksheetEffort({ kind: "worksheet", marks: 1 })).toBe("1 mark · 5 min");
    expect(worksheetEffort({ kind: "worksheet", marks: 0 })).toBe("5 min");
    expect(worksheetEffort({ kind: "lesson" })).toBeNull();

    const worksheet = { ...lesson, id: "w1", kind: "worksheet" as const, itemCount: 9, marks: 4 };
    const grid = renderCard(worksheet);
    expect(grid.container).toHaveTextContent("4 marks · 10 min");
    expect(grid.container).not.toHaveTextContent("9 blocks");
    cleanup();

    const hero = renderCard(worksheet, true);
    expect(hero.container).toHaveTextContent(/4 marks · 10 min.*Edited/);
    cleanup();

    const list = render(
      <TooltipProvider>
        <table>
          <tbody>
            <LibraryCard doc={worksheet} view="list" onAction={mock()} onRename={mock()} />
          </tbody>
        </table>
      </TooltipProvider>,
    );
    expect(screen.getByText("4 marks · 10 min")).toBeVisible();
    // The list thumbnail opens the sheet like the title, out of the tab order and the a11y tree.
    const anchors = list.container.querySelectorAll("a");
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toHaveAttribute("aria-hidden", "true");
    expect(anchors[0]).toHaveAttribute("tabindex", "-1");
    expect(anchors[0]).not.toHaveAttribute("aria-label");
    expect(anchors[1]).toHaveAttribute("aria-label", "Open Water cycle");
    cleanup();

    // A lesson keeps its slide count.
    const lessonCard = renderCard(lesson, true);
    expect(lessonCard.container).toHaveTextContent("7 slides");
  });

  it("handles inline rename lifecycle in grid and list views", async () => {
    const { container, onRename } = renderCard();
    const article = container.querySelector("article");
    if (!article) throw new Error("Library card article is missing");
    const cover = container.querySelector("a[aria-label='Open Water cycle']");
    if (!cover) throw new Error("Library card cover link is missing");

    fireEvent.doubleClick(article);
    const input = await screen.findByRole("textbox", { name: "Rename Water cycle" });
    expect(cover).toHaveAttribute("hidden");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(cover).not.toHaveAttribute("hidden");
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.keyDown(article, { key: "F2" });
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Changed" } });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onRename).toHaveBeenCalledWith(lesson, "Changed");

    cleanup();
    const list = render(
      <table>
        <tbody>
          <LibraryCard doc={lesson} view="list" onAction={() => {}} onRename={onRename} />
        </tbody>
      </table>,
    );
    const titleLink = list.container.querySelector("a[aria-label='Open Water cycle']");
    if (!titleLink) throw new Error("List title link is missing");
    fireEvent.doubleClick(titleLink);
    expect(await screen.findAllByRole("textbox")).not.toHaveLength(0);
  });

  it("renders worksheet and destructive menu semantics plus list row actions", async () => {
    const worksheet = { ...lesson, kind: "worksheet" as const };
    const { container } = renderCard(worksheet);
    const trigger = screen.getAllByRole("button", { name: "More actions" })[0];
    if (!trigger) throw new Error("Library card menu trigger is missing");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.queryByRole("menuitem", { name: "Present" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
    expect(container.querySelector("article")?.className).not.toContain("col-span-2");

    cleanup();
    const list = render(
      <table>
        <tbody>
          <LibraryCard doc={lesson} view="list" onAction={() => {}} onRename={() => {}} />
        </tbody>
      </table>,
    );
    const listTitle = list.container.querySelector("a[aria-label='Open Water cycle']");
    if (!listTitle) throw new Error("List title link is missing");
    expect(listTitle).toBeVisible();
    expect(list.container.querySelector("tr > td:last-child > div")?.className).toContain(
      "group-hover/row:opacity-100",
    );
  });
});

afterAll(() => mock.restore());
