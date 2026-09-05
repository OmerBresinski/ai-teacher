import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Spinner } from "./spinner";

describe("Spinner", () => {
  it("is decorative and supports the large size", () => {
    render(<Spinner data-testid="spinner" size={20} />);
    expect(screen.getByTestId("spinner")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("spinner")).toHaveClass("size-5");
  });
});
