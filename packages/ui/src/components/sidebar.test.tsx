import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home } from "lucide-react";

import { Sidebar, SidebarItem } from "./sidebar";
import { TooltipProvider } from "./tooltip";

function Navigation({
  collapsed,
  onCollapsedChange,
}: {
  collapsed?: boolean;
  onCollapsedChange?: (value: boolean) => void;
}) {
  return (
    <TooltipProvider>
      <Sidebar
        aria-label="Library"
        wordmark="TeachDeck"
        mark="T"
        {...(collapsed === undefined ? {} : { collapsed })}
        onCollapsedChange={onCollapsedChange}
        foot={
          <>
            <SidebarItem icon={<Home aria-hidden />}>Import</SidebarItem>
            <SidebarItem icon={<Home aria-hidden />}>Shortcuts</SidebarItem>
          </>
        }
      >
        <SidebarItem icon={<Home aria-hidden />} active>
          Home
        </SidebarItem>
        <SidebarItem icon={<Home aria-hidden />}>Lessons</SidebarItem>
        <SidebarItem icon={<Home aria-hidden />}>Worksheets</SidebarItem>
        <SidebarItem icon={<Home aria-hidden />}>Series</SidebarItem>
      </Sidebar>
    </TooltipProvider>
  );
}

describe("Sidebar", () => {
  it("cycles navigation focus through main and foot items without changing the tab order", async () => {
    const user = userEvent.setup();
    render(<Navigation />);
    const home = screen.getByRole("button", { name: "Home" });
    const shortcuts = screen.getByRole("button", { name: "Shortcuts" });

    home.focus();
    await user.keyboard("{ArrowUp}");
    expect(shortcuts).toHaveFocus();
    await user.keyboard("{Home}");
    expect(home).toHaveFocus();
    await user.keyboard("{End}");
    expect(shortcuts).toHaveFocus();
    expect(home).not.toHaveAttribute("tabindex", "-1");
  });

  it("uses collapsed markup, tooltip labels, and the collapsed width", async () => {
    const user = userEvent.setup();
    render(<Navigation collapsed />);
    const home = screen.getByRole("button", { name: "Home" });

    expect(screen.getByRole("navigation", { name: "Library" }).getAttribute("style")).toContain(
      "var(--sidebar-width-collapsed)",
    );
    expect(home.querySelector(".sr-only")).toHaveTextContent("Home");
    await user.hover(home);
    expect(await screen.findByText("Home")).toBeInTheDocument();
  });

  it("supports controlled and uncontrolled collapsing", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = mock();
    const { rerender } = render(<Navigation onCollapsedChange={onCollapsedChange} />);
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

    rerender(<Navigation collapsed onCollapsedChange={onCollapsedChange} />);
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("marks the active item as the current page", () => {
    render(<Navigation />);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Home" })).toHaveClass("bg-brand-quiet");
  });
});
