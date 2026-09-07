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
    expect(pill).toHaveClass("font-medium");
    expect(pill).not.toHaveClass("border");
  });

  it("keeps the hairline only when opaque, and drops the container when quiet", () => {
    render(
      <>
        <StatusPill opaque>Draft</StatusPill>
        <StatusPill quiet tone="success">
          Published
        </StatusPill>
      </>,
    );
    expect(screen.getByText("Draft")).toHaveClass("border", "bg-card");
    const quiet = screen.getByText("Published");
    expect(quiet).not.toHaveClass("rounded-full");
    expect(quiet).toHaveClass("text-ink-2");
    expect(quiet.querySelector(".bg-success")).not.toBeNull();
  });
});
