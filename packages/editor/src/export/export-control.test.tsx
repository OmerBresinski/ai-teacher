import { afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Lesson, Worksheet } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { demoWorksheet } from "../model/demo-worksheet";
import { demoLibrary } from "../model/starter";
import { ExportControl, PENDING_FORMAT_TIP } from "./ExportControl";

const water = () => {
  const lesson = demoLibrary().find((l) => l.title === "The water cycle");
  if (!lesson) throw new Error("fixture missing");
  return lesson;
};

function renderControl(document: Lesson | Worksheet = water(), currentSlideId?: string) {
  const onOpenPrint = mock((_href: string) => {});
  render(
    <TooltipProvider>
      <ExportControl
        document={document}
        currentSlideId={currentSlideId}
        onOpenPrint={onOpenPrint}
      />
    </TooltipProvider>,
  );
  return { onOpenPrint };
}

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Export" }));
  return screen.getByRole("dialog");
};

/** Radix Tabs switch on pointer down; `user.click` produces the full sequence. */
const pickTab = (name: string) => screen.getByRole("tab", { name });

afterEach(() => {
  mock.restore();
});

describe("ExportControl (TEACH-110)", () => {
  it("row 1: PDF / PowerPoint (disabled) / PNG (disabled) / JSON, with the PDF options", async () => {
    const user = userEvent.setup();
    renderControl();
    await openDialog(user);

    const tabs = screen.getAllByRole("tab").map((t) => [t.textContent, t.hasAttribute("disabled")]);
    expect(tabs).toEqual([
      ["PDF", false],
      ["PowerPoint", true],
      ["PNG", true],
      ["JSON", false],
    ]);
    expect(pickTab("PDF")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Slides" })).toHaveValue("All");
    expect(screen.getByRole("radio", { name: "One per page" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Answers off by default, for PDF and every other format alike (ADR 0023 §7).
    expect(screen.getByRole("switch", { name: "Include answers" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("switch", { name: "Include presenter notes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeEnabled();
  });

  it("names the phase a disabled tab is waiting for", async () => {
    const user = userEvent.setup();
    renderControl();
    await openDialog(user);
    await user.hover(pickTab("PowerPoint").parentElement as HTMLElement);
    await waitFor(() => expect(screen.getAllByText(PENDING_FORMAT_TIP)[0]).toBeVisible());
  });

  it("row 2: PDF with a range and answers opens the print route with exactly those params", async () => {
    const user = userEvent.setup();
    const lesson = water();
    const { onOpenPrint } = renderControl(lesson);
    await openDialog(user);

    const range = screen.getByRole("textbox", { name: "Slides" });
    await user.clear(range);
    await user.type(range, "1-3, 5");
    await user.click(screen.getByRole("switch", { name: "Include answers" }));
    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(onOpenPrint).toHaveBeenCalledTimes(1);
    expect(onOpenPrint.mock.calls[0]?.[0]).toBe(
      `/l/${lesson.id}/print?auto=1&answers=1&slides=1-3%2C+5`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("3 per page writes handout=3 and drops the notes option", async () => {
    const user = userEvent.setup();
    const lesson = water();
    const { onOpenPrint } = renderControl(lesson);
    await openDialog(user);

    await user.click(screen.getByRole("switch", { name: "Include presenter notes" }));
    await user.click(screen.getByRole("radio", { name: "3 per page" }));
    expect(screen.queryByRole("switch", { name: "Include presenter notes" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    // Notes were on, but the handout layout has its own note lines: not written.
    expect(onOpenPrint.mock.calls[0]?.[0]).toBe(`/l/${lesson.id}/print?auto=1&handout=3`);
  });

  it("blocks Export on a range the lesson cannot honour and says why", async () => {
    const user = userEvent.setup();
    const lesson = water();
    renderControl(lesson);
    await openDialog(user);

    const range = screen.getByRole("textbox", { name: "Slides" });
    await user.clear(range);
    await user.type(range, "99");
    expect(
      screen.getByText(`There is no slide 99. This lesson has ${lesson.slides.length} slides.`),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  });

  it("'This slide' fills the range with the current slide's number", async () => {
    const user = userEvent.setup();
    const lesson = water();
    const third = lesson.slides[2];
    if (!third) throw new Error("fixture");
    renderControl(lesson, third.id);
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "This slide" }));
    expect(screen.getByRole("textbox", { name: "Slides" })).toHaveValue("3");
  });

  it("row 6: JSON downloads the lesson as <slug>.teachdeck.json", async () => {
    const user = userEvent.setup();
    const created: HTMLAnchorElement[] = [];
    const clicked = mock(() => {});
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      created.push(this);
      clicked();
    };
    const createObjectURL = mock(() => "blob:test");
    const revokeObjectURL = mock(() => {});
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    try {
      renderControl();
      await openDialog(user);
      await user.click(pickTab("JSON"));
      await user.click(screen.getByRole("button", { name: "Export JSON" }));
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(created[0]?.download).toBe("the-water-cycle.teachdeck.json");
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
  });

  it("row 7: a worksheet offers PDF / Word (disabled) / JSON and prints through its own route", async () => {
    const user = userEvent.setup();
    const sheet = demoWorksheet();
    const { onOpenPrint } = renderControl(sheet);
    await openDialog(user);

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["PDF", "Word", "JSON"]);
    expect(pickTab("Word")).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "Slides" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(onOpenPrint.mock.calls[0]?.[0]).toBe(`/w/${sheet.id}/print?auto=1`);
  });
});
