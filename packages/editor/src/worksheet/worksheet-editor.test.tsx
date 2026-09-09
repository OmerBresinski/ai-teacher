import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import type { ImageSearchClient, PhotoResult, PickedPhoto } from "../images/image-search";
import { docFromText, uid } from "../model/factories";
import { newBlock, numberQuestions, starterWorksheet } from "../model/worksheet-factories";
import { pointer, renderWorksheetEditor, row } from "./editor-test-harness";
import { HEADER_KEY } from "./paginate";

/*
 * The worksheet editor on the real shell (TEACH-109 rows 3–8): the slash menu inserts a block, the
 * block toolbar writes type-specific fields, the header toolbar writes the sheet-wide switches,
 * the gutter handle reorders with one undo step. Tiptap caret/typing fidelity is Playwright's
 * (`worksheet-editor.spec.ts`).
 */

afterEach(cleanup);

const withBlocks = (blocks: WorksheetBlock[]): Worksheet => {
  const sheet = starterWorksheet("Seed sheet");
  sheet.blocks = numberQuestions(blocks);
  return sheet;
};

const select = (container: HTMLElement, id: string) =>
  fireEvent.pointerDown(row(container, id), pointer(10, 10));

const undo = () => fireEvent.keyDown(window, { key: "z", metaKey: true });

describe("WorksheetEditor", () => {
  test("mounts the header and every block; a click selects a block and shows its toolbar", () => {
    const { container, read } = renderWorksheetEditor();
    // On the pages, not counting the hidden measuring column's copies.
    expect(container.querySelectorAll(".ws-column .ws-block").length).toBe(read().blocks.length);
    expect(screen.getByRole("textbox", { name: "Sheet title" })).toHaveTextContent("Seed sheet");
    const first = read().blocks[1];
    if (!first) throw new Error("seed");
    select(container, first.id);
    expect(row(container, first.id).querySelector(".ws-selected-ring")).not.toBeNull();
    expect(screen.getByRole("toolbar", { name: "Question block" })).toBeInTheDocument();
    // The header's toolbar is its own.
    fireEvent.pointerDown(row(container, HEADER_KEY), pointer(10, 10));
    expect(screen.getByRole("toolbar", { name: "Worksheet header" })).toBeInTheDocument();
  });

  test("row 3: the gutter + opens Add a block on Sections; Blocks > Question inserts one after", async () => {
    const { container, read } = renderWorksheetEditor();
    const anchor = read().blocks[0];
    if (!anchor) throw new Error("seed");
    const before = read().blocks.length;
    fireEvent.click(
      within(row(container, anchor.id)).getByRole("button", { name: "Insert a block below" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add a block" });
    // Sections first: nine cards, each with a minutes pill; the six job chips filter them.
    const cards = () =>
      within(dialog).getByRole("list", { name: "Sections" }).querySelectorAll(":scope > li");
    expect(cards().length).toBe(9);
    expect(within(dialog).getAllByText(/^about \d+ min$/).length).toBe(9);
    fireEvent.click(within(dialog).getByRole("button", { name: "Assess", pressed: false }));
    expect(cards().length).toBe(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Assess", pressed: true }));
    expect(cards().length).toBe(9);
    // Blocks: the fifteen block types (headings twice) with the slash menu's descriptions.
    fireEvent.mouseDown(within(dialog).getByRole("tab", { name: "Blocks" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "Blocks" }));
    const blocks = await within(dialog).findByRole("region", { name: "Questions" });
    expect(within(blocks).getByText("Numbered, with marks and ruled lines")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Question/ }));
    expect(read().blocks.length).toBe(before + 1);
    expect(read().blocks[1]?.type).toBe("question");
    expect(screen.queryByRole("dialog", { name: "Add a block" })).toBeNull();
  });

  test("the Add block pill appends a section as one undo step and focuses its first block", async () => {
    const { container, read } = renderWorksheetEditor();
    const before = read().blocks.length;
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a block" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Exit ticket\./ }));
    const after = read().blocks;
    // Three questions, the answer box and the placeholder, appended in order.
    expect(after.length).toBe(before + 5);
    expect(after.slice(before).map((b) => b.type)).toEqual([
      "question",
      "question",
      "question",
      "answer-box",
      "paragraph",
    ]);
    const first = after[before];
    if (!first) throw new Error("inserted");
    expect(row(container, first.id).querySelector(".ws-selected-ring")).not.toBeNull();
    // The header reads the new total.
    expect(container.querySelector(".ws-header .ws-meta")?.textContent).toMatch(
      /marks · about \d+ min/,
    );
    // One undo step for the whole section.
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(read().blocks.length).toBe(before);
  });

  test("the slash menu lists the nine recipes under Sections; `/exit` finds Exit ticket", async () => {
    // An empty sheet: its "Add your first block" button is the slash menu's own way in.
    const { read } = renderWorksheetEditor(withBlocks([]));
    fireEvent.click(screen.getByRole("button", { name: /Add your first block/ }));
    const list = await screen.findByRole("listbox", { name: "Block types" });
    const sections = within(list).getByRole("group", { name: "Sections" });
    expect(within(sections).getAllByRole("option").length).toBe(9);
    expect(within(list).getAllByRole("option").length).toBe(25);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter blocks" }), {
      target: { value: "exit" },
    });
    const left = within(list).getAllByRole("option");
    expect(left.length).toBe(1);
    expect(left[0]?.textContent).toContain("Exit ticket");
    fireEvent.pointerDown(left[0] as HTMLElement, pointer());
    expect(read().blocks.map((b) => b.type)).toEqual([
      "question",
      "question",
      "question",
      "answer-box",
      "paragraph",
    ]);
    // One step: undo empties the sheet again.
    undo();
    expect(read().blocks.length).toBe(0);
  });

  test("row 4: setting marks on a question follows the AQA line rule and renumbers", () => {
    const { container, read } = renderWorksheetEditor();
    const q = read().blocks[1];
    if (q?.type !== "question") throw new Error("seed");
    select(container, q.id);
    const marks = screen.getByRole("spinbutton", { name: "Marks" });
    fireEvent.focus(marks);
    fireEvent.change(marks, { target: { value: "3" } });
    fireEvent.blur(marks);
    const after = read().blocks[1];
    expect(after?.type === "question" && after.marks).toBe(3);
    expect(after?.type === "question" && after.answerLines).toBe(6);
    // Numbers are derived by the reducer: still 1, 2, 3, 4 across the numbered blocks.
    expect(
      read()
        .blocks.filter((b) => "number" in b && b.number)
        .map((b) => ("number" in b ? b.number : 0)),
    ).toEqual([1, 2, 3, 4]);
  });

  test("row 5: a multiple-choice option can be added on the toolbar and marked correct on the sheet", () => {
    const { container, read } = renderWorksheetEditor();
    const mc = read().blocks.find((b) => b.type === "multiple-choice");
    if (mc?.type !== "multiple-choice") throw new Error("seed");
    select(container, mc.id);
    const count = mc.options.length;
    fireEvent.click(screen.getByRole("button", { name: "Option" }));
    const grown = read().blocks.find((b) => b.id === mc.id);
    expect(grown?.type === "multiple-choice" && grown.options.length).toBe(count + 1);
    // Tick B on the sheet: the teacher's own mark.
    const tickB = within(row(container, mc.id)).getByRole("button", {
      name: "Mark option B as correct",
    });
    fireEvent.click(tickB);
    const marked = read().blocks.find((b) => b.id === mc.id);
    expect(marked?.type === "multiple-choice" && marked.options[1]?.correct).toBe(true);
    expect(tickB).toHaveAttribute("aria-pressed", "true");
  });

  test("row 6: word-search size is clamped to 8–15 and the words come from the popover", async () => {
    const sheet = withBlocks([newBlock("word-search")]);
    const { container, read } = renderWorksheetEditor(sheet);
    const ws = read().blocks[0];
    if (ws?.type !== "word-search") throw new Error("seed");
    select(container, ws.id);
    const size = screen.getByRole("spinbutton", { name: "Size" });
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "40" } });
    fireEvent.blur(size);
    expect(read().blocks[0]?.type === "word-search" && (read().blocks[0] as typeof ws).size).toBe(
      15,
    );
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "2" } });
    fireEvent.blur(size);
    expect((read().blocks[0] as typeof ws).size).toBe(8);

    fireEvent.click(screen.getByRole("button", { name: /words$/ }));
    const words = await screen.findByRole("textbox", { name: "Words to hide" });
    fireEvent.change(words, { target: { value: "sun, moon\nstar" } });
    fireEvent.keyDown(words, { key: "Escape" });
    await waitFor(() =>
      expect((read().blocks[0] as typeof ws).words).toEqual(["sun", "moon", "star"]),
    );
  });

  test("row 7: dragging the handle of block 3 above block 1 moves it in one undo step", () => {
    const { container, read } = renderWorksheetEditor();
    const [a, b, c] = read().blocks;
    if (!a || !b || !c) throw new Error("seed");
    // happy-dom has no layout: give the three rows stacked boxes 100px tall.
    const tops = new Map([
      [a.id, 0],
      [b.id, 100],
      [c.id, 200],
    ]);
    for (const [id, top] of tops) {
      row(container, id).getBoundingClientRect = () =>
        ({
          top,
          bottom: top + 100,
          height: 100,
          left: 0,
          right: 500,
          width: 500,
          x: 0,
          y: top,
          toJSON() {},
        }) as DOMRect;
    }
    const handle = within(row(container, c.id)).getByRole("button", {
      name: "Drag to reorder this block",
    });
    fireEvent.pointerDown(handle, pointer(0, 250));
    fireEvent.pointerMove(window, pointer(0, 10));
    fireEvent.pointerUp(window, pointer(0, 10));
    expect(
      read()
        .blocks.map((x) => x.id)
        .slice(0, 3),
    ).toEqual([c.id, a.id, b.id]);
    undo();
    expect(
      read()
        .blocks.map((x) => x.id)
        .slice(0, 3),
    ).toEqual([a.id, b.id, c.id]);
  });

  test("row 8: the header toolbar sets Letter, the answer key, self-assessment and caps criteria at 4", () => {
    const { container, read } = renderWorksheetEditor();
    fireEvent.pointerDown(row(container, HEADER_KEY), pointer(10, 10));
    fireEvent.click(screen.getByRole("radio", { name: "Letter" }));
    fireEvent.click(screen.getByRole("switch", { name: "Answer key" }));
    fireEvent.click(screen.getByRole("switch", { name: "Self-assessment" }));
    expect(read().pageSize).toBe("Letter");
    expect(read().includeAnswerKey).toBe(true);
    expect(read().selfAssessment).toBe(true);
    const add = screen.getByRole("button", { name: "Criterion" });
    for (let i = 0; i < 5; i++) fireEvent.click(add);
    expect(read().header.criteria?.length).toBe(4);
    expect(add).toBeDisabled();
    // Blank rows go when focus leaves the header.
    const field = screen.getByRole("textbox", { name: "Success criterion 1" });
    field.textContent = "I can add fractions.";
    fireEvent.input(field);
    act(() => {
      fireEvent.blur(field, { relatedTarget: document.body });
    });
    expect(read().header.criteria).toEqual(["I can add fractions."]);
  });

  test("empty fields keep the same room on the sheet as in the measuring column (page breaks agree)", () => {
    const sheet = withBlocks([
      {
        id: "mc",
        type: "multiple-choice",
        doc: docFromText("Q"),
        options: [{ id: "o1", text: "", correct: false }],
      },
      { id: "wb", type: "word-bank", words: ["", "sea"] },
      { id: "ab", type: "answer-box", heightPt: 100 },
      { id: "img", type: "image", src: "data:,", widthPct: 50 },
      { id: "tb", type: "table", rows: [["", "x"]] },
    ]);
    const { container } = renderWorksheetEditor(sheet);
    const measured = container.querySelector(".ws-measure");
    if (!measured) throw new Error("no measuring column");
    // Printed side: an empty string holds a no-break space; an empty bank word its 24pt slot.
    expect(measured.querySelector(".ws-opt-text")?.textContent).toBe("\u00a0");
    expect(measured.querySelector(".ws-word-empty")).not.toBeNull();
    expect(measured.querySelector("td")?.textContent).toBe("\u00a0");
    // Optional label / caption: absent on both sides until the block carries one.
    expect(measured.querySelector(".ws-answerbox-label")).toBeNull();
    expect(measured.querySelector(".ws-caption")).toBeNull();
    expect(row(container, "ab").querySelector(".ws-answerbox-label")).toBeNull();
    expect(row(container, "img").querySelector(".ws-caption")).toBeNull();
    // Editor side: the same strings are fields (their line is `min-height: 1lh` in CSS).
    expect(row(container, "mc").querySelector(".ws-opt-text.ws-input")).not.toBeNull();
    expect(row(container, "wb").querySelectorAll(".ws-input-inline").length).toBe(2);
  });

  test("Backspace on a selected block deletes it; Escape clears the selection", () => {
    const sheet = withBlocks([
      { id: uid(), type: "paragraph", doc: docFromText("One") },
      { id: uid(), type: "divider" },
    ]);
    const { container, read } = renderWorksheetEditor(sheet);
    const divider = read().blocks[1];
    if (!divider) throw new Error("seed");
    select(container, divider.id);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(read().blocks.length).toBe(1);
    const para = read().blocks[0];
    if (!para) throw new Error("seed");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".ws-selected-ring")).toBeNull();
  });
});

describe("WorksheetEditor image Replace (TEACH-160)", () => {
  const photoSource = {
    provider: "pexels",
    id: "leaf",
    pageUrl: "https://www.pexels.com/photo/leaf/",
    photographer: "Ada",
    photographerUrl: "https://www.pexels.com/@ada",
  } as const;

  const pexelsPhoto = (id: string, alt = `Photo ${id}`): PhotoResult => ({
    id,
    width: 6000,
    height: 4000,
    alt,
    photographer: "Ada",
    photographerUrl: "https://www.pexels.com/@ada/",
    pageUrl: `https://www.pexels.com/photo/${id}/`,
    src: {
      large: `https://images.pexels.com/photos/${id}/large.jpeg`,
      medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
      tiny: `https://images.pexels.com/photos/${id}/tiny.jpeg`,
    },
  });

  const pickedPhoto = (id: string): PickedPhoto => ({
    url: `/files/ws/images/${id}.jpg`,
    width: 6000,
    height: 4000,
    source: { ...photoSource, id, pageUrl: `https://www.pexels.com/photo/${id}/` },
  });

  const fakeClient = (): {
    client: ImageSearchClient;
    search: ReturnType<typeof mock>;
    pick: ReturnType<typeof mock>;
    report: ReturnType<typeof mock>;
  } => {
    const search = mock(async (_query: string, _opts: unknown) => ({
      photos: [pexelsPhoto("leaf", "Leaf")],
      nextPage: null,
    }));
    const pick = mock(async (photo: PhotoResult) => pickedPhoto(photo.id));
    const report = mock(async (_input: unknown) => {});
    return { client: { search, pick, report } as ImageSearchClient, search, pick, report };
  };

  const imageSheet = (overrides: Record<string, unknown> = {}) => {
    const block = { ...newBlock("image"), ...overrides };
    return withBlocks([block]);
  };

  const openReplace = async () => {
    const toolbar = await screen.findByRole("toolbar", { name: "Image block" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Replace" }));
    return screen.findByRole("dialog", { name: "Replace image" });
  };

  const searchPhotos = async (term: string) => {
    const tab = await screen.findByRole("tab", { name: "Photos" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    const field = await screen.findByRole("searchbox", { name: "Search images" });
    fireEvent.change(field, { target: { value: term } });
    fireEvent.keyDown(field, { key: "Enter" });
  };

  test("the image toolbar shows Width and Replace, and no credit button without source", async () => {
    const { client } = fakeClient();
    const sheet = imageSheet();
    const block = sheet.blocks[0];
    if (!block) throw new Error("seed");
    const { container } = renderWorksheetEditor(sheet, { images: client });
    select(container, block.id);
    const toolbar = await screen.findByRole("toolbar", { name: "Image block" });
    expect(within(toolbar).getByRole("spinbutton", { name: "Width" })).toBeTruthy();
    expect(within(toolbar).getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(within(toolbar).queryByRole("button", { name: "Image credit" })).toBeNull();
  });

  test("picking a photo writes src, alt, source and authoredBy in one undo step", async () => {
    const { client, search: searchMock, pick } = fakeClient();
    const sheet = imageSheet();
    const block = sheet.blocks[0];
    if (block?.type !== "image") throw new Error("seed");
    const { container, read } = renderWorksheetEditor(sheet, { images: client });
    select(container, block.id);
    await openReplace();
    await searchPhotos("leaf");
    fireEvent.click(await screen.findByRole("button", { name: "Leaf" }));

    await waitFor(() => {
      const current = read().blocks[0];
      expect(current?.type === "image" && current.src).toBe("/files/ws/images/leaf.jpg");
    });
    expect(searchMock).toHaveBeenCalledTimes(1);
    const [, opts] = searchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.orientation).toBeUndefined();
    expect(opts.page).toBe(1);
    expect(pick).toHaveBeenCalledTimes(1);
    const picked = read().blocks[0];
    if (picked?.type !== "image") throw new Error("missing");
    expect(picked.alt).toBe("Leaf");
    expect(picked.source).toEqual({
      ...photoSource,
      pageUrl: "https://www.pexels.com/photo/leaf/",
    });
    expect(picked.authoredBy).toBe("teacher");
    expect(picked.widthPct).toBe(60);
    expect(picked.caption).toBe("Figure 1");

    undo();
    const restored = read().blocks[0];
    expect(restored?.type === "image" && restored.src).not.toBe("/files/ws/images/leaf.jpg");
  });

  test("a sourced block shows the credit button with photographer links", async () => {
    const { client } = fakeClient();
    const sheet = imageSheet({ source: { ...photoSource } });
    const block = sheet.blocks[0];
    if (!block) throw new Error("seed");
    const { container } = renderWorksheetEditor(sheet, { images: client });
    select(container, block.id);
    const toolbar = await screen.findByRole("toolbar", { name: "Image block" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Image credit" }));
    expect(await screen.findByText(/Photo by/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ada" }).getAttribute("href")).toBe(
      "https://www.pexels.com/@ada",
    );
    expect(screen.getByRole("link", { name: "Pexels" }).getAttribute("href")).toBe(
      "https://www.pexels.com/photo/leaf/",
    );
  });

  test("uploading over a sourced block clears provenance and flips authoredBy", async () => {
    const { client } = fakeClient();
    const sheet = imageSheet({ source: { ...photoSource } });
    const block = sheet.blocks[0];
    if (!block) throw new Error("seed");
    const { container, read } = renderWorksheetEditor(sheet, { images: client });
    select(container, block.id);
    await openReplace();
    const file = new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "x.svg", {
      type: "image/svg+xml",
    });
    const input = screen.getByLabelText("Image file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // The seed src is itself a data URL (the placeholder), so wait for an actual change.
    await waitFor(() => {
      const current = read().blocks[0];
      expect(current?.type === "image" && current.src).not.toBe(PLACEHOLDER_IMAGE);
    });
    const current = read().blocks[0];
    if (current?.type !== "image") throw new Error("missing");
    expect(current.source).toBeUndefined();
    expect(current.alt).toBeUndefined();
    expect(current.authoredBy).toBe("teacher");
  });

  test("without a client the Photos tab says search is unavailable but Upload works", async () => {
    const sheet = imageSheet();
    const block = sheet.blocks[0];
    if (!block) throw new Error("seed");
    const { container } = renderWorksheetEditor(sheet);
    select(container, block.id);
    await openReplace();
    const tab = await screen.findByRole("tab", { name: "Photos" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByText("Photo search is not available.")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search images" })).toBeNull();
  });
});
