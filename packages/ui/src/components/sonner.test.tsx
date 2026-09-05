import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
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
    const toastElement = screen.getByText("Deleted X").closest("[data-sonner-toast]");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    // happy-dom does not finish Sonner's exit animation, so assert its immediate dismissal state.
    await waitFor(() => expect(toastElement).toHaveAttribute("data-removed", "true"));
  });

  it("caps the visible stack at three toasts", async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <Toaster />
      </ThemeProvider>,
    );
    for (const label of ["One", "Two", "Three", "Four"]) toast(label);
    await screen.findByText("Four");
    await waitFor(() => {
      const toasts = document.querySelectorAll('[data-sonner-toast][data-visible="true"]');
      expect(toasts).toHaveLength(3);
    });
  });
});
