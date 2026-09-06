import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberInput } from "./NumberInput";
import { Panel, PanelRow } from "./Panel";
import { Segmented } from "./Segmented";

describe("Segmented", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B", disabled: true },
    { value: "c", label: "C" },
  ] as const;

  it("is a radiogroup with one tab stop; arrows skip disabled options and wrap", async () => {
    const user = userEvent.setup();
    const onChange = mock(() => {});
    render(<Segmented aria-label="Mode" value="a" options={[...options]} onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Mode" });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    (radios[0] as HTMLElement).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(group).toBeInTheDocument();
  });

  it("as tabs uses tablist/tab semantics", () => {
    render(
      <Segmented
        as="tabs"
        aria-label="View"
        value="a"
        options={[...options]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tablist", { name: "View" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("NumberInput", () => {
  it("keeps a draft while focused, commits a clamped value on blur, reverts on Escape", async () => {
    const user = userEvent.setup();
    const onChange = mock(() => {});
    render(<NumberInput aria-label="Minutes" value={5} min={1} max={120} onChange={onChange} />);
    const field = screen.getByRole("spinbutton", { name: "Minutes" });
    expect(field).toHaveAttribute("aria-valuenow", "5");
    await user.click(field);
    await user.clear(field);
    await user.type(field, "999");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith(120);
    await user.click(field);
    await user.clear(field);
    await user.type(field, "7");
    await user.keyboard("{Escape}");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("arrows step by `step`, Shift by `coarse`×; rubbish reverts", async () => {
    const user = userEvent.setup();
    const onChange = mock(() => {});
    render(<NumberInput aria-label="Size" value={10} step={2} coarse={5} onChange={onChange} />);
    const field = screen.getByRole("spinbutton", { name: "Size" });
    (field as HTMLInputElement).focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(12);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith(0);
    await user.clear(field);
    await user.type(field, "abc");
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect((field as HTMLInputElement).value).toBe("10");
  });
});

describe("Panel", () => {
  it("bar and card shapes; a PanelRow label binds to its control", () => {
    render(
      <>
        <Panel data-testid="bar">x</Panel>
        <Panel as="card" pad="menu" data-testid="card">
          <PanelRow label="Width" htmlFor="w">
            <input id="w" />
          </PanelRow>
        </Panel>
      </>,
    );
    expect(screen.getByTestId("bar")).toHaveClass("h-10");
    expect(screen.getByTestId("card")).toHaveClass("p-1.5");
    expect(screen.getByLabelText("Width")).toBeInTheDocument();
  });
});
