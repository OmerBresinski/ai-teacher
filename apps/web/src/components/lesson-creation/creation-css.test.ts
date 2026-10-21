import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The phone's generation companion leaves without a layout shift (UX audit, CLS at 390 was 0.168
 * when the slot collapsed to height 0). Measured on the computed styles of the real stylesheet at
 * a phone's width: the slot keeps its height through the exit and fades, and the slide list rises
 * over it by a transform (not counted as a shift), growing at its foot by the same amount.
 */
type HappyWindow = Window & {
  happyDOM?: { setViewport: (v: { width: number; height: number }) => void };
};
const view = window as HappyWindow;
const style = document.createElement("style");
let width = 1024;
let height = 768;

beforeAll(() => {
  width = window.innerWidth;
  height = window.innerHeight;
  style.textContent = readFileSync(resolve(__dirname, "creation.css"), "utf8");
  document.head.append(style);
  view.happyDOM?.setViewport({ width: 390, height: 844 });
});
afterAll(() => {
  style.remove();
  view.happyDOM?.setViewport({ width, height });
  document.body.innerHTML = "";
});

function page() {
  document.body.innerHTML = `<div class="creation-editor-preview" data-story-finished="false"><aside data-editor-companion="mobile"><div class="creation-generation-anchor"></div></aside><div data-list><section data-mobile-lesson-list></section></div></div>`;
  const root = document.querySelector(".creation-editor-preview") as HTMLElement;
  const slot = document.querySelector("aside") as HTMLElement;
  const list = document.querySelector("[data-list]") as HTMLElement;
  return { root, slot, list };
}

describe("phone companion exit", () => {
  test("the slot holds its height through the exit and fades", () => {
    const { root, slot } = page();
    expect(window.innerWidth).toBe(390);
    const before = getComputedStyle(slot).height;
    expect(before).toBe("152px");
    root.dataset.storyFinished = "true";
    expect(getComputedStyle(slot).height).toBe(before);
    expect(getComputedStyle(slot).opacity).toBe("0");
    expect(getComputedStyle(slot).visibility).toBe("hidden");
  });

  test("the list rises by the slot's height as a transform and grows at its foot to match", () => {
    const { root, list } = page();
    expect(getComputedStyle(list).transform).toMatch(/^(none|)$/);
    root.dataset.storyFinished = "true";
    expect(getComputedStyle(list).transform).toBe("translateY(calc(-1 * 152px))");
    expect(getComputedStyle(list).marginBottom).toBe("calc(-1 * 152px)");
  });

  test("only the editor's slide list moves: another sibling (the viewer's swipe area) does not", () => {
    document.body.innerHTML = `<div class="creation-editor-preview" data-story-finished="true"><aside data-editor-companion="mobile"></aside><div data-swipe></div></div>`;
    const swipe = document.querySelector("[data-swipe]") as HTMLElement;
    expect(getComputedStyle(swipe).transform).toMatch(/^(none|)$/);
    expect(getComputedStyle(swipe).marginBottom).toMatch(/^(0px|)$/);
  });
});
