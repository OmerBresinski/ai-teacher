import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";

import { Tile } from "./tile";

describe("Tile", () => {
  it("renders a 64px primary action with its icon treatment", () => {
    render(<Tile icon={<Plus aria-hidden />}>New lesson</Tile>);
    expect(screen.getByRole("button", { name: "New lesson" })).toHaveClass("h-16", "rounded-card");
    expect(screen.getByRole("button").querySelector("span")?.className).toContain("size-10");
  });

  it("is the primary terracotta fill when asked, and a bordered sheet by default", () => {
    render(
      <>
        <Tile icon={<Plus aria-hidden />} tone="primary">
          New lesson
        </Tile>
        <Tile icon={<Plus aria-hidden />}>New worksheet</Tile>
      </>,
    );
    expect(screen.getByRole("button", { name: "New lesson" })).toHaveClass("bg-primary-fill");
    expect(screen.getByRole("button", { name: "New lesson" })).toHaveAttribute("data-primary-fill");
    expect(screen.getByRole("button", { name: "New worksheet" })).toHaveClass("bg-card", "border");
  });

  it("disabled takes the icon square down with the label and is not pressable", () => {
    render(
      <Tile icon={<Plus aria-hidden />} disabled>
        Disabled tile
      </Tile>,
    );
    const tile = screen.getByRole("button", { name: "Disabled tile" });
    expect(tile).toBeDisabled();
    expect(tile).toHaveClass("disabled:opacity-50");
  });
});
