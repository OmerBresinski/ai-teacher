import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewSeriesDialog } from "./new-series-dialog";

afterEach(cleanup);

describe("NewSeriesDialog", () => {
  it("submits the blank title fallback on Enter", async () => {
    const onCreate = mock();
    render(<NewSeriesDialog open onOpenChange={() => {}} onCreate={onCreate} />);

    const form = screen.getByRole("textbox", { name: "Title" }).closest("form");
    if (!form) throw new Error("New series form is missing");
    fireEvent.submit(form);

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Untitled series"));
  });

  it("disables actions while creation is pending", () => {
    const onCreate = () => new Promise<void>(() => {});
    render(<NewSeriesDialog open onOpenChange={() => {}} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "Create series" }));

    expect(screen.getByRole("button", { name: "Create series" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
