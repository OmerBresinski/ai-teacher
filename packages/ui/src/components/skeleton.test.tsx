import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("uses the active accent wash", () => {
    render(<Skeleton data-testid="skeleton" className="w-10" />);
    expect(screen.getByTestId("skeleton")).toHaveClass("bg-accent-active", "w-10");
  });
});
