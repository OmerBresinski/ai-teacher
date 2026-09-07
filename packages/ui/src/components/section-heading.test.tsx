import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { SectionHeading } from "./section-heading";

describe("SectionHeading", () => {
  it("renders a UI-face heading with a count and trailing action", () => {
    render(
      <SectionHeading count={4} action={<a href="/lessons">See all</a>}>
        Recent lessons
      </SectionHeading>,
    );

    const heading = screen.getByRole("heading", { level: 2, name: "Recent lessons" });
    expect(heading).toHaveClass("font-ui", "text-lead", "font-semibold");
    expect(heading).not.toHaveClass("font-display");
    expect(screen.getByText("4")).toHaveClass("tabular-nums");
    expect(screen.getByRole("link", { name: "See all" })).toBeInTheDocument();
  });
});
