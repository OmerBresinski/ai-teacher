import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("toggles through Radix semantics", async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Publish" />);
    await user.click(screen.getByRole("checkbox", { name: "Publish" }));
    expect(screen.getByRole("checkbox", { name: "Publish" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });
});
