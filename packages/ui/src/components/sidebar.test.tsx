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
  it("cycles focus without activating enabled items and skips disabled items", async () => {
    const user = userEvent.setup();
    const onHome = mock();
    const onLessons = mock();
    const onDisabled = mock();
    const onShortcuts = mock();
    render(
      <TooltipProvider>
        <Sidebar aria-label="Library" wordmark="TeachDeck">
          <SidebarItem icon={<Home aria-hidden />} onClick={onHome}>
            Home
          </SidebarItem>
          <SidebarItem icon={<Home aria-hidden />} onClick={onLessons}>
            Lessons
          </SidebarItem>
          <SidebarItem icon={<Home aria-hidden />} disabled onClick={onDisabled}>
            Disabled
          </SidebarItem>
          <SidebarItem icon={<Home aria-hidden />} onClick={onShortcuts}>
            Shortcuts
          </SidebarItem>
        </Sidebar>
      </TooltipProvider>,
    );
    const home = screen.getByRole("button", { name: "Home" });
    const lessons = screen.getByRole("button", { name: "Lessons" });
    const shortcuts = screen.getByRole("button", { name: "Shortcuts" });

    home.focus();
    await user.keyboard("{ArrowDown}");
    expect(lessons).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(shortcuts).toHaveFocus();
    await user.keyboard("{Home}");
    expect(home).toHaveFocus();
    await user.keyboard("{End}");
    expect(shortcuts).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(home).toHaveFocus();

    for (const item of [home, lessons, shortcuts]) {
      expect([null, "0"]).toContain(item.getAttribute("tabindex"));
    }
    expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute("tabindex", "-1");
    expect(onHome).not.toHaveBeenCalled();
    expect(onLessons).not.toHaveBeenCalled();
    expect(onDisabled).not.toHaveBeenCalled();
    expect(onShortcuts).not.toHaveBeenCalled();
  });

  it("renders asChild as an anchor and includes it in arrow navigation", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Sidebar aria-label="Library" wordmark="TeachDeck">
          <SidebarItem asChild icon={<Home aria-hidden />}>
            <a href="/x">Linked lessons</a>
          </SidebarItem>
          <SidebarItem icon={<Home aria-hidden />}>Worksheets</SidebarItem>
        </Sidebar>
      </TooltipProvider>,
    );
    const link = screen.getByRole("link", { name: "Linked lessons" });

    expect(link).toHaveAttribute("href", "/x");
    expect(link).toHaveAttribute("data-sidebar-item");
    link.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Worksheets" })).toHaveFocus();
  });

  it("makes disabled links unfocusable and prevents navigation", async () => {
    const user = userEvent.setup();
    let asChildPrevented = false;
    let hrefPrevented = false;
    render(
      <TooltipProvider>
        <Sidebar aria-label="Library" wordmark="TeachDeck">
          <SidebarItem
            asChild
            disabled
            icon={<Home aria-hidden />}
            onClick={(event) => {
              asChildPrevented = event.defaultPrevented;
            }}
          >
            <a href="/disabled-child">Disabled child link</a>
          </SidebarItem>
          <SidebarItem
            href="/disabled-href"
            disabled
            icon={<Home aria-hidden />}
            onClick={(event) => {
              hrefPrevented = event.defaultPrevented;
            }}
          >
            Disabled href link
          </SidebarItem>
        </Sidebar>
      </TooltipProvider>,
    );
    const childLink = screen.getByRole("link", { name: "Disabled child link" });
    const hrefLink = screen.getByRole("link", { name: "Disabled href link" });

    for (const link of [childLink, hrefLink]) {
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).toHaveAttribute("tabindex", "-1");
      await user.click(link);
    }
    expect(asChildPrevented).toBe(true);
    expect(hrefPrevented).toBe(true);
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

  it("composes a caller's onKeyDown with keyboard navigation", async () => {
    const user = userEvent.setup();
    const onKeyDown = mock();
    render(
      <TooltipProvider>
        <Sidebar aria-label="Library" onKeyDown={onKeyDown}>
          <SidebarItem icon={<Home size={16} />}>Home</SidebarItem>
          <SidebarItem icon={<Home size={16} />}>Lessons</SidebarItem>
        </Sidebar>
      </TooltipProvider>,
    );

    screen.getByRole("button", { name: "Home" }).focus();
    await user.keyboard("{ArrowDown}");

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Lessons" })).toHaveFocus();
  });
});
