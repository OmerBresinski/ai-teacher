import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./input";

function Controlled({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Input
      aria-label="Lesson title"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange(event.target.value);
      }}
    />
  );
}

describe("Input", () => {
  it("forwards value and onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "Lesson title" });
    await user.type(input, "Photosynthesis");

    expect(input).toHaveValue("Photosynthesis");
    expect(onChange).toHaveBeenCalledTimes("Photosynthesis".length);
    expect(onChange).toHaveBeenLastCalledWith("Photosynthesis");
  });

  it("forwards native attributes and merges className", () => {
    render(
      <Input
        aria-label="Email"
        type="email"
        placeholder="teacher@school.org"
        className="max-w-sm"
        disabled
      />,
    );
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("placeholder", "teacher@school.org");
    expect(input).toHaveAttribute("data-slot", "input");
    expect(input).toBeDisabled();
    expect(input).toHaveClass("max-w-sm");
    expect(input).toHaveClass("motion-safe:transition-[color,box-shadow]");
  });
});
