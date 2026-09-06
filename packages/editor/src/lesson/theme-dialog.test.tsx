import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderEditor } from "./test-harness";

/* TEACH-105 row 8: the theme dialog switches `themeId`; Cancel puts the opening theme back. */

afterEach(cleanup);

describe("ThemeDialog", () => {
  test("Theme → Playground sets lesson.themeId, the tile is checked, Done closes as one undo step and one save", async () => {
    const { read, onSave } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const dialog = await screen.findByRole("dialog", { name: "Theme" });
    const tiles = screen.getAllByRole("radio");
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    const paper = tiles.find((t) => t.getAttribute("data-theme-tile") === "playground");
    if (!paper) throw new Error("no playground tile");
    fireEvent.click(paper);
    expect(read().themeId).toBe("playground");
    expect(paper).toHaveAttribute("aria-checked", "true");
    // Browsing inside the dialog records nothing (the top bar is aria-hidden behind the modal);
    // Done commits the whole browse as one step.
    expect(screen.getByRole("button", { name: "Undo", hidden: true })).toBeDisabled();
    const other = tiles.find((t) => t.getAttribute("data-theme-tile") === "beacon");
    if (other) fireEvent.click(other);
    fireEvent.click(paper);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(read().themeId).toBe("playground");
    expect(screen.getByRole("button", { name: "Undo" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().themeId).toBe("chalk");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    // Done's change and the undo land inside one debounce window: one write, of the final state.
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(onSave.mock.calls[0]?.[0]?.themeId).toBe("chalk");
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
    // A cancelled browse is not an edit: nothing to undo, nothing to save.
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  test("Escape (the dialog's own close) also rolls the browse back", async () => {
    const { read } = renderEditor();
    const opening = read().themeId;
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const dialog = await screen.findByRole("dialog", { name: "Theme" });
    const other = screen
      .getAllByRole("radio")
      .find((t) => t.getAttribute("aria-checked") !== "true");
    if (other) fireEvent.click(other);
    expect(read().themeId).not.toBe(opening);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(read().themeId).toBe(opening);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
