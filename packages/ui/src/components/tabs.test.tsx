import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("Tabs", () => {
  it("renders automatic Radix tabs with active TeachDeck styles", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "One" })).toHaveClass("rounded-chip");
  });
});
