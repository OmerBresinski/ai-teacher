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
});
