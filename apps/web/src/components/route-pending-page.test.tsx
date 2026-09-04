import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { RoutePendingPage } from "./route-pending-page";

describe("RoutePendingPage", () => {
  it("announces loading through a status region", () => {
    render(<RoutePendingPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});
