import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Display } from "./display";

describe("Display", () => {
  it("uses the display face at the configured size", () => {
    render(
      <Display as="h1" size="xl">
        TeachDeck
      </Display>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "TeachDeck" })).toHaveClass(
      "font-display",
      "text-[36px]",
      "leading-[44px]",
    );
  });
});
