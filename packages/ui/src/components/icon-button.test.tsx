import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Menu } from "lucide-react";

import { IconButton, IconGroup } from "./icon-button";
import { TooltipProvider } from "./tooltip";

describe("IconButton", () => {
  it("uses its required label for the accessible name and tooltip", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <IconButton label="Open menu">
          <Menu aria-hidden />
        </IconButton>
      </TooltipProvider>,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveClass("size-8");
    expect(await screen.findByText("Open menu")).toBeInTheDocument();
  });

  it("groups icon controls semantically", () => {
    render(
      <IconGroup aria-label="View controls">
        <button type="button">A</button>
      </IconGroup>,
    );
    expect(screen.getByRole("group", { name: "View controls" })).toHaveClass("rounded-control");
  });
});
