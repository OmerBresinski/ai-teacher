import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderEditor } from "./test-harness";

/* TEACH-105 row 7: every rail item inserts its element at the centre and selects it. */

afterEach(cleanup);

const rail = () => screen.getByRole("toolbar", { name: "Insert" });
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });
const selectedFrame = (container: HTMLElement) => container.querySelector("[data-selection-frame]");

describe("InsertRail", () => {
  test("Text → Heading inserts a text element, selects it and opens the editor", async () => {
    const { container, read } = renderEditor();
    const before = read().slides[0]?.elements.length ?? 0;
    openMenu(within(rail()).getByRole("button", { name: "Text" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Heading" }));
    const els = read().slides[0]?.elements ?? [];
    expect(els).toHaveLength(before + 1);
    const added = els[els.length - 1];
    expect(added?.type).toBe("text");
    expect(added).toMatchObject({ style: { preset: "heading" } });
    // Centred on the slide.
    expect(Math.round((added?.x ?? 0) + (added?.w ?? 0) / 2)).toBe(480);
    expect(selectedFrame(container)).not.toBeNull();
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
  });

  test("Shape → Ellipse, Line → Arrow, Table, Timer, Embed each insert their type", async () => {
    const { read } = renderEditor();
    const types = () => (read().slides[0]?.elements ?? []).map((e) => e.type);
    const n = types().length;

    openMenu(within(rail()).getByRole("button", { name: "Shape" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ellipse" }));
    expect(read().slides[0]?.elements[n]).toMatchObject({ type: "shape", shape: "ellipse" });

    openMenu(within(rail()).getByRole("button", { name: "Line" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Arrow" }));
    expect(read().slides[0]?.elements[n + 1]).toMatchObject({ type: "line", arrowEnd: true });

    fireEvent.click(within(rail()).getByRole("button", { name: "Table" }));
    fireEvent.click(within(rail()).getByRole("button", { name: "Timer" }));
    fireEvent.click(within(rail()).getByRole("button", { name: "Embed" }));
    expect(types().slice(n)).toEqual(["shape", "line", "table", "timer", "embed"]);
  });

  test("Icon picker filters by name and inserts an icon", async () => {
    const { read } = renderEditor();
    fireEvent.click(within(rail()).getByRole("button", { name: "Icon" }));
    const search = await screen.findByRole("textbox", { name: "Search icons" });
    fireEvent.change(search, { target: { value: "star" } });
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    const els = read().slides[0]?.elements ?? [];
    expect(els[els.length - 1]).toMatchObject({ type: "icon", icon: "star" });
  });

  test("Activities opens the picker grouped Check, Apply, Structure and inserts after the active slide", async () => {
    const { read } = renderEditor();
    const before = read().slides.length;
    fireEvent.click(within(rail()).getByRole("button", { name: "Activities" }));
    expect(
      await screen.findByRole("tab", { name: "Activities", selected: true }),
    ).toBeInTheDocument();
    const menu = await screen.findByRole("menu", { name: "Activities" });
    const groups = within(menu)
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Check", "Apply", "Structure"]);
    const check = within(menu).getByRole("group", { name: "Check" });
    expect(
      within(check)
        .getAllByRole("menuitem")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["True or false", "Multiple choice", "Which are true", "Fill the gap"]);
    // A card previews the slide it inserts and says what pupils see.
    const mc = within(check).getByRole("menuitem", { name: "Multiple choice" });
    expect(mc.getAttribute("aria-description")).toContain("Pupils see four options");
    expect(mc.querySelector("[data-slide-mode='thumb']")).not.toBeNull();
    fireEvent.click(mc);
    expect(read().slides).toHaveLength(before + 1);
    expect(read().slides[1]?.kind).toBe("multiple-choice");
    expect(read().slides[1]?.elements.filter((el) => el.type === "option")).toHaveLength(4);
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Activities" })).toBeNull());
    // The old dropdown is gone.
    expect(within(rail()).queryByRole("button", { name: "Question slide" })).toBeNull();
  });

  test("Which are true inserts a multi multiple choice; the Challenge chip adds an Explain why line", async () => {
    const { read } = renderEditor();
    fireEvent.click(within(rail()).getByRole("button", { name: "Activities" }));
    const menu = await screen.findByRole("menu", { name: "Activities" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Which are true" }));
    const which = read().slides[1];
    expect(which?.kind).toBe("multiple-choice");
    if (which?.question?.type !== "multiple-choice") throw new Error("no question");
    expect(which.question.multi).toBe(true);
    expect(which.question.options.filter((o) => o.correct)).toHaveLength(2);

    fireEvent.click(within(rail()).getByRole("button", { name: "Activities" }));
    const again = await screen.findByRole("menu", { name: "Activities" });
    fireEvent.click(screen.getByRole("radio", { name: "Challenge" }));
    fireEvent.click(within(again).getByRole("menuitem", { name: "Multiple choice" }));
    const challenge = read().slides[2];
    expect(challenge?.kind).toBe("multiple-choice");
    const last = challenge?.elements[challenge.elements.length - 1];
    expect(last?.type).toBe("text");
    expect(JSON.stringify(last)).toContain("Explain why.");
  });

  test("Activities keyboard: arrows walk every card across groups, Escape closes", async () => {
    renderEditor();
    fireEvent.click(within(rail()).getByRole("button", { name: "Activities" }));
    const menu = await screen.findByRole("menu", { name: "Activities" });
    const cards = within(menu).getAllByRole("menuitem");
    expect(cards).toHaveLength(12);
    expect(cards.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    cards[0]?.focus();
    for (let i = 0; i < cards.length - 1; i++) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
      expect(document.activeElement === cards[i + 1]).toBe(true);
    }
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Timer");
    // Up and Down keep the column across group boundaries, clamped on a ragged last row.
    const focused = () => document.activeElement?.getAttribute("aria-label");
    const press = (key: string) =>
      fireEvent.keyDown(document.activeElement as HTMLElement, { key });
    const walk: [string, string][] = [
      ["ArrowUp", "Discussion"], // Structure col 2 -> Apply last row, clamped to its end
      ["ArrowUp", "Image matching"], // Apply row 1 col 1 -> row 0 col 1
      ["ArrowUp", "Fill the gap"], // Apply row 0 col 1 -> Check last row, clamped
      ["ArrowDown", "Matching"], // Check last row col 0 -> Apply row 0 col 0
      ["ArrowRight", "Image matching"],
      ["ArrowRight", "Sort"],
      ["ArrowUp", "Fill the gap"], // Apply row 0 col 2 -> Check last row, clamped
      ["ArrowUp", "True or false"], // Check row 1 col 0 -> row 0 col 0
      ["ArrowUp", "True or false"], // nothing above the first group
      ["ArrowRight", "Multiple choice"],
      ["ArrowRight", "Which are true"],
      ["ArrowDown", "Fill the gap"], // Check row 0 col 2 -> row 1, clamped
      ["ArrowDown", "Matching"],
      ["ArrowDown", "Open response"], // Apply row 0 col 0 -> row 1 col 0
      ["ArrowRight", "Discussion"],
      ["ArrowDown", "Exit ticket"], // Apply last row col 1 -> Structure row 0 col 1
      ["ArrowDown", "Exit ticket"], // nothing below the last group
    ];
    for (const [key, expected] of walk) {
      press(key);
      expect(focused()).toBe(expected);
    }
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Activities" })).toBeNull());
  });

  test("Image opens the Add image panel; Info shows the lesson's facts and edits the subject", async () => {
    const { read } = renderEditor();
    fireEvent.click(within(rail()).getByRole("button", { name: "Image" }));
    const image = await screen.findByRole("dialog", { name: "Add image" });
    fireEvent.keyDown(image, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add image" })).toBeNull());
    fireEvent.click(within(rail()).getByRole("button", { name: "Info" }));
    const info = await screen.findByRole("dialog", { name: "Lesson information" });
    expect(within(info).getByText("Seed lesson")).toBeInTheDocument();
    expect(within(info).getByText(/3 slides/)).toBeInTheDocument();
    fireEvent.click(within(info).getByRole("button", { name: "Edit" }));
    const subject = screen.getByRole("textbox", { name: "Subject" });
    fireEvent.change(subject, { target: { value: "Science" } });
    expect(read().subject).toBe("Science");
  });
});
