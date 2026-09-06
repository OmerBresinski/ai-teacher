import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRowDrag } from "./use-row-drag";

const ROW = 56;

function List({ onDrop }: { onDrop: (from: number, insertion: number) => void }) {
  const { drag, listRef, gripProps } = useRowDrag({ rowHeight: ROW, count: 3, onDrop });
  return (
    <>
      <output data-testid="state">
        {drag.from === null ? "idle" : `${drag.from}->${drag.insertion}`}
      </output>
      <ol ref={listRef}>
        {["a", "b", "c"].map((id, index) => (
          <li key={id}>
            <button type="button" aria-label={`Reorder ${id}`} {...gripProps(index)} />
          </li>
        ))}
      </ol>
    </>
  );
}

afterEach(cleanup);

function mockListTop(top: number): void {
  const list = document.querySelector("ol") as HTMLOListElement;
  list.getBoundingClientRect = () =>
    ({ top, bottom: top + ROW * 3, left: 0, right: 0, width: 0, height: ROW * 3 }) as DOMRect;
}

describe("useRowDrag", () => {
  it("ignores presses that travel less than the threshold", () => {
    const onDrop = mock();
    render(<List onDrop={onDrop} />);
    mockListTop(0);
    const grip = screen.getByRole("button", { name: "Reorder a" });
    fireEvent.pointerDown(grip, { button: 0, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 12, pointerId: 1 });
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
    fireEvent.pointerUp(grip, { clientY: 12, pointerId: 1 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("tracks the insertion gap from the pointer and commits on release", () => {
    const onDrop = mock();
    render(<List onDrop={onDrop} />);
    mockListTop(100);
    const grip = screen.getByRole("button", { name: "Reorder c" });
    fireEvent.pointerDown(grip, { button: 0, clientY: 240, pointerId: 1 });
    // 240 → 110: 10px into the list rounds to gap 0 (above the first row).
    fireEvent.pointerMove(grip, { clientY: 110, pointerId: 1 });
    expect(screen.getByTestId("state")).toHaveTextContent("2->0");
    fireEvent.pointerUp(grip, { clientY: 110, pointerId: 1 });
    expect(onDrop).toHaveBeenCalledWith(2, 0);
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("clamps the gap to the list and cancels on Escape or pointercancel", () => {
    const onDrop = mock();
    render(<List onDrop={onDrop} />);
    mockListTop(0);
    const grip = screen.getByRole("button", { name: "Reorder a" });
    fireEvent.pointerDown(grip, { button: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 900, pointerId: 1 });
    expect(screen.getByTestId("state")).toHaveTextContent("0->3");
    fireEvent.keyDown(grip, { key: "Escape" });
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
    fireEvent.pointerUp(grip, { clientY: 900, pointerId: 1 });
    expect(onDrop).not.toHaveBeenCalled();

    fireEvent.pointerDown(grip, { button: 0, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(grip, { clientY: 80, pointerId: 2 });
    fireEvent.pointerCancel(grip, { pointerId: 2 });
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("only the primary button starts a drag", () => {
    const onDrop = mock();
    render(<List onDrop={onDrop} />);
    mockListTop(0);
    const grip = screen.getByRole("button", { name: "Reorder a" });
    fireEvent.pointerDown(grip, { button: 2, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 80, pointerId: 1 });
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });
});
