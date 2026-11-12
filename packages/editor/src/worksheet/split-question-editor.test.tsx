import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Worksheet } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { starterWorksheet } from "../model/worksheet-factories";
import { KEY, pointer, renderWorksheetEditor } from "./editor-test-harness";
import { pageMetrics, pxToPt } from "./metrics";
import { HEADER_KEY } from "./paginate";

/*
 * R4 review (12 Nov), web finding 1: a lines question that straddles a page break was split by
 * `paginate` into `q#head` and `q#tail`, and the editor drew both as full blocks: the number and
 * the editable stem twice with one block id, and a key change `q` -> `q#head` the moment the
 * split appeared, which remounted the text box and lost the caret. happy-dom has no layout, so the
 * measure column's boxes are given heights here, and the question "grows" as if typed into.
 */

const contentH = pageMetrics("A4").contentH;
const PX = 1 / pxToPt(1);
const heights: Record<string, number> = {};
const original = HTMLElement.prototype.getBoundingClientRect;
function measured(this: HTMLElement): DOMRect {
  const key = this.dataset?.measureKey;
  const pt = key ? (heights[key] ?? 20) : 0;
  return {
    top: 0,
    bottom: pt * PX,
    height: pt * PX,
    left: 0,
    right: 500,
    width: 500,
    x: 0,
    y: 0,
    toJSON() {},
  } as DOMRect;
}

const sheet = (): Worksheet => {
  const base = starterWorksheet("Split");
  return {
    ...base,
    blocks: [
      { id: "p", type: "paragraph", doc: docFromText("Read the passage.") },
      {
        id: "q",
        type: "question",
        doc: docFromText("Describe the river."),
        answerLines: 20,
        number: 1,
      },
    ],
  };
};

const pageView = (c: HTMLElement) => c.querySelector<HTMLElement>(".ws-edit") ?? c;

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = original;
  cleanup();
});

describe("a lines question split over a page break, in the editor", () => {
  test("draws the question once, its tail as lines only, and keeps its row across the split", async () => {
    heights[HEADER_KEY] = 40;
    heights.p = 0.3 * contentH;
    heights.q = 120; // fits page 1 whole
    HTMLElement.prototype.getBoundingClientRect = measured;
    const { container, client } = renderWorksheetEditor(sheet());
    const view = () => pageView(container);
    await waitFor(() => expect(view().querySelectorAll('[data-block-id="q"]')).toHaveLength(1));
    expect(view().querySelector("[data-split-tail]")).toBeNull();

    // The teacher clicks into the question to type.
    const before = view().querySelector<HTMLElement>('[data-block-id="q"]') as HTMLElement;
    fireEvent.pointerDown(before, pointer(10, 10));

    // Typing grows the question past the page's foot: the next measure splits it.
    heights.q = 0.9 * contentH;
    await act(async () => {
      const w = client.getQueryData<Worksheet>(KEY) as Worksheet;
      client.setQueryData(KEY, {
        ...w,
        blocks: w.blocks.map((b) => (b.id === "p" ? { ...b, doc: docFromText("Read it.") } : b)),
      });
    });
    await waitFor(() => expect(view().querySelector('[data-split-tail="q"]')).not.toBeNull());

    // Drawn once: one row with the block id, one number; the tail carries neither.
    const rows = view().querySelectorAll('[data-block-id="q"]');
    expect(rows).toHaveLength(1);
    const tail = view().querySelector('[data-split-tail="q"]') as HTMLElement;
    expect(tail.querySelector("[data-block-id]")).toBeNull();
    expect(tail.querySelector(".ws-q-continued")).not.toBeNull();
    expect(tail.textContent).not.toContain("Describe the river.");
    // The same row: not remounted, so its text box (and the caret in it) survives.
    expect(rows[0]).toBe(before);
    expect(before.isConnected).toBe(true);
  });
});
