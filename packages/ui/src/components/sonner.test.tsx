import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { ThemeProvider } from "../theme/theme-provider";
import { Toaster, toast } from "./sonner";

describe("Toaster", () => {
  it("renders a toast action in the bottom-centre stack", async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <Toaster />
      </ThemeProvider>,
    );
    toast("Deleted X", { action: { label: "Undo", onClick: () => {} } });
    expect(await screen.findByText("Deleted X")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});
