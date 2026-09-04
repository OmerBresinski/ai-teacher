import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { RoutePendingPage } from "./route-pending-page";

describe("RoutePendingPage", () => {
  it("announces loading through a polite live region", () => {
    render(<RoutePendingPage />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});
