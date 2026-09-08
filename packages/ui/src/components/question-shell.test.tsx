import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { QuestionShell } from "./question-shell";

describe("QuestionShell", () => {
  it("labels the region by the question and describes it by the help", () => {
    render(
      <QuestionShell
        question="What should pupils be able to do?"
        help="One line each."
        eyebrow="1 of 5"
        footer={<button type="button">Continue</button>}
      >
        <input aria-label="Objective 1" />
      </QuestionShell>,
    );
    const region = screen.getByRole("region", { name: "What should pupils be able to do?" });
    expect(region).toHaveAccessibleDescription("One line each.");
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass("font-display");
    expect(region).toHaveTextContent("1 of 5");
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});
