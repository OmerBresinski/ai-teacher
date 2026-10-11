import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ObjectivesStep } from "./step-fields";

describe("ObjectivesStep slide tier", () => {
  it("shows the chosen tier with its range (ruling 164)", () => {
    render(
      <ObjectivesStep
        brief={{ topic: "Rates of reaction", yearGroup: "Year 11", level: "core", files: [] }}
        objectives={[{ id: "a", text: "Explain collision theory" }]}
        onChange={() => {}}
        slideTier="standard"
        onSlideTier={() => {}}
        onBack={() => {}}
        onGenerate={() => {}}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Slides" }).textContent).toBe(
      "Standard, 9–12 slides",
    );
  });

  it("offers Quick, Standard and Detailed with their ranges", async () => {
    const { SLIDE_TIER_OPTIONS } = await import("./step-fields");
    expect(SLIDE_TIER_OPTIONS.map((o) => o.label)).toEqual([
      "Quick, 6–8 slides",
      "Standard, 9–12 slides",
      "Detailed, 13–16 slides",
    ]);
  });
});
