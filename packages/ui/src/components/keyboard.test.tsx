import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Switch } from "./switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Tooltip, TooltipProvider } from "./tooltip";

/**
 * Keyboard and ARIA contract of the shell primitives (ports the shell-relevant half of TeachDeck
 * `components/ui2/__tests__/keyboard.test.tsx`). Radix implements these; the tests pin that our
 * restyling and wrappers did not break them.
 */
afterEach(cleanup);

function Menu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Apple</DropdownMenuItem>
        <DropdownMenuItem>Banana</DropdownMenuItem>
        <DropdownMenuItem>Cherry</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu keyboard", () => {
  it("opens with the first item active; arrows wrap; Home/End jump; typeahead finds", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Apple" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Cherry" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Apple" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Cherry" })).toHaveFocus();
    await user.keyboard("b");
    expect(screen.getByRole("menuitem", { name: "Banana" })).toHaveFocus();
  });

  it("Escape closes and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe("Dialog keyboard", () => {
  function Modal() {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>Pick a new name.</DialogDescription>
          <Input aria-label="Name" />
          <Button>Save</Button>
        </DialogContent>
      </Dialog>
    );
  }

  it("is modal, labelled by its title, and focuses the first field", async () => {
    const user = userEvent.setup();
    render(<Modal />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog");
    // Radix makes the dialog modal by hiding everything outside it from assistive tech.
    expect(screen.getByRole("button", { name: "Open dialog", hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open dialog" })).toBeNull();
    const labelledBy = dialog.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(labelledBy)).toHaveTextContent("Rename");
    expect(document.activeElement?.tagName).toBe(
      screen.getByRole("textbox", { name: "Name" }).tagName,
    );
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
  });

  it("traps Tab and Shift+Tab inside, then returns focus to the opener on Escape", async () => {
    const user = userEvent.setup();
    render(<Modal />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog");

    // Field → Save → Close (X) → wraps to the field.
    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("nested: Escape closes the menu first and the dialog second", async () => {
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Outer</DialogTitle>
          <Menu />
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Tabs keyboard", () => {
  function Panels() {
    return (
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
          <TabsTrigger value="c">Gamma</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A panel</TabsContent>
        <TabsContent value="b">B panel</TabsContent>
        <TabsContent value="c">C panel</TabsContent>
      </Tabs>
    );
  }

  it("arrows move selection and focus and wrap; Home/End jump", async () => {
    const user = userEvent.setup();
    render(<Panels />);
    await user.click(screen.getByRole("tab", { name: "Alpha" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("B panel")).toBeVisible();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
  });

  it("uses a roving tabindex and links each tab to its panel", async () => {
    const user = userEvent.setup();
    render(<Panels />);
    await user.click(screen.getByRole("tab", { name: "Beta" }));
    // Exactly one tab is in the Tab order and it is the selected one (roving tabindex).
    const tabs = screen.getAllByRole("tab");
    const tabbable = tabs.filter((tab) => tab.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(tabbable[0]?.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel).toHaveTextContent("B panel");
  });
});

describe("Switch keyboard", () => {
  it("Space and Enter each toggle exactly once and it carries its name", async () => {
    const user = userEvent.setup();
    const onCheckedChange = mock();
    render(<Switch aria-label="Notifications" onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole("switch", { name: "Notifications" });
    toggle.focus();
    await user.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Enter}");
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

describe("Tooltip", () => {
  it("describes its trigger while shown and stops on Escape", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip label="Collapse">
          <Button>Toggle</Button>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Toggle" });
    await user.tab();
    const tip = await screen.findByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });
});

describe("Popover", () => {
  it("opens with haspopup, closes on Escape back to the trigger, and on outside click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <Popover>
          <PopoverTrigger asChild>
            <Button>Details</Button>
          </PopoverTrigger>
          <PopoverContent>Popover body</PopoverContent>
        </Popover>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Details" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(trigger);
    expect(screen.getByText("Popover body")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Popover body")).toBeNull());
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getByText("Popover body")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(screen.queryByText("Popover body")).toBeNull());
  });
});
