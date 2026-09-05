import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { SectionHeading } from "./section-heading";

describe("SectionHeading", () => {
  it("renders a display heading with a count and trailing action", () => {
    render(
      <SectionHeading count={4} action={<a href="/lessons">See all</a>}>
        Recent lessons
      </SectionHeading>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Recent lessons" })).toHaveClass(
      "font-display",
    );
    expect(screen.getByText("4")).toHaveClass("tabular-nums");
    expect(screen.getByRole("link", { name: "See all" })).toBeInTheDocument();
  });
});
