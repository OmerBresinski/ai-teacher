import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewDocumentDialog } from "./new-document-dialog";

function renderDialog(onCreate = mock()) {
  return render(
    <NewDocumentDialog open onOpenChange={() => {}} kind="lesson" onCreate={onCreate} />,
  );
}

afterEach(cleanup);

describe("NewDocumentDialog", () => {
  it("advances on Enter and preserves About values when returning", () => {
    renderDialog();

    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "Water" } });
    const form = title.closest("form");
    if (!form) throw new Error("New document form is missing");
    fireEvent.submit(form);
    expect(screen.getByRole("heading", { name: "Choose a theme" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Water");
  });

  it("uses the defaults and passes trimmed values to onCreate", async () => {
    const onCreate = mock();
    renderDialog(onCreate);

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "  Water  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: "Playground" }));
    fireEvent.click(screen.getByRole("tab", { name: "Blank" }));
    fireEvent.click(screen.getByRole("button", { name: "Create lesson" }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        title: "Water",
        themeId: "playground",
        yearGroup: undefined,
        subject: undefined,
        readingLevel: undefined,
        language: "en-GB",
        start: "blank",
      }),
    );
  });

  it("uses an untitled lesson when title is blank", async () => {
    const onCreate = mock();
    renderDialog(onCreate);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create lesson" }));

    await waitFor(() => expect(onCreate.mock.calls[0]?.[0]?.title).toBe("Untitled lesson"));
  });

  it("filters themes and clears a selection excluded by the filter", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: "Playground" }));
    fireEvent.click(screen.getByRole("tab", { name: "Calm" }));

    expect(screen.queryByRole("radio", { name: "Playground" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create lesson" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Chalk & Cream" })).toBeVisible();
  });
});
