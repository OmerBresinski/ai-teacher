import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EditableListRow } from "./editable-list-row";
import { TooltipProvider } from "./tooltip";

describe("EditableListRow", () => {
  it("renders an input named by the label and the mark, and removes through its button", async () => {
    const onChange = mock();
    const onRemove = mock();
    render(
      <TooltipProvider>
        <ul>
          <EditableListRow
            mark="suggested"
            field={{ value: "Describe", onChange, label: "Objective 1" }}
            onRemove={onRemove}
            removeLabel="Remove objective 1"
            trailing={<span>12 min</span>}
          />
        </ul>
      </TooltipProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Objective 1, suggested" });
    await userEvent.type(input, "!");
    expect(onChange).toHaveBeenCalledWith("Describe!");
    await userEvent.click(screen.getByRole("button", { name: "Remove objective 1" }));
    expect(onRemove).toHaveBeenCalled();
    expect(screen.getByRole("listitem")).toHaveAttribute("data-mark", "suggested");
  });

  it("keeps Enter for the step and lets Shift+Enter add a line only in a multiline field", () => {
    render(
      <ul>
        <EditableListRow
          field={{ value: "Particle", onChange: () => {}, label: "Term 1" }}
          secondary={{
            value: "A tiny piece.",
            onChange: () => {},
            label: "Definition 1",
            multiline: true,
          }}
        />
      </ul>,
    );
    const term = screen.getByRole("textbox", { name: "Term 1" });
    const definition = screen.getByRole("textbox", { name: "Definition 1" });
    expect(term.tagName).toBe("TEXTAREA");
    expect(term).not.toHaveAttribute("data-multiline");
    expect(definition).toHaveAttribute("data-multiline");
    expect(fireEvent.keyDown(term, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(term, { key: "Enter", shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(definition, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(definition, { key: "Enter", shiftKey: true })).toBe(true);
  });

  it("renders a secondary multiline field", () => {
    render(
      <ul>
        <EditableListRow
          field={{ value: "Particle", onChange: () => {}, label: "Term 1" }}
          secondary={{
            value: "A tiny piece.",
            onChange: () => {},
            label: "Definition 1",
            multiline: true,
          }}
        />
      </ul>,
    );
    expect(screen.getByRole("textbox", { name: "Definition 1" }).tagName).toBe("TEXTAREA");
  });
});
