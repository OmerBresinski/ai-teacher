import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

describe("Card", () => {
  it("renders every slot with its data-slot marker", () => {
    render(
      <Card data-testid="card" className="max-w-md">
        <CardHeader>
          <CardTitle>Lesson 3</CardTitle>
          <CardDescription>Photosynthesis, part 1</CardDescription>
          <CardAction>action</CardAction>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );

    const card = screen.getByTestId("card");
    expect(card).toHaveAttribute("data-slot", "card");
    expect(card).toHaveClass("bg-card", "rounded-card", "shadow-1", "max-w-md");
    expect(screen.getByText("Lesson 3")).toHaveAttribute("data-slot", "card-title");
    expect(screen.getByText("Photosynthesis, part 1")).toHaveAttribute(
      "data-slot",
      "card-description",
    );
    expect(screen.getByText("action")).toHaveAttribute("data-slot", "card-action");
    expect(screen.getByText("Body")).toHaveAttribute("data-slot", "card-content");
    expect(screen.getByText("Footer")).toHaveAttribute("data-slot", "card-footer");
  });

  it("creates no stacking context, so overlay actions can beat a sibling cover link", () => {
    const { container } = render(<Card variant="contained">Face</Card>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/\bisolate\b/);
    expect(root.className).not.toMatch(/\bz-\d/);
  });
});
