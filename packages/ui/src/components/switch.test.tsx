import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Switch } from "./switch";

describe("Switch", () => {
  it("toggles aria-checked and the primary checked state", async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Publish" />);
    await user.click(screen.getByRole("switch", { name: "Publish" }));
    expect(screen.getByRole("switch", { name: "Publish" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Publish" })).toHaveClass(
      "data-[state=checked]:bg-primary",
    );
  });
});
