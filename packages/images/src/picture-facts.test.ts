import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, type Raster } from "./panels";
import { detectSubjectBox, edgePlainness, pictureFacts } from "./picture-facts";

/*
 * TEACH-25 part b: the facts picture fit reads, found in code. Fixtures are the layout pilot's
 * pictures at 256 px. Expected boxes: the pilot's auto boxes (picture.js `edge`, 64 px sample),
 * which matched the hand boxes to about 2%.
 */
const load = (name: string): Raster =>
  decodePng(new Uint8Array(readFileSync(join(import.meta.dir, "fixtures/picture-fit", name))));
const near = (a: number | undefined, b: number, tol = 0.035) =>
  a !== undefined && Math.abs(a - b) <= tol;

describe("edge plainness", () => {
  test("a studio backdrop is plain on all four edges", () => {
    expect(edgePlainness(load("jar-master.png"))).toEqual({
      top: true,
      right: true,
      bottom: true,
      left: true,
    });
  });

  test("a scene that runs to every edge is plain on none", () => {
    expect(edgePlainness(load("scene.png"))).toEqual({
      top: false,
      right: false,
      bottom: false,
      left: false,
    });
  });

  test("a flat colour is plain; a hard stripe along an edge is not", () => {
    const flat: Raster = { width: 40, height: 30, rgb: new Uint8Array(40 * 30 * 3).fill(240) };
    expect(Object.values(edgePlainness(flat)).every(Boolean)).toBe(true);
    const striped = { ...flat, rgb: flat.rgb.slice() };
    for (let x = 0; x < 40; x += 2) striped.rgb.fill(20, x * 3, x * 3 + 3); // top row alternates
    expect(edgePlainness(striped).top).toBe(false);
  });
});

describe("subject box: plain-background difference only (no saliency)", () => {
  test("padded canopic jar master matches the pilot's box", () => {
    const s = detectSubjectBox(load("jar-master.png"));
    expect(s).not.toBeNull();
    expect(near(s?.x, 0.344) && near(s?.y, 0.156) && near(s?.w, 0.297) && near(s?.h, 0.672)).toBe(
      true,
    );
  });

  test("unpadded watering can and the vignetted bean plant", () => {
    const can = detectSubjectBox(load("can-control.png"));
    expect(near(can?.x, 0.016) && near(can?.y, 0.109) && near(can?.w, 0.969)).toBe(true);
    expect(near(can?.h, 0.781)).toBe(true);
    const bean = detectSubjectBox(load("bean-mature.png"));
    expect(near(bean?.x, 0.297) && near(bean?.y, 0.156) && near(bean?.w, 0.438)).toBe(true);
    expect(near(bean?.h, 0.719)).toBe(true);
  });

  test("a scene, or a picture plain on one edge only, has no box", () => {
    expect(detectSubjectBox(load("scene.png"))).toBeNull();
    expect(detectSubjectBox(load("hen.png"))).toBeNull();
  });

  test("an empty plain backdrop has no box", () => {
    const flat: Raster = { width: 40, height: 30, rgb: new Uint8Array(40 * 30 * 3).fill(240) };
    expect(detectSubjectBox(flat)).toBeNull();
  });
});

describe("pictureFacts", () => {
  test("an object on a plain backdrop: size, box, backdrop colour, kind", () => {
    const f = pictureFacts(load("jar-master.png"));
    expect(f.width).toBe(256);
    expect(f.height).toBe(256);
    expect(f.kind).toBe("object");
    expect(f.backdrop.colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(f.subject).toBeDefined();
  });

  test("a scene: no box, no kind claimed beyond what the edges show", () => {
    const f = pictureFacts(load("scene.png"));
    expect(f.subject).toBeUndefined();
    expect(f.kind).toBe("scene");
    expect(Object.values(f.backdrop.plain).some(Boolean)).toBe(false);
  });

  test("a picture plain on some edges only keeps those facts but has no box", () => {
    const f = pictureFacts(load("hen.png"));
    expect(f.backdrop.plain.top).toBe(true);
    expect(f.subject).toBeUndefined();
  });
});
