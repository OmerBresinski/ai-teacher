import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Popover, PopoverContent } from "./popover";

describe("Popover", () => {
  it("renders an elevated card surface", () => {
    render(
      <Popover open>
        <PopoverContent>Options</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText("Options")).toHaveClass("rounded-card", "shadow-2");
  });
});
