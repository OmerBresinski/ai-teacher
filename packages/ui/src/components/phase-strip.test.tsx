import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PhaseStrip } from "./phase-strip";

const PHASES = [
  { id: "s1", label: "Title", minutes: 2 },
  { id: "s2", label: "Starter", minutes: 5 },
  { id: "s3", label: "Explain", minutes: 10 },
];

describe("PhaseStrip", () => {
  it("renders one block per phase, sized by its minutes, and selects on click", async () => {
    const onSelect = mock();
    render(<PhaseStrip phases={PHASES} onSelect={onSelect} label="Lesson phases" />);
    const list = screen.getByRole("list", { name: "Lesson phases" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveStyle({ flexGrow: "10" });
    const starter = screen.getByRole("button", { name: "Starter, 5 minutes, phase 2 of 3" });
    expect(starter).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(starter);
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("marks the selected block expanded, shows the detail and closes on Escape", () => {
    const onSelect = mock();
    render(
      <PhaseStrip
        phases={PHASES}
        selectedId="s2"
        onSelect={onSelect}
        detail={<input aria-label="Minutes" />}
      />,
    );
    const starter = screen.getByRole("button", { name: /^Starter/ });
    expect(starter).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "Starter phase" });
    expect(starter).toHaveAttribute("aria-controls", group.id);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Minutes" }), { key: "Escape" });
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(starter).toHaveFocus();
  });

  it("moves focus with the arrows and a block with Alt+Arrow", () => {
    const onMove = mock();
    render(<PhaseStrip phases={PHASES} onSelect={() => {}} onMove={onMove} />);
    const title = screen.getByRole("button", { name: /^Title/ });
    title.focus();
    fireEvent.keyDown(title, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /^Starter/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Starter/ }), {
      key: "ArrowRight",
      altKey: true,
    });
    expect(onMove).toHaveBeenCalledWith(1, 2);
  });
});
