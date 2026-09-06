import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@tj/ui";
import { newSlide } from "../model/factories";
import { demoLibrary } from "../model/starter";
import { LessonViewer } from "./LessonViewer";

function renderViewer(overrides: Partial<React.ComponentProps<typeof LessonViewer>> = {}) {
  const lesson = demoLibrary()[0];
  if (!lesson) throw new Error("demo lesson missing");
  // The demo deck has no build steps; a worked example does (its lines rise one per step).
  lesson.slides.push(newSlide("worked-example", lesson.themeId));
  const onPresent = mock(() => {});
  const onDuplicate = mock(() => Promise.resolve());
  const utils = render(
    <TooltipProvider>
      <LessonViewer
        lesson={lesson}
        onPresent={onPresent}
        onDuplicate={onDuplicate}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { ...utils, lesson, onPresent, onDuplicate };
}

const status = () => screen.getByRole("status").textContent;

describe("LessonViewer", () => {
  it("renders the title, the count and one rail thumb per slide", () => {
    const { lesson } = renderViewer();
    // The title also appears inside the title slide's thumb; the app bar heading is the first.
    expect(screen.getAllByText(lesson.title)[0]).toBeVisible();
    expect(screen.getByText(`${lesson.slides.length} slides`)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Slide \d+$/ })).toHaveLength(
      lesson.slides.length,
    );
    expect(status()).toBe(`Slide 1 of ${lesson.slides.length}`);
  });

  it("ArrowRight/ArrowLeft walk steps then slides; Home and End jump", () => {
    const { lesson } = renderViewer();
    fireEvent.keyDown(window, { key: "End" });
    expect(status()).toContain(`Slide ${lesson.slides.length} of`);
    fireEvent.keyDown(window, { key: "Home" });
    expect(status()).toContain("Slide 1 of");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(status()).toContain("Slide 2 of");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(status()).toContain("Slide 1 of");
    // Modifier chords and typing fields are left alone.
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    expect(status()).toContain("Slide 1 of");
  });

  it("reveal steps hide later elements until stepped through", () => {
    const { lesson, container } = renderViewer();
    const stepped = lesson.slides.findIndex((s) => s.elements.some((e) => (e.revealStep ?? 0) > 0));
    expect(stepped).toBeGreaterThan(-1);
    fireEvent.click(screen.getByRole("button", { name: `Slide ${stepped + 1}` }));
    const hidden = () =>
      container.querySelectorAll('[data-slide-mode="view"] [data-element-id][aria-hidden="true"]')
        .length;
    const before = hidden();
    expect(before).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(hidden()).toBeLessThan(before);
    expect(screen.getByRole("img", { name: /Step 2 of/ })).toBeVisible();
  });

  it("a question slide gets a Show answer switch that reveals the answer", async () => {
    const user = userEvent.setup();
    const { lesson, container } = renderViewer();
    const q = lesson.slides.findIndex((s) => s.question && s.question.type !== "open-response");
    fireEvent.click(screen.getByRole("button", { name: `Slide ${q + 1}` }));
    const toggle = screen.getByRole("switch", { name: "Show answer" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(status()).toContain("answer shown");
    expect(container.querySelector("[data-answer-anim]")).not.toBeNull();
    // Moving on turns the answer off again.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.queryByText(/answer shown/)).toBeNull();
  });

  it("Present reports the current 1-based slide; Make a copy awaits the app", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const onDuplicate = mock(() => new Promise<void>((r) => (release = r)));
    const { onPresent } = renderViewer({ onDuplicate });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await user.click(screen.getByRole("button", { name: "Present" }));
    expect(onPresent).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole("button", { name: "Make a copy" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Copying…" })).toBeDisabled();
    release();
    expect(await screen.findByRole("button", { name: "Make a copy" })).toBeEnabled();
  });

  it("renders the export slot and the leading control where given", () => {
    renderViewer({ exportSlot: <button type="button">Export</button>, leading: <span>Back</span> });
    expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
    expect(screen.getByText("Back")).toBeVisible();
  });
});
