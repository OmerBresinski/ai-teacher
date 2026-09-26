import { describe, expect, test } from "bun:test";
import { applySlideClip, type SlideClipTarget } from "./slide-clip";

/** A style that accepts every value (Chrome 90+, Safari 16+, Firefox 81+). */
const modern = () => {
  const writes: string[] = [];
  const style = { overflow: "", overflowX: "", overflowY: "" };
  const el: SlideClipTarget = {
    style: new Proxy(style, {
      set(t, k: "overflow" | "overflowX" | "overflowY", v: string) {
        writes.push(`${k}=${v}`);
        t[k] = v;
        if (k === "overflow") {
          t.overflowX = v;
          t.overflowY = v;
        }
        return true;
      },
    }),
  };
  return { el, style, writes };
};

/** A style that drops `clip`, as an engine that predates it does with an unknown value. */
const legacy = () => {
  const style = { overflow: "", overflowX: "", overflowY: "" };
  const el: SlideClipTarget = {
    style: new Proxy(style, {
      set(t, k: "overflow" | "overflowX" | "overflowY", v: string) {
        if (v === "clip") return true;
        t[k] = v;
        if (k === "overflow") {
          t.overflowX = v;
          t.overflowY = v;
        }
        return true;
      },
    }),
  };
  return { el, style };
};

describe("applySlideClip", () => {
  test("declares the hidden fallback first, then clip on both axes", () => {
    const { style, writes, el } = modern();
    applySlideClip(el, false);
    expect(writes).toEqual(["overflow=hidden", "overflowX=clip", "overflowY=clip"]);
    expect([style.overflowX, style.overflowY]).toEqual(["clip", "clip"]);
  });

  test("spill opens the bottom edge only", () => {
    const { style, el } = modern();
    applySlideClip(el, true);
    expect([style.overflowX, style.overflowY]).toEqual(["clip", "visible"]);
    applySlideClip(el, false);
    expect([style.overflowX, style.overflowY]).toEqual(["clip", "clip"]);
  });

  test("an engine without clip keeps hidden, never visible", () => {
    const { style, el } = legacy();
    applySlideClip(el, false);
    expect([style.overflowX, style.overflowY]).toEqual(["hidden", "hidden"]);
    applySlideClip(el, true);
    expect([style.overflowX, style.overflowY]).toEqual(["hidden", "visible"]);
  });
});
