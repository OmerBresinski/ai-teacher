import { describe, expect, test } from "bun:test";
import { SLIDE_H, SLIDE_W, type SlideElement } from "@tj/domain/documents";
import type { Rect } from "../../model/geometry";
import {
  HANDLE_HIT,
  HANDLE_HIT_COARSE,
  HANDLE_SIZE,
  handleHitSize,
  isTextEditable,
  OVERHANG,
  resizeCursor,
} from "./constants";
import {
  boxesOf,
  clampToStage,
  cornersOf,
  type ElementBox,
  hitsBox,
  hitTest,
  marqueeHits,
} from "./hit-test";

/* From TeachDeck's `transform-hit-test.test.ts` catalogue (17 cases). */

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const shape = (id: string, r: Rect, rotation = 0, locked = false): SlideElement =>
  ({ id, type: "shape", shape: "rect", ...r, rotation, locked }) as SlideElement;
const box = (id: string, r: Rect, rotation = 0, locked = false): ElementBox => ({
  id,
  rect: r,
  rotation,
  locked,
  el: shape(id, r, rotation, locked),
});

describe("boxesOf", () => {
  test("keeps draw order and defaults rotation and lock", () => {
    const els = [shape("a", rect(0, 0, 10, 10)), { ...shape("b", rect(5, 5, 10, 10)) }];
    delete (els[1] as { rotation?: number }).rotation;
    delete (els[1] as { locked?: boolean }).locked;
    const boxes = boxesOf(els);
    expect(boxes.map((b) => b.id)).toEqual(["a", "b"]);
    expect(boxes[1]).toMatchObject({ rotation: 0, locked: false, rect: rect(5, 5, 10, 10) });
  });
});

describe("hitsBox / hitTest", () => {
  test("hits inside and misses outside an unrotated box; slop widens the target", () => {
    const b = box("a", rect(100, 100, 200, 100));
    expect(hitsBox(b, { x: 150, y: 150 })).toBe(true);
    expect(hitsBox(b, { x: 99, y: 150 })).toBe(false);
    expect(hitsBox(b, { x: 96, y: 150 }, 6)).toBe(true);
  });

  test("un-rotates the point into the element frame", () => {
    const b = box("a", rect(100, 180, 200, 40), 90);
    expect(hitsBox(b, { x: 190, y: 120 })).toBe(true);
    expect(hitsBox(b, { x: 120, y: 195 })).toBe(false);
  });

  test("returns the topmost element under the point", () => {
    const boxes = [box("under", rect(0, 0, 100, 100)), box("over", rect(50, 50, 100, 100))];
    expect(hitTest(boxes, { x: 75, y: 75 })?.id).toBe("over");
    expect(hitTest(boxes, { x: 10, y: 10 })?.id).toBe("under");
    expect(hitTest(boxes, { x: 500, y: 500 })).toBeNull();
  });

  test("still hits a locked element — locked means immovable, not invisible", () => {
    expect(hitTest([box("a", rect(0, 0, 50, 50), 0, true)], { x: 10, y: 10 })?.id).toBe("a");
  });
});

describe("marqueeHits", () => {
  test("takes fully-enclosed elements only", () => {
    const boxes = [box("in", rect(20, 20, 40, 40)), box("partial", rect(90, 20, 40, 40))];
    expect(marqueeHits(boxes, rect(0, 0, 100, 100))).toEqual(["in"]);
  });

  test("measures a rotated element by its rotated bounds", () => {
    const b = box("a", rect(0, 20, 100, 20), 90);
    expect(cornersOf(b.rect, b.rotation)).toHaveLength(4);
    expect(marqueeHits([b], rect(0, 0, 100, 100))).toEqual([]);
    expect(marqueeHits([b], rect(-50, -50, 200, 200))).toEqual(["a"]);
  });
});

describe("clampToStage", () => {
  test("allows exactly OVERHANG points off each edge", () => {
    expect(clampToStage(rect(-500, 0, 100, 50)).x).toBe(-OVERHANG);
    expect(clampToStage(rect(0, -500, 100, 50)).y).toBe(-OVERHANG);
    expect(clampToStage(rect(5000, 0, 100, 50)).x).toBe(SLIDE_W - 100 + OVERHANG);
    expect(clampToStage(rect(0, 5000, 100, 50)).y).toBe(SLIDE_H - 50 + OVERHANG);
  });

  test("leaves an element that is already on the stage alone", () => {
    expect(clampToStage(rect(100, 100, 200, 100))).toEqual({ x: 100, y: 100 });
  });

  test("does not thrash on an element bigger than the stage", () => {
    const p = clampToStage(rect(0, 0, SLIDE_W * 2, SLIDE_H * 2));
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe("handleHitSize", () => {
  test("is the flat 20px (28 coarse) on an element with room for it", () => {
    expect(handleHitSize(rect(0, 0, 200, 100), 1)).toBe(HANDLE_HIT);
    expect(handleHitSize(rect(0, 0, 200, 100), 1, true)).toBe(HANDLE_HIT_COARSE);
  });

  test("shrinks — never below the drawn handle — on a tiny element", () => {
    expect(handleHitSize(rect(0, 0, 16, 16), 0.25)).toBe(HANDLE_SIZE);
    expect(handleHitSize(rect(0, 0, 40, 40), 1)).toBeCloseTo(40 / 3, 6);
  });

  test("reads the shortest side, so a thin bar shrinks too", () => {
    expect(handleHitSize(rect(0, 0, 900, 20), 1)).toBe(HANDLE_SIZE);
    expect(handleHitSize(rect(0, 0, 900, 45), 1)).toBeCloseTo(15, 6);
  });
});

describe("isTextEditable", () => {
  test("opens the editor for text-bearing elements", () => {
    for (const type of ["text", "gap-text", "option"]) {
      expect(isTextEditable({ type } as SlideElement)).toBe(true);
    }
  });

  test("edits any shape big enough to hold a label, but never a hairline rule", () => {
    const shapeOf = (w: number, h: number) =>
      ({ type: "shape", shape: "rect", w, h }) as SlideElement;
    expect(isTextEditable(shapeOf(200, 80))).toBe(true);
    expect(isTextEditable(shapeOf(844, 1))).toBe(false);
    expect(isTextEditable(shapeOf(3, 300))).toBe(false);
  });

  test("leaves everything else alone", () => {
    expect(isTextEditable({ type: "image" } as SlideElement)).toBe(false);
    expect(isTextEditable({ type: "group" } as SlideElement)).toBe(false);
  });
});

describe("resizeCursor", () => {
  test("follows the element round as it rotates", () => {
    expect(resizeCursor("n", 0)).toBe("ns-resize");
    expect(resizeCursor("n", 90)).toBe("ew-resize");
    expect(resizeCursor("se", 0)).toBe("nwse-resize");
    expect(resizeCursor("se", 90)).toBe("nesw-resize");
  });
});
