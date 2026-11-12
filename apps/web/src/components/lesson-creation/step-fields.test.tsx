import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { draftsForYear, ObjectivesStep } from "./step-fields";

const renderObjectives = (slideTier: "quick" | "standard" | "detailed" = "standard") =>
  render(
    <ObjectivesStep
      brief={{ topic: "Rates of reaction", yearGroup: "Year 11", level: "core", files: [] }}
      objectives={[{ id: "a", text: "Explain collision theory" }]}
      onChange={() => {}}
      slideTier={slideTier}
      onSlideTier={() => {}}
      onBack={() => {}}
      onGenerate={() => {}}
    />,
  );

describe("ObjectivesStep lesson size", () => {
  it("shows the chosen size with the slides it makes (ruling 164)", () => {
    renderObjectives();
    expect(screen.getByRole("combobox", { name: "Lesson size" }).textContent).toBe(
      "Standard 10 to 12 slides",
    );
  });

  it("offers Short, Standard and Long, each with its slide range and no minutes", async () => {
    const { SLIDE_TIER_OPTIONS } = await import("./step-fields");
    expect(SLIDE_TIER_OPTIONS).toEqual([
      { value: "quick", label: "Short", hint: "7 to 8 slides" },
      { value: "standard", label: "Standard", hint: "10 to 12 slides" },
      { value: "detailed", label: "Long", hint: "13 to 16 slides" },
    ]);
  });

  it("renders no minute claim for the lesson at any size (Greg, 12 Nov 2026)", () => {
    for (const tier of ["quick", "standard", "detailed"] as const) {
      const { container, unmount } = renderObjectives(tier);
      expect(container.textContent ?? "").not.toMatch(/\b(min|mins|minutes?|hours?)\b/i);
      unmount();
    }
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

/* R4 review (12 Nov), web finding 8: Exam practice is cleared when the year drops below 10. */
describe("draftsForYear", () => {
  const drafts = [
    { id: "a", recipe: "exam-style", minutes: "15" },
    { id: "b", recipe: "exit-ticket", minutes: "10" },
  ];
  it("keeps Exam practice for Years 10 and 11", () => {
    expect(draftsForYear(drafts, "Year 11")).toBe(drafts);
  });
  it("puts a draft the year no longer offers back to Practice", () => {
    expect(draftsForYear(drafts, "Year 8")).toEqual([
      { id: "a", recipe: "practice", minutes: "15" },
      { id: "b", recipe: "exit-ticket", minutes: "10" },
    ]);
  });
});
