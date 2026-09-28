import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, render } from "@testing-library/react";
import { useContentHeight } from "./use-content-height";

type Size = { inlineSize: number; blockSize: number };
let report: (size: Size) => void = () => {};
const RealResizeObserver = globalThis.ResizeObserver;

/** A ResizeObserver the test drives by hand: `report` delivers one entry to the observer. */
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    report = (size) =>
      callback([{ borderBoxSize: [size] } as unknown as ResizeObserverEntry], this as never);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function Probe({ seen }: { seen: (value: ReturnType<typeof useContentHeight>[1]) => void }) {
  const [ref, size] = useContentHeight<HTMLDivElement>();
  seen(size);
  return <div ref={ref} />;
}

describe("useContentHeight", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = RealResizeObserver;
  });

  it("follows the content's height and marks a width change as a reflow", () => {
    // A holder, not a `let`: TypeScript does not see the render callback assign a local.
    const probe: { size: ReturnType<typeof useContentHeight>[1] } = { size: null };
    render(
      <Probe
        seen={(value) => {
          probe.size = value;
        }}
      />,
    );
    expect(probe.size).toBeNull();

    act(() => report({ inlineSize: 400, blockSize: 240 }));
    expect(probe.size).toEqual({ height: 240, reflowed: false });
    // New content at the same width: ease to it.
    act(() => report({ inlineSize: 400, blockSize: 256 }));
    expect(probe.size).toEqual({ height: 256, reflowed: false });
    // The window narrowed and the text rewrapped: follow at once.
    act(() => report({ inlineSize: 320, blockSize: 290 }));
    expect(probe.size).toEqual({ height: 290, reflowed: true });
    act(() => report({ inlineSize: 320, blockSize: 270 }));
    expect(probe.size).toEqual({ height: 270, reflowed: false });
  });
});
