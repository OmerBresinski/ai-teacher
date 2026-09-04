import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Save lesson</Button>);
    expect(screen.getByRole("button", { name: "Save lesson" })).toBeInTheDocument();
  });

  it("forwards onClick", async () => {
    const user = userEvent.setup();
    const onClick = mock();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is focusable via keyboard", async () => {
    const user = userEvent.setup();
    render(<Button>Focus me</Button>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Focus me" })).toHaveFocus();
  });

  it('defaults to type="button" and lets callers override it', () => {
    render(
      <>
        <Button>Default</Button>
        <Button type="submit">Submit</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("type", "submit");
  });

  it("applies variant/size data attributes and merges className", () => {
    render(
      <Button variant="outline" size="sm" className="w-full">
        Outline
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Outline" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveAttribute("data-variant", "outline");
    expect(button).toHaveAttribute("data-size", "sm");
    expect(button).toHaveClass("w-full");
    expect(button).toHaveClass("motion-safe:transition-all");
  });

  it("renders the child element with asChild and does not force type", () => {
    render(
      <Button asChild>
        <a href="/journeys">Journeys</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Journeys" });
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link).not.toHaveAttribute("type");
  });

  it("is not clickable when disabled", async () => {
    const user = userEvent.setup();
    const onClick = mock();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Disabled" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
