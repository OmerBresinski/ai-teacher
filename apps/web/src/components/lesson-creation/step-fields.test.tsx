import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ObjectivesStep } from "./step-fields";

describe("ObjectivesStep slide count", () => {
  it("says the count includes the title (ADR 0036: 10 slides is the whole deck)", () => {
    render(
      <ObjectivesStep
        brief={{ topic: "Rates of reaction", yearGroup: "Year 11", level: "core", files: [] }}
        objectives={[{ id: "a", text: "Explain collision theory" }]}
        onChange={() => {}}
        slideCount="10"
        onSlideCount={() => {}}
        onBack={() => {}}
        onGenerate={() => {}}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Slides" }).textContent).toBe(
      "10 slides, including title",
    );
  });
});
