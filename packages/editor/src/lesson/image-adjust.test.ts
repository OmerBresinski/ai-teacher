import { describe, expect, test } from "bun:test";
import {
  clampBoxToPicture,
  clampCrop,
  coverSize,
  cropFor,
  cropFromRects,
  cropIsStale,
  currentCrop,
  displayedAspect,
  draftFlip,
  flip,
  focalAt,
  normaliseTransform,
  nudgeCrop,
  pan,
  pictureRect,
  pictureStyle,
  rederiveCrop,
  renderedFit,
  rotateQuarter,
  seedCrop,
  sourceFocal,
  straightenCover,
  windowZoom,
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
    close(windowZoom(c), 1.5); // the zoom is legible from the window alone
    expect(cropIsStale(c, wide, aspect)).toBe(false);
    expect(cropIsStale(c, tall, aspect)).toBe(true);
    const t = rederiveCrop(c, focal, tall, aspect);
    expect(t.x).toBeLessThanOrEqual(focal.x);
    expect(t.x + t.w).toBeGreaterThanOrEqual(focal.x);
    expect(t.y).toBeLessThanOrEqual(focal.y);
    expect(t.y + t.h).toBeGreaterThanOrEqual(focal.y);
    close(zoomOf(t, tall, aspect), 1.5);
    expect(cropIsStale(t, tall, aspect)).toBe(false);
  });

  test("windowZoom reads a trimmed window too, and clamps to the zoom range", () => {
    // A 400x300 picture trimmed to a 100x100 frame: the picture is 3x the frame's cover.
    const trimmed = cropFromRects({ x: 0, y: 0, w: 400, h: 300 }, { x: 50, y: 40, w: 100, h: 100 });
    close(windowZoom(trimmed), zoomOf(trimmed, { w: 100, h: 100 }, 4 / 3));
    close(windowZoom({ x: 0, y: 0, w: 1, h: 1 }), 1);
    close(windowZoom({ x: 0, y: 0, w: 0.1, h: 0.1 }), 4);
  });

  test("seedCrop covers an untouched picture and keeps a stored crop", () => {
    const el = { w: 400, h: 300, focal: { x: 0.9, y: 0.5 } };
    const seeded = seedCrop(el, { w: 640, h: 400 });
    close(seeded.h, 1);
    close(seeded.x + seeded.w, 1); // pulled to the right edge to hold the subject
    // A stored crop that still fits the box (400x300 over 0.5x0.6 is the picture's 1.6) is kept.
    const kept = { x: 0.1, y: 0.1, w: 0.5, h: 0.6 };
    expect(seedCrop({ ...el, crop: kept }, { w: 640, h: 400 })).toEqual(kept);
  });

  test("a crop stored under another box shape is re-derived at the same zoom round the focal point", () => {
    // Made at zoom 2 for a 400x300 box, then the box was resized to 300x400 outside crop mode.
    const natural = { w: 800, h: 600 };
    const focal = { x: 0.8, y: 0.5 };
    const stored = cropFor({ w: 400, h: 300 }, 4 / 3, 2, focal);
    const el = { w: 300, h: 400, crop: stored, focal };
    const seeded = seedCrop(el, natural);
    expect(seeded).not.toEqual(stored);
    expect(seeded).toEqual(currentCrop(el, natural));
    expect(seeded).toEqual(rederiveCrop(stored, focal, { w: 300, h: 400 }, 4 / 3));
    close(zoomOf(seeded, { w: 300, h: 400 }, 4 / 3), 2);
    expect(cropIsStale(seeded, { w: 300, h: 400 }, 4 / 3)).toBe(false);
    // The same crop under its own box is kept as it is.
    expect(seedCrop({ ...el, w: 400, h: 300 }, natural)).toEqual(stored);
  });

  test("renderedFit: any adjustment renders as cover; Fit only when there is none", () => {
    expect(renderedFit({ fit: "contain" })).toBe("contain");
    expect(renderedFit({ fit: "cover" })).toBe("cover");
    expect(renderedFit({ fit: "contain", crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe("cover");
    expect(renderedFit({ fit: "contain", focal: { x: 0.2, y: 0.2 } })).toBe("cover");
    expect(renderedFit({ fit: "contain", imageTransform: { flipH: true } })).toBe("cover");
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

  test("a flip reverses the straighten tilt, on either axis; twice is the identity", () => {
    expect(flip({ straighten: 8 }, "h")).toEqual({ straighten: -8, flipH: true });
    expect(flip({ straighten: 8 }, "v")).toEqual({ straighten: -8, flipV: true });
    expect(flip(flip({ straighten: 8, rotate: 90 }, "h"), "h")).toEqual({
      straighten: 8,
      rotate: 90,
      flipH: false,
    });
    expect(flip({ rotate: 180 }, "h").straighten).toBeUndefined();
    // A quarter turn after a flip keeps the reversed tilt and still wraps.
    expect(rotateQuarter(flip({ straighten: 8, rotate: 270 }, "h"))).toEqual({
      straighten: -8,
      rotate: 0,
      flipH: true,
    });
  });

  test("draftFlip mirrors the window and focal point with the tilt; twice is the identity", () => {
    const near = (got: object | undefined, want: Record<string, number>) => {
      for (const [k, v] of Object.entries(want))
        close((got as Record<string, number>)[k] ?? NaN, v);
    };
    const d = {
      imageTransform: { straighten: 8 },
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
      focal: { x: 0.3, y: 0.7 },
    };
    const h = draftFlip(d, box, "h");
    expect(h.imageTransform).toEqual({ straighten: -8, flipH: true });
    near(h.crop, { x: 0.4, y: 0.2, w: 0.5, h: 0.6 });
    near(h.focal, { x: 0.7, y: 0.7 });
    const v = draftFlip(d, box, "v");
    expect(v.imageTransform).toEqual({ straighten: -8, flipV: true });
    near(v.crop, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
    near(v.focal, { x: 0.3, y: 0.3 });
    const back = draftFlip({ ...d, ...h }, box, "h");
    expect(back.imageTransform).toEqual({ straighten: 8, flipH: false });
    near(back.crop, d.crop);
    near(back.focal, d.focal);
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

  test("a stale crop is rendered re-derived once the bitmap is measured, never stretched", () => {
    // Zoom 2 on a 4:3 picture in a 400x300 box, then the box became 300x400 without crop mode.
    const natural = { w: 800, h: 600 };
    const stored = cropFor({ w: 400, h: 300 }, 4 / 3, 2, { x: 0.5, y: 0.5 });
    const tall = { w: 300, h: 400 };
    // Before the fix (and still, until the bitmap is measured) the wrapper is box / crop: 3:4 for
    // a 4:3 picture, so the style alone asks for a stretched bitmap and only `object-fit: cover`
    // keeps it unstretched, at a window that is not the stored one.
    const unmeasured = pictureStyle(tall, stored, undefined, undefined);
    expect(unmeasured.wrapper).toEqual({
      left: "-50%",
      top: "-50%",
      width: "200%",
      height: "200%",
    });
    const wrapperAspect =
      (parseFloat(unmeasured.wrapper.width) * tall.w) /
      (parseFloat(unmeasured.wrapper.height) * tall.h);
    expect(Math.abs(wrapperAspect - 4 / 3)).toBeGreaterThan(1e-3);

    const s = pictureStyle(tall, stored, undefined, undefined, natural);
    const expected = rederiveCrop(stored, undefined, tall, 4 / 3);
    const pctOf = (f: number) => `${Math.round(f * 100 * 10000) / 10000}%`;
    expect(s.wrapper.width).toBe(pctOf(1 / expected.w));
    expect(s.wrapper.height).toBe(pctOf(1 / expected.h));
    const measuredAspect = ((1 / expected.w) * tall.w) / ((1 / expected.h) * tall.h);
    close(measuredAspect, 4 / 3);
    // A crop that still fits its box renders exactly as it did without the measurement.
    const fresh = pictureStyle({ w: 400, h: 300 }, stored, undefined, undefined, natural);
    expect(fresh).toEqual(pictureStyle({ w: 400, h: 300 }, stored, undefined, undefined));
  });

  test("a quarter turn swaps the bitmap's sides inside the wrapper", () => {
    const s = pictureStyle(box, undefined, { rotate: 90 }, undefined);
    expect(s.img.width).toBe("75%");
    expect(s.img.height).toBe("133.3333%");
    expect(s.img.transform).toContain("rotate(90deg)");
  });

  test("the flipped state of a tilted picture renders as its mirror image: the tilt reversed", () => {
    const flipped = flip({ straighten: 8 }, "h");
    const s = pictureStyle(box, undefined, flipped, undefined);
    const cover = Math.round(straightenCover(8, 4 / 3) * 10000) / 10000;
    expect(s.img.transform).toBe(`translate(-50%, -50%) rotate(-8deg) scale(${-cover}, ${cover})`);
    expect(
      pictureStyle(box, undefined, flip({ straighten: 8 }, "v"), undefined).img.transform,
    ).toBe(`translate(-50%, -50%) rotate(-8deg) scale(${cover}, ${-cover})`);
  });

  test("straighten tilts outermost with a cover scale; flips are negative scales", () => {
    const s = pictureStyle(box, undefined, { straighten: 10, flipH: true }, undefined);
    const cover = straightenCover(10, 4 / 3);
    expect(s.img.transform).toBe(
      `translate(-50%, -50%) rotate(10deg) scale(${-Math.round(cover * 10000) / 10000}, ${Math.round(cover * 10000) / 10000})`,
    );
  });
});
