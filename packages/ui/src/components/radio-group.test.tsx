import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RadioGroup, RadioGroupItem } from "./radio-group";

describe("RadioGroup", () => {
  it("provides exclusive radio semantics", async () => {
    const user = userEvent.setup();
    render(
      <RadioGroup>
        <RadioGroupItem aria-label="One" value="one" />
        <RadioGroupItem aria-label="Two" value="two" />
      </RadioGroup>,
    );
    await user.click(screen.getByRole("radio", { name: "Two" }));
    expect(screen.getByRole("radio", { name: "Two" })).toHaveAttribute("data-state", "checked");
  });
});
