import { describe, expect, test } from "bun:test";
import golden from "./fixtures/picture-fit-golden.json";
import {
  chooseShape,
  cropFor,
  extendPlan,
  type FracRect,
  needsExtension,
  type PictureFacts,
  pairFit,
  RES_FLOOR,
  SHAPES,
  type ShapeName,
  safeShapes,
  shapeMode,
  shapeRatio,
  subjectArea,
  ZOOM_FILL,
} from "./picture-fit";

/*
 * TEACH-25 part b (ruling 217): the pilot's picture.js r4 ported. The golden file holds the facts of
 * the pilot's cases (padding-test masters with their measured boxes, the unpadded controls with
 * auto boxes, the stress photos and the matched pairs) and what picture.js returned for them.
 */
type Golden = {
  facts: PictureFacts;
  modes: Record<ShapeName, "crop" | "extend" | null>;
  crops: Partial<
    Record<ShapeName, FracRect & { zoom: number; zoomed: boolean; extended: boolean }>
  >;
  area43: number;
};
const pictures = golden.pictures as unknown as Record<string, Golden>;
const pairs = golden.pairs as unknown as Record<
  string,
  { shared: ShapeName[]; crops: (FracRect & { extended: boolean })[] }
>;
const BOXES: Record<ShapeName, { w: number; h: number }> = {
  "16:9": { w: 556, h: 313 },
  "4:3": { w: 470, h: 352 },
  "1:1": { w: 470, h: 470 },
  "3:4": { w: 470, h: 627 },
};
const pic = (id: string): PictureFacts => {
  const g = pictures[id];
  if (!g) throw new Error(`no golden picture ${id}`);
  return g.facts;
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
/** The crop keeps the subject whole. */
const keepsSubject = (c: FracRect, s: FracRect) =>
  c.x <= s.x + 1e-6 &&
  c.y <= s.y + 1e-6 &&
  c.x + c.w >= s.x + s.w - 1e-6 &&
  c.y + c.h >= s.y + s.h - 1e-6;

describe("picture fit matches the pilot's picture.js (row 1)", () => {
  for (const [id, g] of Object.entries(pictures))
    test(`${id}: safe shapes and crops`, () => {
      for (const [name, ratio] of SHAPES) expect(shapeMode(g.facts, ratio)).toBe(g.modes[name]);
      for (const [name, want] of Object.entries(g.crops)) {
        const got = cropFor(g.facts, BOXES[name as ShapeName]);
        for (const k of ["x", "y", "w", "h"] as const) expect(near(got[k], want[k])).toBe(true);
        expect(got.extended).toBe(want.extended);
        expect(got.zoomed).toBe(want.zoomed);
      }
      expect(near(subjectArea(g.facts, BOXES["4:3"]), g.area43, g.area43 * 0.01)).toBe(true);
    });

  test("the numbers are the pilot's", () => {
    expect(ZOOM_FILL).toBe(0.72);
    expect(RES_FLOOR).toBe(0.6);
    expect(SHAPES.map(([n]) => n)).toEqual(["16:9", "4:3", "1:1", "3:4"]);
    expect(shapeRatio("3:4")).toBe(0.75);
  });

  test("a padded master is zoomed so its subject fills about 72% of the crop", () => {
    const jar = pic("jar");
    const c = cropFor(jar, BOXES["3:4"]);
    const s = jar.subject as FracRect;
    expect(c.zoomed).toBe(true);
    expect(near(s.h / c.h, ZOOM_FILL, 0.05)).toBe(true);
    expect(keepsSubject(c, s)).toBe(true);
  });
});

describe("shapes", () => {
  test("very tall and very wide stress photos: no safe shape, the box takes their own shape (row 5)", () => {
    for (const id of ["tall", "wide"]) {
      const f = pic(id);
      expect(safeShapes(f)).toEqual([]);
      const zone = { w: 556, h: 420 };
      const c = chooseShape(zone, f);
      expect(c.shape).toBe("own");
      expect(c.mode).toBe("own");
      expect(near(c.box.w / c.box.h, f.width / f.height, 0.01)).toBe(true);
      expect(c.box.w <= zone.w && c.box.h <= zone.h).toBe(true);
      expect(c.box.w === zone.w || c.box.h === zone.h).toBe(true);
      const crop = cropFor(f, c.box);
      // the whole picture, less a pixel's rounding of the box
      expect([crop.x, crop.y, crop.w, crop.h].map((v) => +v.toFixed(2))).toEqual([0, 0, 1, 1]);
    }
  });

  test("an isolated object on a plain backdrop extends where cropping would cut it", () => {
    const f = pic("isolated");
    expect(shapeMode(f, 16 / 9)).toBe("extend");
    expect(shapeMode(f, 1)).toBe("crop");
    expect(shapeMode(f, 16 / 9, { extend: false })).toBeNull();
  });

  test("chooseShape ranks safe shapes by how big the subject shows; a stretched backdrop counts 8% less", () => {
    const heart = pic("heart");
    const zone = { w: 556, h: 556 };
    const best = chooseShape(zone, heart);
    expect(best.shape).not.toBe("own");
    const areas = SHAPES.filter(([, r]) => shapeMode(heart, r)).map(([n, r]) => {
      const box = { w: Math.min(zone.w, zone.h * r), h: Math.min(zone.h, zone.w / r) };
      return [n, subjectArea(heart, box)] as const;
    });
    const bestArea = areas.find(([n]) => n === best.shape)?.[1] ?? 0;
    for (const [, a] of areas) expect(bestArea).toBeGreaterThanOrEqual(a - 1e-6);
    // 1:1 and 3:4 show the heart equally large: the bigger box wins the tie
    expect(best.shape).toBe("1:1");
  });

  test("chooseShape 'tallest' takes the tallest safe shape at the zone's width that fits its height", () => {
    const jar = pic("jar");
    expect(chooseShape({ w: 470, h: 700 }, jar, { order: "tallest" })).toMatchObject({
      shape: "3:4",
      box: { w: 470, h: 627 },
      mode: "crop",
    });
    expect(chooseShape({ w: 470, h: 500 }, jar, { order: "tallest" }).shape).toBe("1:1");
    expect(chooseShape({ w: 470, h: 300 }, jar, { order: "tallest" }).shape).toBe("16:9");
  });

  test("chooseShape keeps to the shapes it is offered", () => {
    expect(chooseShape({ w: 556, h: 556 }, pic("jar"), { shapes: ["4:3"] }).shape).toBe("4:3");
  });
});

describe("scenes (row 2)", () => {
  test("a busy scene with no subject box: centred, at most 30% lost per axis, never extended, no zoom", () => {
    const scene = pic("scene");
    expect(scene.subject).toBeUndefined();
    for (const [name, ratio] of SHAPES) {
      const mode = shapeMode(scene, ratio);
      expect(mode).not.toBe("extend");
      if (!mode) continue;
      const c = cropFor(scene, BOXES[name]);
      expect(c.extended).toBe(false);
      expect(c.zoomed).toBe(false);
      expect(Math.min(c.w, c.h)).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(near(c.x + c.w / 2, 0.5, 1e-6) && near(c.y + c.h / 2, 0.5, 1e-6)).toBe(true);
    }
    expect(shapeMode(scene, 3 / 4)).toBeNull();
  });

  test("a scene is never extended, even on plain edges", () => {
    const iso = pic("isolated");
    const scene: PictureFacts = { ...iso, kind: "scene" };
    for (const [, ratio] of SHAPES) expect(shapeMode(scene, ratio)).not.toBe("extend");
    for (const box of Object.values(BOXES)) {
      const c = cropFor(scene, box);
      expect(c.extended).toBe(false);
      expect(needsExtension(c)).toBe(false);
    }
  });

  test("a picture with no backdrop facts never extends", () => {
    const { backdrop: _drop, ...bare } = pic("jar");
    for (const [, ratio] of SHAPES) expect(shapeMode(bare, ratio)).not.toBe("extend");
    expect(cropFor(bare, BOXES["16:9"]).extended).toBe(false);
  });
});

describe("matched pairs (row 4)", () => {
  const zone = { w: 556, h: 313 };

  test("hen and chick: one shape, one scale, both subjects whole", () => {
    const fit = pairFit([pic("hen"), pic("chick")], zone);
    expect(pairs["hen-chick"]?.shared).toContain(fit.shape as ShapeName);
    expect(fit.boxes[0]).toEqual(fit.boxes[1]);
    const [a, b] = fit.crops;
    if (!a || !b) throw new Error("both sides crop");
    expect(near(a.w, b.w, 1e-6)).toBe(true);
    expect(keepsSubject(a, pic("hen").subject as FracRect)).toBe(true);
    expect(keepsSubject(b, pic("chick").subject as FracRect)).toBe(true);
  });

  test("bean seedling and mature plant share the widest crop, as the pilot did", () => {
    const facts = [pic("seedling"), pic("mature")];
    const fit = pairFit(facts, { w: 417, h: 313 }, { shapes: ["4:3"] });
    expect(fit.shape).toBe("4:3");
    fit.crops.forEach((c, i) => {
      const want = pairs.bean?.crops[i];
      if (!c || !want) throw new Error("both sides crop");
      for (const k of ["x", "y", "w", "h"] as const) expect(near(c[k], want[k])).toBe(true);
      expect(keepsSubject(c, facts[i]?.subject as FracRect)).toBe(true);
    });
  });

  test("shield and composite volcano: shared shapes leave out 3:4, both keep the whole width", () => {
    const facts = [pic("shield"), pic("composite")];
    const fit = pairFit(facts, zone);
    expect(fit.shape).not.toBe("3:4");
    expect(fit.shape).not.toBe("own");
    for (const c of fit.crops) expect(c?.w).toBeCloseTo(1, 3);
    for (const name of ["16:9", "4:3", "1:1"] as const)
      expect(facts.every((f) => shapeMode(f, shapeRatio(name)))).toBe(true);
  });

  test("a diagram side is contained and the photo side still gets a shape", () => {
    const fit = pairFit([null, pic("jar")], zone);
    expect(fit.crops[0]).toBeNull();
    expect(fit.shape).not.toBe("own");
    expect(fit.crops[1]).not.toBeNull();
  });

  test("no common safe shape: each box takes its own shape at one shared height", () => {
    const fit = pairFit([pic("tall"), pic("wide")], { w: 556, h: 313 });
    expect(fit.shape).toBe("own");
    const [t, w] = fit.boxes;
    if (!t || !w) throw new Error("two boxes");
    expect(near(t.w / t.h, 600 / 1707, 0.01)).toBe(true);
    expect(near(w.w / w.h, 1280 / 380, 0.01)).toBe(true);
    expect(w.w).toBeLessThanOrEqual(556);
    expect(t.h).toBe(w.h);
    expect(t.h).toBeLessThanOrEqual(313);
  });

  test("one side zooms, the other does not: each keeps its own crop", () => {
    const jar = pic("jar");
    const scene = pic("scene");
    const fit = pairFit([jar, scene], zone);
    const box = fit.boxes[0] as { w: number; h: number };
    const [a, b] = fit.crops;
    expect(a).toEqual(cropFor(jar, box));
    expect(b).toEqual(cropFor(scene, box));
    expect(a?.zoomed || a?.extended).toBe(true);
    expect(b?.zoomed).toBe(false);
  });
});

describe("extension (row 3, plan as data)", () => {
  test("a plain-backdrop object too tall for 16:9 extends on the plain axis only", () => {
    const jar = pic("jar");
    const c = cropFor(jar, BOXES["16:9"]);
    expect(needsExtension(c)).toBe(true);
    const plan = extendPlan(jar, c);
    expect(plan.width).toBe(Math.round(c.w * jar.width));
    expect(plan.height).toBe(Math.round(c.h * jar.height));
    expect(plan.pad.left).toBeGreaterThan(0);
    expect(plan.pad.right).toBeGreaterThan(0);
    expect(plan.pad.top).toBe(0);
    expect(plan.pad.bottom).toBe(0);
    expect(plan.pad.left + jar.width + plan.pad.right).toBe(plan.width);
    expect(plan.offsetX).toBe(plan.pad.left);
    expect(plan.offsetY).toBeLessThanOrEqual(0);
  });

  test("an in-image crop needs no extension and its plan pads nothing", () => {
    const c = cropFor(pic("jar"), BOXES["3:4"]);
    expect(needsExtension(c)).toBe(false);
    expect(extendPlan(pic("jar"), c).pad).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe("resolution floor", () => {
  test("a crop is never under 0.6x the displayed box in source pixels", () => {
    // A small subject in a small picture shown large: zooming to 72% would ask for a crop of 200px.
    const small: PictureFacts = {
      width: 600,
      height: 600,
      subject: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
      backdrop: { plain: { top: true, right: true, bottom: true, left: true }, colour: "#ffffff" },
    };
    const box = { w: 800, h: 600 };
    const c = cropFor(small, box);
    expect(c.w * small.width).toBeGreaterThanOrEqual(RES_FLOOR * box.w - 0.5);
    expect(c.zoomed).toBe(true);
    // the floor wins over the 72% fill: the subject shows smaller than 72%
    expect((small.subject as FracRect).w / c.w).toBeLessThan(ZOOM_FILL);
  });

  test("the floor never zooms a low-resolution picture out into an extension it did not need", () => {
    // a 400px object shown in a 900px box: the floor (540px) is past the whole picture
    const low: PictureFacts = {
      width: 400,
      height: 300,
      subject: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 },
      backdrop: { plain: { top: true, right: true, bottom: true, left: true }, colour: "#ffffff" },
    };
    const c = cropFor(low, { w: 900, h: 675 });
    expect(c.extended).toBe(false);
    expect(needsExtension(c)).toBe(false);
    expect(c.w).toBeCloseTo(1, 6);
    expect(c.h).toBeCloseTo(1, 6);
  });

  test("zoom: false keeps the largest in-image crop", () => {
    const c = cropFor(pic("jar"), BOXES["3:4"], { zoom: false });
    expect(c.zoomed).toBe(false);
    expect(c.h).toBeCloseTo(1, 6);
  });
});

test("pure and deterministic: same facts, same answer", () => {
  const f = pic("mature");
  expect(cropFor(f, BOXES["16:9"])).toEqual(cropFor(f, BOXES["16:9"]));
  expect(pairFit([pic("hen"), pic("chick")], { w: 556, h: 313 })).toEqual(
    pairFit([pic("hen"), pic("chick")], { w: 556, h: 313 }),
  );
});
