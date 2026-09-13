import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useState } from "react";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";

/** A dialog controlled from a plain button, the shape most of the app's dialogs take. */
function Controlled({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  // TEACH-113: Radix returns focus to a `DialogTrigger` only; a controlled dialog opened from a
  // plain button dropped focus on <body> (the Theme, Help and New series dialogs).
  it("a controlled dialog with no DialogTrigger returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("a caller's onCloseAutoFocus that prevents default keeps its own focus target", async () => {
    const user = userEvent.setup();
    render(
      <Controlled
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          screen.getByRole("button", { name: "Elsewhere" }).focus();
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("keeps a non-dismissible dialog open and applies its size", async () => {
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen>
        <DialogContent dismissible={false} size="sm">
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toHaveClass("max-w-[360px]");
    expect(screen.getByRole("dialog")).toHaveClass("-translate-x-1/2", "-translate-y-1/2");
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
