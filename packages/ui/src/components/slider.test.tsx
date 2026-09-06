import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Slider } from "./slider";

describe("Slider", () => {
  it("steps the value with the arrow keys and reports the change", async () => {
    const user = userEvent.setup();
    const onValueChange = mock(() => {});
    render(<Slider aria-label="Zoom" defaultValue={[50]} step={5} onValueChange={onValueChange} />);
    const thumb = screen.getByRole("slider", { name: "Zoom" });
    expect(thumb).toHaveAttribute("aria-valuenow", "50");
    thumb.focus();
    await user.keyboard("{ArrowRight}");
    expect(thumb).toHaveAttribute("aria-valuenow", "55");
    expect(onValueChange).toHaveBeenCalledWith([55]);
    await user.keyboard("{Home}");
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
  });

  it("renders one thumb per value and stays inside min/max", () => {
    render(<Slider aria-label="Range" defaultValue={[10, 90]} min={0} max={100} />);
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute("aria-valuemin", "0");
    expect(thumbs[1]).toHaveAttribute("aria-valuemax", "100");
  });

  it("disabled: the root and thumb carry the disabled state", () => {
    const { container } = render(<Slider aria-label="Zoom" defaultValue={[20]} disabled />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("data-disabled");
    expect(root).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("slider", { name: "Zoom" })).toHaveAttribute("data-disabled");
  });

  it("paints the ink fill, not the accent (Switch owns the accent)", () => {
    const { container } = render(<Slider aria-label="Zoom" defaultValue={[20]} />);
    expect(container.querySelector('[data-slot="slider-range"]')).toHaveClass("bg-ink-2");
  });
});
