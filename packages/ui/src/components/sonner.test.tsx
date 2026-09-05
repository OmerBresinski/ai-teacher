import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeProvider } from "../theme/theme-provider";
import { Toaster, toast } from "./sonner";

describe("Toaster", () => {
  it("runs Undo and dismisses its toast", async () => {
    const onClick = mock();
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="light">
        <Toaster />
      </ThemeProvider>,
    );
    toast("Deleted X", { action: { label: "Undo", onClick } });
    expect(await screen.findByText("Deleted X")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Deleted X")).toBeInTheDocument();
  });

  it("caps the visible stack at three toasts", async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <Toaster />
      </ThemeProvider>,
    );
    for (const label of ["One", "Two", "Three", "Four"]) toast(label);
    await screen.findByText("Four");
    expect(screen.getAllByText(/One|Two|Three|Four/)).toHaveLength(4);
  });
});
