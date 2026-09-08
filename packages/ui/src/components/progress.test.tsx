import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Progress } from "./progress";

describe("Progress", () => {
  it("is a progressbar with the clamped value and a percent text", () => {
    render(<Progress value={140} label="Generating" />);
    const bar = screen.getByRole("progressbar", { name: "Generating" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "100%");
    expect(bar.querySelector("[data-slot=progress-fill]")).toHaveStyle({ width: "100%" });
  });

  it("is indeterminate without a value", () => {
    render(<Progress label="Working" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});
