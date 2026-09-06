import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewSeriesDialog } from "./new-series-dialog";

afterEach(cleanup);

describe("NewSeriesDialog", () => {
  it("submits the blank title fallback on Enter", async () => {
    const onCreate = mock();
    render(<NewSeriesDialog open onOpenChange={() => {}} onCreate={onCreate} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "Title" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Untitled series"));
  });

  it("disables actions and blocks Escape and outside clicks while creation is pending", async () => {
    const user = userEvent.setup();
    const onOpenChange = mock();
    const onCreate = () => new Promise<void>(() => {});
    render(<NewSeriesDialog open onOpenChange={onOpenChange} onCreate={onCreate} />);

    await user.click(screen.getByRole("button", { name: "Create series" }));

    expect(screen.getByRole("button", { name: "Create series" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.keyboard("{Escape}");
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
