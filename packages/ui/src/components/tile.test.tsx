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
});
