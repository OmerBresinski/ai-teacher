import { afterEach, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { demoLibrary } from "@tj/editor/starter";
import { TooltipProvider } from "@tj/ui";
import { MobileGeneratingShell } from "./MobileGeneratingShell";
import { stageOf } from "./stage";

afterEach(cleanup);
const lesson = demoLibrary()[0];
if (!lesson) throw new Error("Missing lesson fixture");

it("shows full slide cards without desktop rails and preserves Stop and export", () => {
  const onStop = mock(() => undefined);
  render(
    <TooltipProvider>
      <MobileGeneratingShell
        lesson={lesson}
        state={stageOf([])}
        line="Writing the slides"
        lockLine="Read only until the lesson is ready"
        onBack={() => undefined}
        onStop={onStop}
        exportSlot={<button type="button">Export</button>}
        canvasCompanion={<span>Slide companion</span>}
      />
    </TooltipProvider>,
  );
  expect(document.querySelectorAll("[data-mobile-slide]").length).toBe(lesson.slides.length);
  expect(document.querySelector("[data-insert-rail-placeholder]")).toBeNull();
  expect(document.querySelector("[data-mobile-companion]")).toHaveTextContent("Slide companion");
  expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalledTimes(1);
});

it("keeps arrived slides readable after failure and removes the loading animation", () => {
  const state = { ...stageOf([]), terminal: "failed" as const };
  render(
    <TooltipProvider>
      <MobileGeneratingShell
        lesson={lesson}
        state={state}
        line="Generation stopped before the lesson was finished."
        lockLine="Stopped. What was written is kept."
        onBack={() => undefined}
        onStop={() => undefined}
        canvasCompanion={<span>Slide companion</span>}
      />
    </TooltipProvider>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Generation stopped");
  expect(document.querySelectorAll("[data-mobile-slide]").length).toBe(lesson.slides.length);
  expect(document.querySelector("[data-mobile-loading-slot]")).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});
