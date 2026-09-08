import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { ActionBar } from "./action-bar";
import { Button } from "./button";

describe("ActionBar", () => {
  it("renders the primary first, the quiet actions after it and the trailing slot on the right", () => {
    render(
      <ActionBar primary={<Button size="lg">Continue</Button>} trailing={<span>Enter</span>}>
        <Button variant="ghost">Back</Button>
      </ActionBar>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Continue", "Back"]);
    const bar = buttons[0]?.parentElement;
    expect(bar).toHaveAttribute("data-slot", "action-bar");
    expect(bar).toHaveClass("sticky");
    expect(screen.getByText("Enter").parentElement).toHaveClass("ml-auto");
  });

  it("can sit in flow", () => {
    render(<ActionBar primary={<Button>Save</Button>} sticky={false} />);
    expect(screen.getByRole("button").parentElement).not.toHaveClass("sticky");
  });
});
