import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@tj/ui";
import { newSlide } from "../model/factories";
import { demoLibrary } from "../model/starter";
import { type PresentProgress, PresentView } from "./PresentView";
import { PRESENT_SHORTCUTS } from "./shortcuts";

function lesson() {
  const l = demoLibrary()[0];
  if (!l) throw new Error("demo lesson missing");
  // Add a slide with build steps so Space walks steps before slides.
  l.slides.splice(1, 0, newSlide("worked-example", l.themeId));
  return l;
}

function renderPresent(props: Partial<React.ComponentProps<typeof PresentView>> = {}) {
  const l = props.lesson ?? lesson();
  const onExit = mock(() => {});
  const onProgress = mock((_p: PresentProgress) => {});
  const utils = render(
    <TooltipProvider>
      <PresentView lesson={l} onExit={onExit} onProgress={onProgress} {...props} />
    </TooltipProvider>,
  );
  return { ...utils, lesson: l, onExit, onProgress };
}

const status = () =>
  screen
    .getAllByRole("status")
    .map((el) => el.textContent)
    .join(" ");
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: k, ...init });

async function start() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Stay in this window" }));
}

describe("PresentView", () => {
  it("opens on the cover; Start shows slide 1 on the stage scope", async () => {
    const { container, lesson: l } = renderPresent();
    expect(container.querySelector("[data-present-root]")).toHaveClass("tj-stage");
    expect(screen.getByRole("heading", { level: 1, name: l.title })).toBeVisible();
    await start();
    expect(status()).toContain(`Slide 1 of ${l.slides.length}`);
    expect(container.querySelector('[data-slide-mode="present"]')).not.toBeNull();
  });

  it("Space walks steps then slides; ArrowLeft returns; Home/End jump", async () => {
    const { lesson: l } = renderPresent();
    await start();
    key(" ");
    expect(status()).toContain("Slide 2 of");
    expect(status()).toMatch(/step 1 of \d/);
    key(" ");
    expect(status()).toMatch(/step 2 of \d/);
    key("ArrowLeft");
    expect(status()).toMatch(/step 1 of \d/);
    key("End");
    expect(status()).toContain(`Slide ${l.slides.length} of`);
    key("Home");
    expect(status()).toContain("Slide 1 of");
  });

  it("digits then Enter jump to a slide; the hint shows the number", async () => {
    renderPresent();
    await start();
    key("3");
    expect(screen.getByText(/Go to slide 3/)).toBeVisible();
    key("Enter");
    expect(status()).toContain("Slide 3 of");
  });

  it("B blacks out and any key restores; W whites out", async () => {
    const { container } = renderPresent();
    await start();
    const overlay = () =>
      container.querySelector("[data-present-stage] > [aria-hidden]") as HTMLElement;
    expect(overlay().style.opacity).toBe("0");
    key("b");
    expect(overlay().style.opacity).toBe("1");
    expect(overlay().style.background).toMatch(/#000000|rgb\(0, 0, 0\)/);
    key("ArrowRight");
    // The key only restored the slide; it did not advance.
    expect(overlay().style.opacity).toBe("0");
    expect(status()).toContain("Slide 1 of");
    key("w");
    expect(overlay().style.background).toMatch(/#FFFFFF|rgb\(255, 255, 255\)/i);
  });

  it("O opens the overview; a tile jumps; Esc closes it without exiting", async () => {
    const { onExit } = renderPresent();
    await start();
    key("o");
    const dialog = await screen.findByRole("dialog");
    const tiles = within(dialog).getAllByRole("button", { name: /^Slide \d/ });
    expect(tiles.length).toBeGreaterThan(3);
    fireEvent.click(tiles[2] as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(status()).toContain("Slide 3 of");
    key("o");
    await screen.findByRole("dialog");
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("? lists every shortcut; Esc closes the sheet first, a second Esc exits", async () => {
    const { onExit } = renderPresent();
    await start();
    key("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    for (const s of PRESENT_SHORTCUTS) expect(within(dialog).getByText(s.label)).toBeVisible();
    // Radix owns Escape inside the dialog; our handler sees the flag cleared through onOpenChange.
    fireEvent.keyDown(dialog, { key: "Escape" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    key("Escape");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("a tool then Esc: the tool closes first", async () => {
    const { onExit } = renderPresent();
    await start();
    key("p");
    expect(screen.getByRole("button", { name: "Pen" })).toHaveAttribute("aria-pressed", "true");
    key("Escape");
    expect(screen.getByRole("button", { name: "Pen" })).toHaveAttribute("aria-pressed", "false");
    expect(onExit).not.toHaveBeenCalled();
  });

  it("the end card offers Back to start and Exit; Next lesson when in a series", async () => {
    const onOpen = mock(() => {});
    const { onExit } = renderPresent({ next: { title: "Life in the Roman army", onOpen } });
    await start();
    key("End");
    key(" ");
    expect(screen.getByRole("heading", { name: "End of lesson" })).toBeVisible();
    expect(screen.getByText("Next: Life in the Roman army")).toBeVisible();
    key(" ");
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Back to start" }));
    expect(status()).toContain("Slide 1 of");
    key("End");
    key(" ");
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("N opens the presenter notes with the next slide; T opens the timer panel", async () => {
    renderPresent();
    await start();
    key("n");
    const notes = screen.getByRole("complementary", { name: "Presenter notes" });
    expect(within(notes).getByText("Next slide")).toBeVisible();
    key("t");
    expect(await screen.findByRole("radiogroup", { name: "Timer mode" })).toBeVisible();
  });

  it("onProgress reports the furthest slide once on exit; exit on slide 1 is not 'taught'", async () => {
    const first = renderPresent();
    await start();
    key("Escape");
    expect(first.onProgress).toHaveBeenCalledTimes(1);
    expect(first.onProgress.mock.calls[0]?.[0]).toEqual({
      reachedSlideId: first.lesson.slides[0]?.id ?? "",
      exitedPastFirst: false,
    });
    first.unmount();

    const second = renderPresent();
    await start();
    key("End");
    key("Home");
    key("Escape");
    expect(second.onProgress).toHaveBeenCalledTimes(1);
    expect(second.onProgress.mock.calls[0]?.[0]).toEqual({
      reachedSlideId: second.lesson.slides[second.lesson.slides.length - 1]?.id ?? "",
      exitedPastFirst: true,
    });
    // Unmounting after an explicit exit does not report twice.
    second.unmount();
    expect(second.onProgress).toHaveBeenCalledTimes(1);
  });

  it("unmount without exit (browser back) still reports progress", async () => {
    const { onProgress, unmount } = renderPresent();
    await start();
    key("ArrowRight");
    unmount();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0]?.[0]?.exitedPastFirst).toBe(true);
  });

  it("a committed stroke does not rebind the key handler: a typed jump number survives it", async () => {
    const { container } = renderPresent();
    await start();
    key("p");
    key("3");
    expect(screen.getByText(/Go to slide 3/)).toBeVisible();
    // Commit a stroke on the pen layer (the interactive svg; [1] is the highlighter blend layer).
    const svg = container.querySelectorAll("[data-present-stage] svg")[2] as SVGSVGElement;
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 960,
        height: 540,
        right: 960,
        bottom: 540,
        x: 0,
        y: 0,
      }) as DOMRect;
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 100, buttons: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(svg.querySelectorAll("path[d]:not([d=''])").length).toBe(1);
    // The pending jump still lands.
    key("Enter");
    expect(status()).toContain("Slide 3 of");
  });

  it("?slide= starts on that slide", async () => {
    renderPresent({ startIndex: 3 });
    await start();
    expect(status()).toContain("Slide 4 of");
  });
});
