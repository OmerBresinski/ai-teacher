import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { starterWorksheet } from "../model/worksheet-factories";
import { WorksheetPrint } from "./WorksheetPrint";

/**
 * happy-dom measures every block at 0pt, so the whole sheet lands on one page; that is fine — the
 * unit under test here is the ready gate and the one-shot `window.print()`. Real pagination is the
 * Playwright spec's (`apps/web/e2e/worksheet-print.spec.ts`).
 */

/** `whenFontsReady` resolves on a microtask and the print fires two frames later: let both land. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("WorksheetPrint", () => {
  test("renders the sheet and the measuring column, and becomes visible once measured", async () => {
    const worksheet = starterWorksheet("Print me");
    const { container } = render(<WorksheetPrint worksheet={worksheet} />);
    const root = container.querySelector(".ws-print-root") as HTMLElement;
    expect(container.querySelector(".ws-measure")).not.toBeNull();
    expect(root.style.visibility).toBe("hidden");
    await settle();
    expect(root.style.visibility).toBe("");
    expect(container.querySelectorAll(".ws-print-root .ws-page")).toHaveLength(1);
    expect(container.querySelector("style")?.textContent).toBe("@page { size: A4; }");
    expect(container.querySelector(".ws-print-hint")).toBeNull();
  });

  test("auto calls window.print exactly once after the fonts are ready", async () => {
    const print = mock(() => {});
    const original = window.print;
    window.print = print;
    try {
      const worksheet = { ...starterWorksheet("Auto"), pageSize: "Letter" as const };
      const view = render(<WorksheetPrint worksheet={worksheet} auto />);
      // One settle for the ready gate (a state update, so its effect runs as act ends), one for the
      // two animation frames the print waits for.
      await settle();
      await settle();
      expect(print).toHaveBeenCalledTimes(1);
      expect(view.container.querySelector("style")?.textContent).toBe("@page { size: Letter; }");
      // A re-render does not print again.
      view.rerender(<WorksheetPrint worksheet={worksheet} auto />);
      await settle();
      expect(print).toHaveBeenCalledTimes(1);
    } finally {
      window.print = original;
    }
  });

  test("without auto, window.print is never called", async () => {
    const print = mock(() => {});
    const original = window.print;
    window.print = print;
    try {
      render(<WorksheetPrint worksheet={starterWorksheet("Manual")} />);
      await settle();
      await settle();
      expect(print).not.toHaveBeenCalled();
    } finally {
      window.print = original;
    }
  });
});
