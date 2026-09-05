import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

describe("DropdownMenu", () => {
  it("selects keyboard items and exposes destructive menu semantics", async () => {
    const onSelect = mock();
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>One</DropdownMenuItem>
          <DropdownMenuItem>Two</DropdownMenuItem>
          <DropdownMenuItem onSelect={onSelect}>Three</DropdownMenuItem>
          <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
            Keep open
          </DropdownMenuItem>
          <DropdownMenuItem destructive>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.tab();
    await user.keyboard("{Enter}{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("text-destructive");
    await user.click(screen.getByRole("menuitem", { name: "Keep open" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
