// faults-3-6-8 #8: the gas8 check and its text-safe fallback on the real R4 y11 numbers.
import { afterEach, expect, test } from "bun:test";
import { AB_CONFIG, abGas8, setAbArm, setAbCodeArm } from "./arms";
import { gasFaults, gasMax, rescaleGas } from "./gas8";

afterEach(() => {
  setAbCodeArm(undefined);
  setAbArm(undefined);
});

// base4-4 y11 (stream.txt 170-193): 0.040 g Mg in the method, 0.08 g in a later comparison table.
const R4 = [
  "Add 0.040 g of magnesium ribbon; start timing and seal immediately.",
  "0.5 mol/dm³ acid, 0.04 g magnesium, 20°C | 1.0 mol/dm³ acid, 0.08 g magnesium, 30°C",
  "A reaction produces 48 cm³ of hydrogen in its first 30 s.",
  "A reaction produces 54 cm³ of hydrogen in its first 30 s. A reaction produces 72 cm³ in its first 60 s.",
  "Rate is gas volume divided by time.",
];

test("only the gas8 arm turns the check on", () => {
  setAbArm("base4");
  expect(abGas8()).toBe(false);
  setAbCodeArm("gas8");
  expect(abGas8()).toBe(true);
  for (const [a, c] of Object.entries(AB_CONFIG)) if (a !== "gas8") expect(c.gas8).toBeUndefined();
});

test("R4 y11 under the first rule (least): 48, 54 and 72 cm³ are beyond 0.040 g (at most 39 cm³)", () => {
  expect(Math.floor(gasMax(R4)?.vmax ?? 0)).toBe(39);
  const hits = gasFaults(R4, "least");
  expect(hits.map((h) => h.slide)).toEqual([2, 3]);
  expect(hits[1]?.fault).toContain("54 cm³, 72 cm³");
  expect(hits[1]?.fault).toContain("at most 39 cm³");
});

test("tied rule: R4 compares 0.04 g and 0.08 g, and 'A reaction produces 72 cm³' names neither", () => {
  expect(gasFaults(R4)).toEqual([]);
  // ...but a volume no stated setup can give is still flagged (b4-r1t-wo2: 0.020 g and 0.040 g).
  const two = [
    "0.020 g magnesium at 20°C, then 0.040 g magnesium at 30°C",
    "Another reaction produces 72 cm³ in its first 45 s.",
  ];
  expect(gasFaults(two).map((h) => h.slide)).toEqual([1]);
});

test("tied rule: a bare second mass counts (base6-1: 'A uses 0.04 g magnesium; B uses 0.08 g')", () => {
  const t2 = [
    "A uses 0.04 g magnesium at 20°C; B uses 0.08 g at 30°C",
    "A reaction produces 48 cm³ of gas in 20 s.",
  ];
  expect(gasFaults(t2)).toEqual([]);
  expect(
    gasFaults(["A uses 0.04 g magnesium at 20°C", "A reaction produces 48 cm³ of gas in 20 s."]),
  ).toHaveLength(1);
});

test("tied rule: 'both' takes the smallest mass; a same-slide mass binds its slide", () => {
  const a12 = [
    "0.04 g magnesium and 20°C | 0.08 g magnesium and 30°C",
    "Both tests reach 60 cm³ of gas.",
  ];
  expect(gasFaults(a12).map((h) => h.slide)).toEqual([1]);
  const r1t = [
    "Both use 25 cm³ of acid and 0.020 g magnesium. In the first 20 s, trial A produces 24 cm³ of gas.",
  ];
  expect(gasFaults(r1t)).toHaveLength(1);
});

test("possible data, no stated mass, and other units are not flagged", () => {
  expect(
    gasFaults(["Use 0.10 g of magnesium.", "A reaction produces 54 cm³ of hydrogen in 45 s."]),
  ).toEqual([]);
  expect(gasFaults(["A reaction produces 480 cm³ of gas in its first 30 s."])).toEqual([]);
  expect(gasFaults(["Use 0.04 g of magnesium and 25 cm³ of acid."])).toEqual([]);
});

test("negatives and a solid in cm³ are flagged", () => {
  expect(gasFaults(["A reaction produces -5 cm³ of gas in its first 10 s."])[0]?.fault).toContain(
    "negative",
  );
  expect(gasFaults(["Add 3 cm³ of magnesium to the flask."])[0]?.fault).toContain("solid");
});

test("the fallback scales every claimed volume under the maximum, ratios kept, and clears the fault", () => {
  const hits = gasFaults(R4, "least");
  const fixed = R4.map((t, i) => {
    const h = hits.find((x) => x.slide === i);
    return h
      ? rescaleGas(
          t,
          hits.flatMap((x) => x.volumes),
          h.vmax,
        )
      : t;
  });
  expect(fixed[2]).toBe("A reaction produces 24 cm³ of hydrogen in its first 30 s.");
  expect(fixed[3]).toContain("27 cm³ of hydrogen");
  expect(fixed[3]).toContain("36 cm³ in its first 60 s");
  expect(gasFaults(fixed, "least")).toEqual([]);
  const slide = { heading: "Rates", questions: [R4[2]], picture: null };
  expect(rescaleGas(slide, [48], 39.5).questions[0]).toContain("36 cm³");
});
