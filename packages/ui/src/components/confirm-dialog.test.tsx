import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

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

  it("closes on resolve and remains open after rejection", async () => {
    const user = userEvent.setup();
    function Harness({ reject = false }: { reject?: boolean }) {
      const [open, setOpen] = useState(true);
      return (
        <ConfirmDialog
          confirmLabel="Delete"
          onConfirm={() => (reject ? Promise.reject(new Error("no")) : Promise.resolve())}
          onOpenChange={setOpen}
          open={open}
          title="Delete?"
        />
      );
    }
    const resolved = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    resolved.unmount();
    render(<Harness reject />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled();
  });
});
