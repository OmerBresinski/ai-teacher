import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

/*
 * ADR 0022 §3: a surface opened from present mode's stage carries `tj-stage` itself, because a
 * portal leaves the stage subtree. These assert the class lands on the portalled Radix content
 * node (the element with the role), not on a wrapper inside it.
 */
describe("stage className on portalled content", () => {
  it("DropdownMenuContent", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent className="tj-stage">
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("menu")).toHaveClass("tj-stage");
  });

  it("PopoverContent", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent className="tj-stage">Body</PopoverContent>
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("dialog")).toHaveClass("tj-stage");
  });

  it("DialogContent and AlertDialogContent", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Dialog>
          <DialogTrigger>Dialog</DialogTrigger>
          <DialogContent className="tj-stage">
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
        <AlertDialog>
          <AlertDialogTrigger>Alert</AlertDialogTrigger>
          <AlertDialogContent className="tj-stage">
            <AlertDialogTitle>Sure?</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Dialog" }));
    expect(await screen.findByRole("dialog")).toHaveClass("tj-stage");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Alert" }));
    expect(await screen.findByRole("alertdialog")).toHaveClass("tj-stage");
  });

  it("TooltipContent", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <TooltipPrimitive.Root>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent className="tj-stage">Tip</TooltipContent>
        </TooltipPrimitive.Root>
      </TooltipProvider>,
    );
    await user.hover(screen.getByRole("button", { name: "Hover" }));
    const tooltip = await screen.findByRole("tooltip");
    // Radix renders the role on an inner node; the styled Content is its closest slot ancestor.
    expect(tooltip.closest('[data-slot="tooltip-content"]')).toHaveClass("tj-stage");
  });

  it("SelectContent", async () => {
    const user = userEvent.setup();
    render(
      <Select>
        <SelectTrigger aria-label="Pick">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent className="tj-stage">
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
    await user.click(screen.getByRole("combobox", { name: "Pick" }));
    const listbox = await screen.findByRole("listbox");
    expect(listbox.closest('[data-slot="select-content"]')).toHaveClass("tj-stage");
  });
});
