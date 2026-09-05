import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Kbd } from "./kbd";

describe("Kbd", () => {
  it("renders a keyboard hint with TeachDeck geometry", () => {
    render(<Kbd>Cmd K</Kbd>);
    expect(screen.getByText("Cmd K").tagName).toBe("KBD");
    expect(screen.getByText("Cmd K")).toHaveClass("rounded-chip");
  });
});
