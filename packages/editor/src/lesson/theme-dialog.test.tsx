import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderEditor } from "./test-harness";

/* TEACH-105 row 8: the theme dialog switches `themeId`; Cancel puts the opening theme back. */

afterEach(cleanup);

describe("ThemeDialog", () => {
  test("Theme → Playground sets lesson.themeId, the tile is checked, Done closes", async () => {
    const { read } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const dialog = await screen.findByRole("dialog", { name: "Theme" });
    const tiles = screen.getAllByRole("radio");
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    const paper = tiles.find((t) => t.getAttribute("data-theme-tile") === "playground");
    if (!paper) throw new Error("no playground tile");
    fireEvent.click(paper);
    expect(read().themeId).toBe("playground");
    expect(paper).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(read().themeId).toBe("playground");
  });

  test("Cancel restores the theme the dialog opened with; the tag filter narrows the tiles", async () => {
    const { read } = renderEditor();
    const opening = read().themeId;
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    await screen.findByRole("dialog", { name: "Theme" });
    const other = screen
      .getAllByRole("radio")
      .find((t) => t.getAttribute("aria-checked") !== "true");
    if (!other) throw new Error("no other tile");
    fireEvent.click(other);
    expect(read().themeId).not.toBe(opening);
    fireEvent.click(screen.getByRole("button", { name: "Dark room" }));
    expect(screen.getAllByRole("radio").length).toBeLessThan(6);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(read().themeId).toBe(opening);
  });
});
