import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("disables both actions while a confirmation is pending", async () => {
    let resolve!: () => void;
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        confirmLabel="Delete"
        onConfirm={() =>
          new Promise<void>((done) => {
            resolve = done;
          })
        }
        onOpenChange={() => {}}
        open
        title="Delete?"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => resolve());
  });
});
