import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("renders an accessible sunken textarea", () => {
    render(<Textarea aria-label="Notes" className="w-full" />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveClass("bg-secondary", "w-full");
  });
});
