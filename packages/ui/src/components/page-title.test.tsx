import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageTitle } from "./page-title";
import { TooltipProvider } from "./tooltip";

describe("PageTitle", () => {
  it("commits a trimmed changed title on Enter", async () => {
    const user = userEvent.setup();
    const onCommit = mock();
    render(
      <TooltipProvider>
        <PageTitle label="Title" renameLabel="Rename lesson" onCommit={onCommit}>
          Lesson one
        </PageTitle>
      </TooltipProvider>,
    );

    await user.dblClick(screen.getByRole("heading", { name: "Lesson one" }));
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), " New ");
    await user.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledWith("New");
  });

  it("starts renaming on F2 from the focused heading and selects the text", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <PageTitle label="Title" renameLabel="Rename lesson" onCommit={() => {}}>
          Lesson one
        </PageTitle>
      </TooltipProvider>,
    );

    screen.getByRole("heading", { name: "Lesson one" }).focus();
    await user.keyboard("{F2}");

    const input = screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionEnd).toBe("Lesson one".length);
  });

  it("does not commit Escape, empty, or unchanged titles", async () => {
    const user = userEvent.setup();
    const onCommit = mock();
    render(
      <TooltipProvider>
        <PageTitle label="Title" renameLabel="Rename lesson" onCommit={onCommit}>
          Lesson one
        </PageTitle>
      </TooltipProvider>,
    );

    await user.dblClick(screen.getByRole("heading", { name: "Lesson one" }));
    await user.keyboard("{Escape}");
    await user.dblClick(screen.getByRole("heading", { name: "Lesson one" }));
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.keyboard("{Enter}");
    await user.dblClick(screen.getByRole("heading", { name: "Lesson one" }));
    await user.keyboard("{Enter}");

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on blur and stops Enter/Escape reaching the page behind it", async () => {
    const user = userEvent.setup();
    const onCommit = mock();
    const pageKeyDown = mock();
    render(
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: test harness listening for bubbled keys
      // biome-ignore lint/a11y/noStaticElementInteractions: same
      <div onKeyDown={pageKeyDown}>
        <TooltipProvider>
          <PageTitle label="Title" renameLabel="Rename lesson" onCommit={onCommit}>
            Lesson one
          </PageTitle>
          <button type="button">Elsewhere</button>
        </TooltipProvider>
      </div>,
    );

    await user.dblClick(screen.getByRole("heading", { name: "Lesson one" }));
    const input = screen.getByRole("textbox", { name: "Title" });
    await user.clear(input);
    await user.type(input, "Blurred{Escape}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(pageKeyDown.mock.calls.some(([e]) => e.key === "Escape")).toBe(false);

    await user.dblClick(screen.getByRole("heading", { name: "Lesson one" }));
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Blurred");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onCommit).toHaveBeenCalledWith("Blurred");
  });
});
