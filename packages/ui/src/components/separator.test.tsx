import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Separator } from "./separator";

describe("Separator", () => {
  it("renders a semantic separator", () => {
    render(<Separator decorative={false} />);
    expect(screen.getByRole("separator")).toHaveClass("bg-border");
  });
});
