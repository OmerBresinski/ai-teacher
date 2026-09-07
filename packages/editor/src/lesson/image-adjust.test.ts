import { describe, expect, test } from "bun:test";
import {
  clampBoxToPicture,
  clampCrop,
  coverSize,
  cropFor,
  cropFromRects,
  displayedAspect,
  flip,
  focalAt,
  normaliseTransform,
  nudgeCrop,
  pan,
  pictureRect,
  pictureStyle,
  rederiveCrop,
  rotateQuarter,
  seedCrop,
  sourceFocal,
  straightenCover,
  zoomAbout,
  zoomOf,
} from "./image-adjust";

const box = { w: 400, h: 300 };
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("cover and zoom", () => {
  test("a wide picture in a squarer box covers by height", () => {
    // 2:1 picture, 4:3 box: height rules.
    expect(coverSize(box, 2)).toEqual({ w: 600, h: 300 });
    expect(coverSize(box, 4 / 3)).toEqual({ w: 400, h: 300 });
  });

  test("zoom 1 round the centre is the cover window, and zoomOf reads it back", () => {
    const c = cropFor(box, 2, 1);
    close(c.x, 1 / 6);
    close(c.y, 0);
    close(c.w, 2 / 3);
    close(c.h, 1);
    close(zoomOf(c, box, 2), 1);
    const z2 = cropFor(box, 2, 2, { x: 0.25, y: 0.5 });
    close(z2.w, 1 / 3);
    close(z2.h, 0.5);
    close(z2.x, 0.25 - 1 / 6);
    close(zoomOf(z2, box, 2), 2);
  });

  test("zoom is clamped to 1..4 and the window stays inside the picture", () => {
    expect(cropFor(box, 1, 0.2)).toEqual(cropFor(box, 1, 1));
    close(zoomOf(cropFor(box, 1, 9), box, 1), 4);
    const edge = cropFor(box, 2, 3, { x: 1, y: 1 });
    close(edge.x + edge.w, 1);
    close(edge.y + edge.h, 1);
  });

  test("zooming about a point keeps that picture point under it", () => {
    const start = cropFor(box, 4 / 3, 1);
    const at = { x: 0.8, y: 0.3 };
    const out = zoomAbout(start, 2.5, at, box, 4 / 3);
    close(start.x + at.x * start.w, out.x + at.x * out.w);
    close(start.y + at.y * start.h, out.y + at.y * out.h);
    close(zoomOf(out, box, 4 / 3), 2.5);
  });

  test("zooming about a corner from the edge clamps rather than showing empty picture", () => {
    const start = cropFor(box, 4 / 3, 2, { x: 0, y: 0 });
    const out = zoomAbout(start, 1, { x: 0, y: 0 }, box, 4 / 3);
    expect(out).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("pan, nudge and clamps", () => {
  test("dragging the picture right moves the window left, in element units", () => {
    const c = cropFor(box, 1, 2); // 400x300 window in an 800x800 picture: w 0.5, h 0.375
    const out = pan(c, 80, 0, box);
    close(out.x, c.x - 0.1);
    expect(pan(c, 10_000, 10_000, box)).toEqual({ ...c, x: 0, y: 0 });
  });

  test("nudge moves by picture fractions and stops at the edge", () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    const moved = nudgeCrop(c, 0.01, -0.01);
    close(moved.x, 0.21);
    close(moved.y, 0.19);
    expect(nudgeCrop(c, 1, 1)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  test("clampCrop never lets the window leave or exceed the picture", () => {
    expect(clampCrop({ x: -1, y: 2, w: 3, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe("slide-space rects", () => {
  test("pictureRect and cropFromRects invert each other", () => {
    const b = { x: 100, y: 50, w: 400, h: 300 };
    const c = { x: 0.25, y: 0.1, w: 0.5, h: 0.6 };
    const p = pictureRect(b, c);
    expect(p).toEqual({ x: -100, y: 0, w: 800, h: 500 });
    const back = cropFromRects(p, b);
    close(back.x, c.x);
    close(back.y, c.y);
    close(back.w, c.w);
    close(back.h, c.h);
  });

  test("a trimmed box stays inside the picture and above the minimum size", () => {
    const p = { x: 0, y: 0, w: 800, h: 500 };
    expect(clampBoxToPicture({ x: -50, y: 10, w: 100, h: 100 }, p, 16)).toEqual({
      x: 0,
      y: 10,
      w: 100,
      h: 100,
    });
    expect(clampBoxToPicture({ x: 790, y: 490, w: 4, h: 4 }, p, 16)).toEqual({
      x: 784,
      y: 484,
      w: 16,
      h: 16,
    });
  });

  test("focalAt reads a slide point as a picture fraction", () => {
    expect(focalAt({ x: 0, y: 0, w: 800, h: 500 }, { x: 200, y: 250 })).toEqual({
      x: 0.25,
      y: 0.5,
    });
    expect(focalAt({ x: 0, y: 0, w: 800, h: 500 }, { x: -9, y: 900 })).toEqual({ x: 0, y: 1 });
  });
});

describe("focal point survives a change of shape", () => {
  test("re-deriving for a tall box keeps the subject in the window", () => {
    const wide = { w: 640, h: 300 };
    const tall = { w: 240, h: 480 };
    const aspect = 1.6; // a 640x400 picture
    const focal = { x: 0.8, y: 0.3 }; // the subject, right of centre
    const c = cropFor(wide, aspect, 1.5, focal);
    const t = rederiveCrop(c, focal, wide, tall, aspect);
    expect(t.x).toBeLessThanOrEqual(focal.x);
    expect(t.x + t.w).toBeGreaterThanOrEqual(focal.x);
    expect(t.y).toBeLessThanOrEqual(focal.y);
    expect(t.y + t.h).toBeGreaterThanOrEqual(focal.y);
    close(zoomOf(t, tall, aspect), 1.5);
  });

  test("seedCrop covers an untouched picture and keeps a stored crop", () => {
    const el = { w: 400, h: 300, focal: { x: 0.9, y: 0.5 } };
    const seeded = seedCrop(el, { w: 640, h: 400 });
    close(seeded.h, 1);
    close(seeded.x + seeded.w, 1); // pulled to the right edge to hold the subject
    const kept = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(seedCrop({ ...el, crop: kept }, { w: 640, h: 400 })).toEqual(kept);
  });
});

describe("transform composition", () => {
  test("quarter turns wrap and swap the displayed aspect; flips toggle", () => {
    expect(rotateQuarter(undefined).rotate).toBe(90);
    expect(rotateQuarter({ rotate: 270 }).rotate).toBe(0);
    expect(rotateQuarter({ rotate: 0 }, -90).rotate).toBe(270);
    close(displayedAspect({ w: 640, h: 400 }, { rotate: 90 }), 400 / 640);
    close(displayedAspect({ w: 640, h: 400 }, { rotate: 180 }), 1.6);
    expect(flip(flip(undefined, "h"), "h").flipH).toBe(false);
    expect(flip({ flipH: true }, "v")).toEqual({ flipH: true, flipV: true });
  });

  test("normaliseTransform drops defaults and clamps straighten", () => {
    expect(normaliseTransform({ rotate: 0, flipH: false, straighten: 0 })).toBeUndefined();
    expect(normaliseTransform({ straighten: 80, flipV: true })).toEqual({
      straighten: 45,
      flipV: true,
    });
  });

  test("the straighten cover factor is 1 at rest and grows with the tilt and the aspect", () => {
    close(straightenCover(0, 1.6), 1);
    close(straightenCover(45, 1), Math.SQRT2);
    expect(straightenCover(8, 1.6)).toBeGreaterThan(straightenCover(8, 1));
    // A 4:3 box tilted 10 degrees: cos + (4/3) sin.
    close(straightenCover(10, 4 / 3), Math.cos(Math.PI / 18) + (4 / 3) * Math.sin(Math.PI / 18));
  });

  test("sourceFocal undoes flips and quarter turns so object-position finds the subject", () => {
    expect(sourceFocal({ x: 0.2, y: 0.3 }, undefined)).toEqual({ x: 0.2, y: 0.3 });
    expect(sourceFocal({ x: 0.2, y: 0.3 }, { flipH: true })).toEqual({ x: 0.8, y: 0.3 });
    // Turned 90 clockwise, the bitmap's top-left corner is shown at the top-right.
    expect(sourceFocal({ x: 1, y: 0 }, { rotate: 90 })).toEqual({ x: 0, y: 0 });
    expect(sourceFocal({ x: 0, y: 1 }, { rotate: 270 })).toEqual({ x: 0, y: 0 });
    expect(sourceFocal({ x: 0.25, y: 0.75 }, { rotate: 180 })).toEqual({ x: 0.75, y: 0.25 });
  });
});

describe("pictureStyle", () => {
  test("no crop, no transform: the bitmap fills the box, positioned on the centre", () => {
    const s = pictureStyle(box, undefined, undefined, undefined);
    expect(s.wrapper).toEqual({ left: "0%", top: "0%", width: "100%", height: "100%" });
    expect(s.img.width).toBe("100%");
    expect(s.img.transform).toBe("translate(-50%, -50%)");
    expect(s.img.objectPosition).toBe("50% 50%");
  });

  test("a crop over-sizes the wrapper the way the old renderer did", () => {
    const s = pictureStyle(box, { x: 0.25, y: 0.1, w: 0.5, h: 0.5 }, undefined, undefined);
    expect(s.wrapper).toEqual({ left: "-50%", top: "-20%", width: "200%", height: "200%" });
  });

  test("a quarter turn swaps the bitmap's sides inside the wrapper", () => {
    const s = pictureStyle(box, undefined, { rotate: 90 }, undefined);
    expect(s.img.width).toBe("75%");
    expect(s.img.height).toBe("133.3333%");
    expect(s.img.transform).toContain("rotate(90deg)");
  });

  test("straighten tilts outermost with a cover scale; flips are negative scales", () => {
    const s = pictureStyle(box, undefined, { straighten: 10, flipH: true }, undefined);
    const cover = straightenCover(10, 4 / 3);
    expect(s.img.transform).toBe(
      `translate(-50%, -50%) rotate(10deg) scale(${-Math.round(cover * 10000) / 10000}, ${Math.round(cover * 10000) / 10000})`,
    );
  });
});
