import { describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { BriefStep, draftsForYear, type IntakeBrief, ObjectivesStep } from "./step-fields";

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

/* Founder's ruling (12 Nov 2026): an unrecognised year group asks the teacher, never guesses. */
describe("BriefStep year group question", () => {
  function Harness({
    initial,
    onNext,
  }: {
    initial: IntakeBrief;
    onNext: (b: IntakeBrief) => void;
  }) {
    const [brief, setBrief] = useState(initial);
    return <BriefStep brief={brief} onChange={setBrief} onNext={() => onNext(brief)} />;
  }
  const brief = (patch: Partial<IntakeBrief> = {}): IntakeBrief => ({
    topic: "Fractions of amounts",
    yearGroup: "",
    level: "standard",
    files: [],
    ...patch,
  });
  const year = () => screen.getByRole("combobox", { name: "Year group" });
  const question = () => screen.queryByRole("alert");
  // Radix keeps a native select beside the trigger for forms; a change there is a pick.
  const pick = (value: string) => {
    const native = document.querySelector("select") as HTMLSelectElement;
    fireEvent.change(native, { target: { value } });
  };

  it("starts empty with “Choose a year group”, and Next asks instead of guessing", () => {
    cleanup();
    const next: IntakeBrief[] = [];
    render(<Harness initial={brief()} onNext={(b) => next.push(b)} />);
    expect(year()).toHaveTextContent("Choose a year group");
    expect(question()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(next).toHaveLength(0);
    expect(question()).toHaveTextContent("Which year group is this for? Choose one from the list.");
    // The question is tied to the field and takes focus there, for keyboard and screen reader.
    expect(year()).toHaveAttribute("aria-invalid", "true");
    expect(year().getAttribute("aria-describedby")).toBe(question()?.id ?? "missing");
    expect(year()).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue("Fractions of amounts");
    pick("Year 4");
    expect(question()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(next.map((b) => b.yearGroup)).toEqual(["Year 4"]);
  });

  it("asks at once about a stored year group that is not on the list, naming it", () => {
    cleanup();
    render(<Harness initial={brief({ yearGroup: "P5" })} onNext={() => {}} />);
    expect(year()).toHaveTextContent("Choose a year group");
    expect(question()).toHaveTextContent("“P5” isn’t on our list. Which year group is this for?");
  });

  it("asks when the topic names another year, keeps the topic, and takes the teacher's pick", () => {
    cleanup();
    const next: IntakeBrief[] = [];
    const topic = "Fractions for my P5 class";
    render(
      <Harness initial={brief({ topic, yearGroup: "Year 4" })} onNext={(b) => next.push(b)} />,
    );
    expect(question()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(next).toHaveLength(0);
    expect(question()).toHaveTextContent("Your topic says “P5”. Which year group is this for?");
    // The choice is cleared so the teacher picks it themselves; their topic stays as typed.
    expect(year()).toHaveTextContent("Choose a year group");
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue(topic);
    pick("Year 4");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ yearGroup: "Year 4", yearConfirmedFor: "p5" });
  });
});
