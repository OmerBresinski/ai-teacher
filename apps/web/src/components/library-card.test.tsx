import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

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

    const hero = renderCard(lesson, true);
    expect(hero.container.querySelector("article")).toHaveClass("col-span-2");
    expect(hero.container).toHaveTextContent(/7 slides.*Edited/);
    expect(screen.getAllByRole("button", { name: "Present" })).not.toHaveLength(0);
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
          <LibraryCard doc={lesson} view="list" now={0} onAction={() => {}} onRename={onRename} />
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
          <LibraryCard doc={lesson} view="list" now={0} onAction={() => {}} onRename={() => {}} />
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
