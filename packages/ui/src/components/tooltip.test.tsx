import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tooltip, TooltipProvider } from "./tooltip";

describe("Tooltip", () => {
  it("shows a label and keyboard shortcut after focus", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip label="Save" shortcut="Cmd S">
          <button type="button">Save</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect(await screen.findByText("Cmd S")).toBeInTheDocument();
  });

  it("forwards its ref to the Radix trigger", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <TooltipProvider>
        <Tooltip label="Save" ref={ref}>
          <button type="button">Save</button>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(ref.current).toBe(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement);
  });
});
