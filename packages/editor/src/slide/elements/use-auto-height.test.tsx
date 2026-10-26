/**
 * TEACH-247 part ai: the Great Fire Y2 title (Crayon Box, Playpen Sans at 56 on a 1.04 line height,
 * a fixed 121-point box) showed the overflow warning with nothing cut off. Chromium gives the body
 * a `scrollHeight` of 129 (each glyph's content area pokes past the tight line height) while its two
 * lines lay out 116 tall. A fixed box is now judged on its laid-out height.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { EditorHooks } from "../editor-hooks";
import { EditorHooksContext, useAutoHeight } from "./use-auto-height";

afterEach(cleanup);

const frame = () => new Promise((r) => setTimeout(r, 30));

function Probe({
  h,
  autoHeight,
  laid,
  scroll,
}: {
  h: number;
  autoHeight: boolean;
  laid: number;
  scroll: number;
}) {
  const { ref, overflowing } = useAutoHeight({
    slideId: "s1",
    id: "t",
    h,
    mode: "edit",
    autoHeight,
    chrome: 0,
  });
  return (
    <div
      ref={(n) => {
        if (n) {
          Object.defineProperty(n, "offsetHeight", { configurable: true, get: () => laid });
          Object.defineProperty(n, "scrollHeight", { configurable: true, get: () => scroll });
        }
        ref.current = n;
      }}
      data-overflowing={overflowing ? "yes" : "no"}
    />
  );
}

const mount = async (props: Parameters<typeof Probe>[0], writes: number[] = []) => {
  const hooks = {
    writeElementHeight: (_s: string, _i: string, h: number) => writes.push(h),
  } as unknown as EditorHooks;
  const r = render(
    <EditorHooksContext.Provider value={hooks}>
      <Probe {...props} />
    </EditorHooksContext.Provider>,
  );
  await act(frame);
  return r.container.querySelector("[data-overflowing]")?.getAttribute("data-overflowing");
};

describe("a fixed text box's overflow mark (TEACH-247 part ai)", () => {
  test("glyphs past a tight line height are not an overflow", async () => {
    expect(await mount({ h: 121, autoHeight: false, laid: 116, scroll: 129 })).toBe("no");
  });
  test("a third line that does not fit still is", async () => {
    expect(await mount({ h: 121, autoHeight: false, laid: 175, scroll: 188 })).toBe("yes");
  });
  test("an auto-height box still grows to its scroll height, as the ruler measures it", async () => {
    const writes: number[] = [];
    await mount({ h: 100, autoHeight: true, laid: 116, scroll: 129 }, writes);
    expect(writes).toEqual([129]);
  });
});
