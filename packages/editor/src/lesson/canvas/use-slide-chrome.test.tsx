import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { type RefObject, useMemo, useRef } from "react";
import { EditorSessionProvider, useEditorSessionState } from "../use-editor-session";
import { useSlideChrome } from "./use-slide-chrome";

/** Records what is observed and lets the test fire a resize. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let barWidth = 100;
const rect = (width: number): DOMRect =>
  ({ x: 0, y: 0, left: 0, top: 0, width, height: 40, right: width, bottom: 40 }) as DOMRect;

function Chrome({
  stageRef,
  avoidRefs,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  avoidRefs: readonly RefObject<HTMLDivElement | null>[];
}) {
  const { avoid } = useSlideChrome({ stageRef, avoidRefs });
  return <output data-testid="avoid">{avoid.map((b) => b.width).join(",")}</output>;
}

/** A stage, a wrapper whose floating bar can be remounted (a new key), and the hook reading both. */
function Harness({ barKey }: { barKey: number | null }) {
  const session = useEditorSessionState();
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const avoidRefs = useMemo(() => [wrapper], []);
  return (
    <EditorSessionProvider session={session}>
      <div ref={stageRef} />
      <div ref={wrapper}>
        {barKey === null ? null : (
          <div
            key={barKey}
            data-testid="bar"
            ref={(el) => {
              if (el) el.getBoundingClientRect = () => rect(barWidth);
            }}
          />
        )}
      </div>
      <Chrome stageRef={stageRef} avoidRefs={avoidRefs} />
    </EditorSessionProvider>
  );
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

describe("useSlideChrome", () => {
  it("keeps watching the bar's size after the bar remounts, and re-places on the next resize", async () => {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    FakeResizeObserver.instances = [];
    barWidth = 100;
    const { rerender } = render(<Harness barKey={1} />);
    await settle();
    const [sizes] = FakeResizeObserver.instances;
    if (!sizes) throw new Error("no ResizeObserver was created");
    const first = screen.getByTestId("bar");
    expect(sizes.observed.has(first)).toBe(true);
    expect(screen.getByTestId("avoid")).toHaveTextContent("100");

    // A new key unmounts the bar and mounts another: the observer must follow the new element.
    rerender(<Harness barKey={2} />);
    await settle();
    const second = screen.getByTestId("bar");
    expect(second).not.toBe(first);
    expect(sizes.observed.has(second)).toBe(true);
    expect(sizes.observed.has(first)).toBe(false);

    // The new bar grows without anything else changing: the resize alone re-measures.
    barWidth = 300;
    act(() => sizes.fire());
    await settle();
    expect(screen.getByTestId("avoid")).toHaveTextContent("300");
  });
});
