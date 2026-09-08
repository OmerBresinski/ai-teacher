import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StepRail } from "./step-rail";

const STEPS = [
  { id: "a", label: "Objectives" },
  { id: "b", label: "Shape" },
  { id: "c", label: "Words" },
];

describe("StepRail", () => {
  it("is a nav with aria-current on the current step and an N of M line", () => {
    render(<StepRail steps={STEPS} current="b" done={["a"]} aria-label="Plan steps" />);
    const nav = screen.getByRole("navigation", { name: "Plan steps" });
    expect(nav).toHaveTextContent("2 of 3");
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[0]).toHaveTextContent("done");
  });

  it("makes completed steps buttons only when onSelect is given", async () => {
    const onSelect = mock();
    const { rerender } = render(<StepRail steps={STEPS} current="c" done={["a", "b"]} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    rerender(<StepRail steps={STEPS} current="c" done={["a", "b"]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Shape/ }));
    expect(onSelect).toHaveBeenCalledWith("b");
    // The current and the future steps are never buttons.
    expect(screen.queryByRole("button", { name: /Words/ })).toBeNull();
  });
});
