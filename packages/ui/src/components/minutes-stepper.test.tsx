import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MinutesStepper } from "./minutes-stepper";

describe("MinutesStepper", () => {
  it("steps with the buttons and arrows, clamped to the range", async () => {
    const onChange = mock();
    render(
      <MinutesStepper value={5} onChange={onChange} min={1} max={6} label="Minutes for Starter" />,
    );
    const field = screen.getByRole("spinbutton", { name: "Minutes for Starter" });
    expect(field).toHaveAttribute("aria-valuetext", "5 minutes");
    await userEvent.click(
      screen.getByRole("button", { name: "More minutes: Minutes for Starter" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(field, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("commits a typed draft on blur and drops a non-number", async () => {
    const onChange = mock();
    render(<MinutesStepper value={5} onChange={onChange} label="Minutes" />);
    const field = screen.getByRole("spinbutton", { name: "Minutes" });
    await userEvent.clear(field);
    await userEvent.type(field, "12");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith(12);
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
