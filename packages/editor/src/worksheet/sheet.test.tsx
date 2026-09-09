import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { docFromText, uid } from "../model/factories";
import { getTheme } from "../model/themes";
import {
  newBlock,
  numberQuestions,
  starterWorksheet,
  type WorksheetBlockType,
} from "../model/worksheet-factories";
import { FlowItemContent } from "./BlockContent";
import { buildFlow, paginate } from "./paginate";
import { Sheet } from "./Sheet";

const EVERY_TYPE: WorksheetBlockType[] = [
  "heading",
  "paragraph",
  "instructions",
  "question",
  "multiple-choice",
  "fill-gap",
  "matching",
  "word-search",
  "word-bank",
  "answer-box",
  "lines",
  "image",
  "table",
  "divider",
  "page-break",
];

function everyBlockSheet(): Worksheet {
  const sheet = starterWorksheet("Every block");
  const blocks: WorksheetBlock[] = EVERY_TYPE.map((type) => newBlock(type));
  blocks.push({ id: uid(), type: "heading", doc: docFromText("Level two"), level: 2 });
  sheet.blocks = numberQuestions(blocks);
  sheet.includeAnswerKey = true;
  sheet.selfAssessment = true;
  sheet.header.criteria = ["I can add fractions.", ""];
  return sheet;
}

/** Fixed heights, since happy-dom lays nothing out: `paginate` is the unit under test elsewhere. */
const paginateFlat = (sheet: Worksheet) => {
  const items = buildFlow(sheet, sheet.includeAnswerKey);
  const heights = Object.fromEntries(items.map((item) => [item.key, 40]));
  return paginate(items, heights, 100, 400).pages;
};

afterEach(cleanup);

describe("Sheet", () => {
  test("renders every WorksheetBlock['type'], the header, the RAG strip and the answer key without throwing", () => {
    const sheet = everyBlockSheet();
    const pages = paginateFlat(sheet);
    expect(pages.length).toBeGreaterThan(1);
    const { container } = render(
      <Sheet worksheet={sheet} theme={getTheme(sheet.themeId)} pages={pages} mode="print" />,
    );
    expect(container.querySelectorAll(".ws-page")).toHaveLength(pages.length);
    expect(screen.getByRole("heading", { level: 1, name: "Every block" })).toBeInTheDocument();
    expect(screen.getByText(`Page 1 of ${pages.length}`)).toBeInTheDocument();
    expect(screen.getByText(`Page ${pages.length} of ${pages.length}`)).toBeInTheDocument();
    // Header fields and criteria.
    for (const label of ["Name", "Date", "Class"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(container.querySelectorAll(".ws-criterion")).toHaveLength(2);
    // Every block painted once on the sheet; the page break paints nothing in print mode.
    expect(container.querySelectorAll(".ws-page .ws-block")).toHaveLength(
      buildFlow(sheet, true).length,
    );
    expect(container.querySelector(".ws-pagebreak")).toBeNull();
    expect(container.querySelectorAll(".ws-q-no").length).toBeGreaterThanOrEqual(5);
    // Word search: a grid and its word bank; the answer key rings its words.
    expect(container.querySelector(".ws-search-grid")).not.toBeNull();
    expect(container.querySelectorAll(".ws-search-words li").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".ws-search-ring").length).toBeGreaterThan(0);
    // Self-assessment and answer key.
    expect(screen.getByRole("region", { name: "Self-assessment" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Answer key" })).toBeInTheDocument();
    expect(screen.getByText(/A\. Option A/)).toBeInTheDocument();
    expect(screen.getByText("1. evaporates")).toBeInTheDocument();
    // Fill-the-gap blanks are sized to the answer.
    const gaps = container.querySelectorAll(".ws-gap");
    expect(gaps.length).toBe(2);
    expect((gaps[0] as HTMLElement).style.width).toMatch(/pt$/);
    // Theme and paper travel as custom properties on the root.
    const root = container.querySelector(".ws-sheet") as HTMLElement;
    expect(root.style.getPropertyValue("--ws-page-w")).toBe("595pt");
    expect(root.style.getPropertyValue("--ws-print-w")).toBe("210mm");
  });

  test("marks print only with the sheet's Marks switch on; the answer key lists answers either way (TEACH-193)", () => {
    const sheet = everyBlockSheet();
    const off = { ...sheet, showMarks: undefined };
    const printOff = render(
      <Sheet
        worksheet={off}
        theme={getTheme(off.themeId)}
        pages={paginateFlat(off)}
        mode="print"
      />,
    );
    expect(printOff.container.querySelectorAll(".ws-marks")).toHaveLength(0);
    expect(printOff.container.querySelector(".ws-meta")?.textContent).toMatch(/^about \d+ min$/);
    expect(printOff.getByRole("heading", { level: 2, name: "Answer key" })).toBeInTheDocument();
    expect(printOff.container.querySelectorAll(".ws-key-entry").length).toBeGreaterThan(0);
    cleanup();
    const editOff = render(
      <Sheet worksheet={off} theme={getTheme(off.themeId)} pages={paginateFlat(off)} mode="edit" />,
    );
    expect(editOff.container.querySelectorAll(".ws-marks")).toHaveLength(0);
    cleanup();
    const on = { ...sheet, showMarks: true };
    const printOn = render(
      <Sheet worksheet={on} theme={getTheme(on.themeId)} pages={paginateFlat(on)} mode="print" />,
    );
    expect(printOn.container.querySelectorAll(".ws-marks").length).toBeGreaterThan(0);
    expect(printOn.container.querySelector(".ws-meta")?.textContent).toMatch(
      /^\d+ marks? · about \d+ min$/,
    );
  });

  test("edit mode shows the page-break marker and empty-stem hints; print mode leaves a blank", () => {
    const sheet = starterWorksheet("Hints");
    const empty: WorksheetBlock = { id: "e", type: "paragraph", doc: docFromText("") };
    const brk: WorksheetBlock = { id: "b", type: "page-break" };
    const worksheet = { ...sheet, blocks: [empty, brk] };
    const edit = render(
      <Sheet
        worksheet={worksheet}
        theme={getTheme("chalk")}
        pages={[{ index: 0, items: buildFlow(worksheet, false) }]}
        mode="edit"
      />,
    );
    expect(edit.getByText("Page break")).toBeInTheDocument();
    expect(edit.getByText("Type / to add a block")).toBeInTheDocument();
    cleanup();
    const print = render(
      <FlowItemContent item={{ kind: "block", block: empty }} worksheet={worksheet} mode="print" />,
    );
    expect(print.container.querySelector("[data-empty-hint]")).toBeNull();
    expect(print.container.textContent).toBe("\u00a0");
  });

  test("Letter paper and a header with no fields", () => {
    const sheet = starterWorksheet("Letter");
    sheet.pageSize = "Letter";
    sheet.header = { showName: false, showDate: false, showClass: false, title: "Custom title" };
    const { container } = render(
      <Sheet
        worksheet={sheet}
        theme={getTheme("beacon")}
        pages={[{ index: 0, items: [] }]}
        mode="print"
        empty={<p>Nothing here yet</p>}
      />,
    );
    const root = container.querySelector(".ws-sheet") as HTMLElement;
    expect(root.style.getPropertyValue("--ws-print-w")).toBe("8.5in");
    expect(container.querySelector(".ws-header-fields")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Custom title" })).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });
});
