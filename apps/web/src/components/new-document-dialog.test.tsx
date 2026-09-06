import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewDocumentDialog } from "./new-document-dialog";

function renderDialog(onCreate = mock()) {
  return render(
    <NewDocumentDialog open onOpenChange={() => {}} kind="lesson" onCreate={onCreate} />,
  );
}

afterEach(cleanup);

describe("NewDocumentDialog", () => {
  it("advances on Enter in the title and preserves every About value when returning", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Water");
    await user.type(screen.getByRole("textbox", { name: "Subject" }), "Science");
    // Implicit form submission: Enter inside the input, not a synthetic submit event.
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Choose a theme" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Water");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("Science");
    expect(screen.getByRole("heading", { name: "New lesson" })).toBeVisible();
  });

  it("offers EYFS then Year 1 to Year 13 as year groups", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("combobox", { name: "Year group" }));
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["EYFS", ...Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`)]);
  });

  it("blocks Escape and outside clicks while creation is pending", async () => {
    const user = userEvent.setup();
    const onOpenChange = mock();
    render(
      <NewDocumentDialog
        open
        onOpenChange={onOpenChange}
        kind="lesson"
        onCreate={() => new Promise<void>(() => {})}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Create lesson" }));
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    await user.keyboard("{Escape}");
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
