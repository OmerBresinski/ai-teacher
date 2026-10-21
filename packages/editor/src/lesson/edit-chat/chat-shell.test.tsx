import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SendArrow } from "./ChatThread";
import { ChatPaneShell } from "./EditChatPane";

afterEach(cleanup);

describe("the edit chat before its chunk lands (TEACH-104 part d)", () => {
  test("loading, the pane shell has the header's close button and no alert", () => {
    const onClose = mock(() => undefined);
    const { container } = render(<ChatPaneShell onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close Edit with Dayback" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      container.querySelector("[data-edit-chat-shell]")?.getAttribute("data-edit-chat-shell"),
    ).toBe("loading");
  });

  test("failed, the pane says so, offers a retry and can still be closed", () => {
    const onClose = mock(() => undefined);
    const onRetry = mock(() => undefined);
    render(<ChatPaneShell onClose={onClose} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("The chat didn't load.");
    fireEvent.click(screen.getByRole("button", { name: "Couldn't load. Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Edit with Dayback" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the inline send arrow keeps lucide's arrow-up drawing", () => {
    const { container } = render(<SendArrow />);
    const paths = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(paths).toEqual(["m5 12 7-7 7 7", "M12 19V5"]);
    expect(container.querySelector("svg")?.getAttribute("stroke-width")).toBe("2.25");
  });
});
