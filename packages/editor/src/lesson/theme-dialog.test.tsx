import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { demoLibrary } from "../model/starter";
import { THEMES } from "../model/themes";
import { displayInTheme, GeneratingThemeDialog, ThemeCallout } from "./ThemeDialog";
import { renderEditor } from "./test-harness";

/*
 * TEACH-105 row 8, TEACH-258 (ruling 116): the theme picker at the head of the slide rail switches
 * `themeId`; Cancel puts the opening theme back; Done is one undo step.
 */

afterEach(cleanup);

describe("ThemeDialog", () => {
  test("Theme → Playground sets lesson.themeId, the tile is checked, Done closes as one undo step and one save", async () => {
    const { read, onSave } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
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

  test("Cancel restores the theme the picker opened with", async () => {
    const { read } = renderEditor();
    const opening = read().themeId;
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    await screen.findByRole("dialog", { name: "Theme" });
    const other = screen
      .getAllByRole("radio")
      .find((t) => t.getAttribute("aria-checked") !== "true");
    if (!other) throw new Error("no other tile");
    fireEvent.click(other);
    expect(read().themeId).not.toBe(opening);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(read().themeId).toBe(opening);
    // A cancelled browse is not an edit: nothing to undo, nothing to save.
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  test("Escape (the dialog's own close) also rolls the browse back", async () => {
    const { read } = renderEditor();
    const opening = read().themeId;
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
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

  test("Done on a new theme applies the theme and its re-fit as one undo step; undo restores the theme and every slide (TEACH-258)", async () => {
    const { read } = renderEditor();
    const before = read();
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    const dialog = await screen.findByRole("dialog", { name: "Theme" });
    const beacon = screen
      .getAllByRole("radio")
      .find((t) => t.getAttribute("data-theme-tile") === "beacon");
    if (!beacon) throw new Error("no beacon tile");
    fireEvent.click(beacon);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(read().themeId).toBe("beacon");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().themeId).toBe(before.themeId);
    expect(read().slides).toEqual(before.slides);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

describe("where the theme lives (ruling 123)", () => {
  test("the top bar names the selected theme with its swatch; the slide rail has no picker", () => {
    renderEditor();
    const callout = screen.getByRole("button", { name: /^Theme:/ });
    expect(callout.closest("[data-topbar]")).not.toBeNull();
    expect(callout).toHaveAccessibleName("Theme: Chalk & Cream");
    expect(callout).toHaveTextContent("Theme · Chalk & Cream");
    expect(callout.querySelector("[data-theme-swatch]")).not.toBeNull();
    expect(document.querySelector("[data-navigator]")?.textContent).not.toContain("Theme");
  });

  test("the callout follows the lesson's theme after Done", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    const dialog = await screen.findByRole("dialog", { name: "Theme" });
    const beacon = screen
      .getAllByRole("radio")
      .find((t) => t.getAttribute("data-theme-tile") === "beacon");
    if (!beacon) throw new Error("no beacon tile");
    fireEvent.click(beacon);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Theme:/ })).toHaveAttribute(
      "data-theme-callout",
      "beacon",
    );
  });

  test("each tile is the lesson's own title slide", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    await screen.findByRole("dialog", { name: "Theme" });
    const tiles = screen.getAllByRole("radio");
    expect(tiles).toHaveLength(THEMES.length);
    for (const tile of tiles) expect(tile.querySelector("[data-slide-root]")).not.toBeNull();
  });
});

describe("while the lesson is being made (ruling 123)", () => {
  const lesson = demoLibrary()[0];
  if (!lesson) throw new Error("no demo lesson");

  test("displayInTheme recolours the made slides by role and leaves the lesson alone", () => {
    const shown = displayInTheme(lesson, "night-lab");
    expect(shown.themeId).toBe("night-lab");
    expect(shown.slides).toHaveLength(lesson.slides.length);
    expect(JSON.stringify(shown.slides)).not.toEqual(JSON.stringify(lesson.slides));
    expect(displayInTheme(lesson, null)).toBe(lesson);
    expect(displayInTheme(lesson, lesson.themeId)).toBe(lesson);
  });

  function Harness({ onChange }: { onChange: (id: string) => void }) {
    const [themeId, setThemeId] = useState(lesson?.themeId ?? "chalk");
    const [open, setOpen] = useState(false);
    const shown = lesson ? displayInTheme(lesson, themeId) : null;
    if (!shown) return null;
    return (
      <>
        <ThemeCallout themeId={shown.themeId} onClick={() => setOpen(true)} />
        <GeneratingThemeDialog
          open={open}
          lesson={shown}
          onChange={(id) => {
            onChange(id);
            setThemeId(id);
          }}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  test("a tile re-themes live, Done keeps it, Cancel goes back to the opening theme", async () => {
    const changes: string[] = [];
    render(<Harness onChange={(id) => changes.push(id)} />);
    const opening = screen
      .getByRole("button", { name: /^Theme:/ })
      .getAttribute("data-theme-callout");
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    let dialog = await screen.findByRole("dialog", { name: "Theme" });
    const nightLab = () =>
      screen.getAllByRole("radio").find((t) => t.getAttribute("data-theme-tile") === "night-lab");
    fireEvent.click(nightLab() as HTMLElement);
    expect(nightLab()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const callout = screen.getByRole("button", { name: /^Theme:/ });
    expect(callout).toHaveAttribute("data-theme-callout", "night-lab");

    fireEvent.click(callout);
    dialog = await screen.findByRole("dialog", { name: "Theme" });
    const other = screen
      .getAllByRole("radio")
      .find((t) => t.getAttribute("data-theme-tile") === opening);
    fireEvent.click(other as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Theme:/ })).toHaveAttribute(
      "data-theme-callout",
      "night-lab",
    );
    expect(changes).toEqual(["night-lab", opening ?? "", "night-lab"]);
  });
});

describe("the theme callout names every theme (TEACH-111)", () => {
  for (const theme of THEMES) {
    test(`${theme.id}: its name and its own ground and accent in the swatch`, () => {
      const { container } = render(<ThemeCallout themeId={theme.id} onClick={() => {}} />);
      expect(screen.getByRole("button", { name: `Theme: ${theme.name}` })).toBeTruthy();
      const swatch = container.querySelector<HTMLElement>("[data-theme-swatch]");
      const half = swatch?.firstElementChild as HTMLElement | null;
      const hex = (css: string | undefined) => css?.toUpperCase().replace(/\s/g, "");
      const rgb = (h: string) =>
        `RGB(${[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(",")})`;
      for (const [el, want] of [
        [swatch, theme.colors.background],
        [half, theme.colors.accent],
      ] as const) {
        expect([want.toUpperCase(), rgb(want)]).toContain(hex(el?.style.background) ?? "");
      }
      cleanup();
    });
  }
});
