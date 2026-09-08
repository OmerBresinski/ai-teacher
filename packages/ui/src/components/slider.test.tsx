import { describe, expect, it, mock } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Slider } from "./slider";

describe("Slider", () => {
  it("steps the value with the arrow keys and reports the change", async () => {
    const user = userEvent.setup();
    const onValueChange = mock(() => {});
    render(<Slider aria-label="Zoom" defaultValue={[50]} step={5} onValueChange={onValueChange} />);
    const thumb = screen.getByRole("slider", { name: "Zoom" });
    expect(thumb).toHaveAttribute("aria-valuenow", "50");
    act(() => thumb.focus());
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

  it("valueLabel: aria-valuetext reads the formatted value; the bubble shows on keyboard focus only", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Slider aria-label="Opacity" defaultValue={[50]} step={5} valueLabel={(v) => `${v}%`} />,
    );
    const thumb = screen.getByRole("slider", { name: "Opacity" });
    expect(thumb).toHaveAttribute("aria-valuetext", "50%");
    // At rest there is no bubble: the readout beside the slider is the resting value.
    expect(container.querySelector('[data-slot="slider-value"]')).toBeNull();
    await user.tab();
    expect(thumb).toHaveFocus();
    expect(container.querySelector('[data-slot="slider-value"]')).toHaveTextContent("50%");
    await user.keyboard("{ArrowRight}");
    expect(thumb).toHaveAttribute("aria-valuetext", "55%");
    expect(container.querySelector('[data-slot="slider-value"]')).toHaveTextContent("55%");
    // Shift + arrow steps by ten steps (Radix); Home and End go to the ends.
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(thumb).toHaveAttribute("aria-valuenow", "5");
    await user.keyboard("{End}");
    expect(thumb).toHaveAttribute("aria-valuetext", "100%");
    await user.tab();
    expect(container.querySelector('[data-slot="slider-value"]')).toBeNull();
  });

  it("without valueLabel there is no aria-valuetext and no bubble", () => {
    const { container } = render(<Slider aria-label="Zoom" defaultValue={[20]} />);
    expect(screen.getByRole("slider", { name: "Zoom" })).not.toHaveAttribute("aria-valuetext");
    expect(container.querySelector('[data-slot="slider-value"]')).toBeNull();
  });

  it("resetTo: a double-click on the thumb, or Backspace, sets the value through onValueChange", async () => {
    const user = userEvent.setup();
    const onValueChange = mock(() => {});
    const onValueCommit = mock(() => {});
    render(
      <Slider
        aria-label="Opacity"
        defaultValue={[37]}
        resetTo={100}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const thumb = screen.getByRole("slider", { name: "Opacity" });
    expect(thumb).toHaveAttribute("title", "Double-click to reset");
    expect(thumb).toHaveAttribute("aria-description", "Double-click to reset");
    await user.dblClick(thumb);
    expect(onValueChange).toHaveBeenCalledWith([100]);
    expect(onValueCommit).toHaveBeenCalledWith([100]);
    expect(thumb).toHaveAttribute("aria-valuenow", "100");
    await user.keyboard("{ArrowLeft}");
    expect(thumb).toHaveAttribute("aria-valuenow", "99");
    await user.keyboard("{Backspace}");
    expect(thumb).toHaveAttribute("aria-valuenow", "100");
    expect(onValueChange).toHaveBeenLastCalledWith([100]);
  });

  it("without resetTo a double-click changes nothing and the thumb carries no hint", async () => {
    const user = userEvent.setup();
    const onValueChange = mock(() => {});
    render(<Slider aria-label="Zoom" defaultValue={[37]} onValueChange={onValueChange} />);
    const thumb = screen.getByRole("slider", { name: "Zoom" });
    expect(thumb).not.toHaveAttribute("title");
    expect(thumb).not.toHaveAttribute("aria-description");
    await user.dblClick(thumb);
    await user.keyboard("{Backspace}");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(thumb).toHaveAttribute("aria-valuenow", "37");
  });

  it("paints the ink fill, not the accent (Switch owns the accent)", () => {
    const { container } = render(<Slider aria-label="Zoom" defaultValue={[20]} />);
    expect(container.querySelector('[data-slot="slider-range"]')).toHaveClass("bg-ink-2");
  });
});
