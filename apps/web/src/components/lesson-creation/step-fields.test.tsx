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

describe("intake year group picker", () => {
  it("offers Year 1 to Year 13 from the shared list, without Reception", async () => {
    const { YEAR_GROUP_OPTIONS } = await import("./step-fields");
    const want = Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`);
    expect(YEAR_GROUP_OPTIONS.map((o) => o.value)).toEqual(want);
    expect(YEAR_GROUP_OPTIONS.map((o) => o.label)).toEqual(want);
  });
});
