import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Label } from "./label";

describe("Label", () => {
  it("associates its control and uses metadata text", () => {
    render(
      <>
        <Label htmlFor="title">Title</Label>
        <input id="title" />
      </>,
    );
    expect(screen.getByText("Title")).toHaveClass("text-meta");
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });
});
