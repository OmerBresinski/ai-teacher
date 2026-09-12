import { afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Lesson, Worksheet } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { demoWorksheet } from "../model/demo-worksheet";
import { demoLibrary } from "../model/starter";
import { ExportControl, exportLoaders, PENDING_FORMAT_TIP, PPTX_FONT_NOTE } from "./ExportControl";

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
  it("row 1: PDF / PowerPoint / PNG / JSON, with the PDF options (PowerPoint and PNG enabled by E2)", async () => {
    const user = userEvent.setup();
    renderControl();
    await openDialog(user);

    const tabs = screen.getAllByRole("tab").map((t) => [t.textContent, t.hasAttribute("disabled")]);
    expect(tabs).toEqual([
      ["PDF", false],
      ["PowerPoint", false],
      ["PNG", false],
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

  it("names the phase a disabled tab is waiting for (Word, until E3)", async () => {
    const user = userEvent.setup();
    renderControl(demoWorksheet());
    await openDialog(user);
    await user.hover(pickTab("Word").parentElement as HTMLElement);
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

/*
 * E2 (TEACH-111): the PowerPoint and PNG tabs, their options, and the `import()` boundary — the
 * exporter modules are mocked so the test asserts the lazy path, not pptxgenjs.
 */
describe("ExportControl (TEACH-111)", () => {
  it("PowerPoint: answers off by default, the font caveat, and one download named <slug>.pptx", async () => {
    const user = userEvent.setup();
    const exportLessonPptx = mock(async () => new Blob(["pk"], { type: "application/zip" }));
    const realPptx = exportLoaders.pptx;
    exportLoaders.pptx = async () =>
      ({
        exportLessonPptx,
        pptxFilename: (l: { title: string }) =>
          `${l.title.toLowerCase().replaceAll(" ", "-")}.pptx`,
      }) as unknown as Awaited<ReturnType<typeof realPptx>>;
    const downloads: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    try {
      const lesson = water();
      render(
        <TooltipProvider>
          <ExportControl document={lesson} imageOrigin="https://api.test" onOpenPrint={() => {}} />
        </TooltipProvider>,
      );
      await openDialog(user);
      await user.click(pickTab("PowerPoint"));
      expect(screen.getByRole("switch", { name: "Include answers" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(screen.getByText(PPTX_FONT_NOTE)).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Export PowerPoint" }));
      await waitFor(() => expect(downloads).toEqual(["the-water-cycle.pptx"]));
      expect(exportLessonPptx).toHaveBeenCalledTimes(1);
      const [, , options] = exportLessonPptx.mock.calls[0] as unknown as [
        unknown,
        unknown,
        { includeAnswers: boolean; imageOrigin: string },
      ];
      expect(options).toEqual({ includeAnswers: false, imageOrigin: "https://api.test" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    } finally {
      HTMLAnchorElement.prototype.click = original;
      exportLoaders.pptx = realPptx;
    }
  });

  it("PNG: size 1x/2x/3x with the pixel hint, the range, and one file per slide in range", async () => {
    const user = userEvent.setup();
    const captured: number[] = [];
    const realPng = exportLoaders.png;
    exportLoaders.png = async () =>
      ({
        captureSlidePng: async (_el: HTMLElement, scale: number) => {
          captured.push(scale);
          return new Blob(["png"], { type: "image/png" });
        },
        pngFilename: (l: { title: string }, i: number) =>
          `${l.title.toLowerCase().replaceAll(" ", "-")}-${i + 1}.png`,
      }) as unknown as Awaited<ReturnType<typeof realPng>>;
    const downloads: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    try {
      renderControl();
      await openDialog(user);
      await user.click(pickTab("PNG"));
      expect(screen.getByText("1920 x 1080")).toBeVisible();
      await user.click(screen.getByRole("radio", { name: "3x" }));
      expect(screen.getByText("2880 x 1620")).toBeVisible();
      const range = screen.getByRole("textbox", { name: "Slides" });
      await user.clear(range);
      await user.type(range, "1-2");
      expect(screen.getByText("2 files download one after another.")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Export PNG" }));
      await waitFor(() =>
        expect(downloads).toEqual(["the-water-cycle-1.png", "the-water-cycle-2.png"]),
      );
      expect(captured).toEqual([3, 3]);
      // The stage is gone with the run.
      await waitFor(() => expect(document.querySelector("[data-capture-stage]")).toBeNull());
    } finally {
      HTMLAnchorElement.prototype.click = original;
      exportLoaders.png = realPng;
    }
  });

  it("PNG: closing the dialog mid-run stops the loop after the file in hand (row 7)", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const realPng = exportLoaders.png;
    exportLoaders.png = async () =>
      ({
        captureSlidePng: async () => {
          calls += 1;
          if (calls === 1) await gate;
          return new Blob(["png"], { type: "image/png" });
        },
        pngFilename: (_l: unknown, i: number) => `s-${i + 1}.png`,
      }) as unknown as Awaited<ReturnType<typeof realPng>>;
    const downloads: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    try {
      renderControl();
      await openDialog(user);
      await user.click(pickTab("PNG"));
      await user.click(screen.getByRole("button", { name: "Export PNG" }));
      await waitFor(() => expect(screen.getByText(/Exporting 1 of \d+/)).toBeVisible());
      expect(document.querySelector("[data-capture-stage]")).not.toBeNull();
      await user.keyboard("{Escape}");
      release();
      await waitFor(() => expect(downloads).toEqual(["s-1.png"]));
      // Give a second iteration every chance to run: it must not.
      await new Promise((r) => setTimeout(r, 200));
      expect(downloads).toEqual(["s-1.png"]);
      expect(calls).toBe(1);
      expect(document.querySelector("[data-capture-stage]")).toBeNull();
    } finally {
      HTMLAnchorElement.prototype.click = original;
      exportLoaders.png = realPng;
    }
  });
});
