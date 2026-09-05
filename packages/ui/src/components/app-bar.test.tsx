import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AppBar, AppBarGroup, AppBarTitle } from "./app-bar";

describe("AppBar", () => {
  it("renders its semantic bar, groups, title, and optional max-width row", () => {
    render(
      <AppBar maxWidth={720} aria-label="Lesson controls">
        <AppBarGroup>
          <AppBarTitle>Geography</AppBarTitle>
        </AppBarGroup>
      </AppBar>,
    );

    expect(screen.getByRole("banner", { name: "Lesson controls" })).toHaveClass("h-12");
    expect(screen.getByText("Geography")).toHaveClass("text-lead", "font-semibold");
    expect(screen.getByText("Geography").parentElement?.parentElement).toHaveStyle({
      maxWidth: "720px",
    });
  });
});
