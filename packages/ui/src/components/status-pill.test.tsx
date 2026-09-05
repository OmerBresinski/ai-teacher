import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { StatusPill } from "./status-pill";

describe("StatusPill", () => {
  it("uses the destructive token and one 5px dot for danger", () => {
    render(
      <StatusPill tone="danger" dot>
        Needs attention
      </StatusPill>,
    );

    const pill = screen.getByText("Needs attention");
    expect(pill).toHaveClass("text-destructive");
    expect(pill.querySelectorAll(".size-\\[5px\\]")).toHaveLength(1);
  });
});
