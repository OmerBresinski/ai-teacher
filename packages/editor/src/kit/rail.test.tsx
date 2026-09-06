import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import { Rail, RailButton, RailSeparator } from "./Rail";
import { nextStep } from "./ZoomControl";

afterEach(cleanup);

describe("Rail", () => {
  test("is a vertical toolbar with named 40px buttons", () => {
    render(
      <TooltipProvider>
        <Rail aria-label="Insert">
          <RailButton label="Text">T</RailButton>
          <RailSeparator />
          <RailButton label="Shape" active>
            S
          </RailButton>
        </Rail>
      </TooltipProvider>,
    );
    const bar = screen.getByRole("toolbar", { name: "Insert" });
    expect(bar).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByRole("button", { name: "Text" })).toHaveClass("size-10");
    expect(screen.getByRole("button", { name: "Shape" })).toHaveClass("text-primary");
  });
});

describe("ZoomControl steps", () => {
  test("walk the stops in either direction and clamp", () => {
    const steps = [0.5, 1, 2];
    expect(nextStep(steps, 1, 1)).toBe(2);
    expect(nextStep(steps, 1, -1)).toBe(0.5);
    expect(nextStep(steps, 0.72, 1)).toBe(1);
    expect(nextStep(steps, 0.72, -1)).toBe(0.5);
    expect(nextStep(steps, 2, 1)).toBe(2);
    expect(nextStep([], 1, 1)).toBe(1);
  });
});
