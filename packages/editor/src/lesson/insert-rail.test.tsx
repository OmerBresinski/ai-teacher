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

  test("Question slide → Multiple choice adds a slide after the active one", async () => {
    const { read } = renderEditor();
    const before = read().slides.length;
    openMenu(within(rail()).getByRole("button", { name: "Question slide" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Multiple choice" }));
    expect(read().slides).toHaveLength(before + 1);
    expect(read().slides[1]?.kind).toBe("multiple-choice");
  });

  test("Image is off with a tooltip; Info shows the lesson's facts and edits the subject", async () => {
    const { read } = renderEditor();
    expect(within(rail()).getByRole("button", { name: "Image" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
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
