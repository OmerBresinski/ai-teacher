import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { editReference, REFERENCES } from "./index";

const photo = { photo: "/files/x.jpg", alt: "x" };
const diagram = {
  diagram: {
    kind: "flow",
    alt: "a cycle",
    layout: "cycle",
    steps: [{ label: "Evaporation" }, { label: "Condensation" }, { label: "Rain" }],
  },
};
const stages = ["ks1", "ks2", "ks3", "ks4", "ks5"] as const;
/** Short content for every slot kind, so every reference draws at every stage. */
function fill(def: (typeof REFERENCES)[number], st: (typeof stages)[number]) {
  const v: Record<string, unknown> = {};
  for (const s of def.slots(st)) {
    if (s.kind === "text") v[s.id] = "A short line";
    else if (s.kind === "list") v[s.id] = Array.from({ length: s.max }, (_, k) => `Item ${k + 1}`);
    else if (s.kind === "items")
      v[s.id] = Array.from({ length: s.min + 1 }, () =>
        Object.fromEntries(
          Object.entries(s.fields).map(([k, f]) => [k, "picture" in f ? photo : "Word"]),
        ),
      );
    else v[s.id] = s.kind === "diagram" ? diagram : photo;
  }
  return v;
}
const themeOf = (st: string) => getTheme(st === "ks1" || st === "ks2" ? "splash" : "studio", st);

describe("arm R references", () => {
  for (const def of REFERENCES)
    test(`${def.id} draws clean at every stage with short content`, () => {
      for (const st of stages) {
        const r = editReference({ reference: def.id, slots: fill(def, st) }, themeOf(st), st);
        expect(r.slide.elements.length).toBeGreaterThan(0);
        expect([st, ...r.over.filter((o) => !o.startsWith("picture: diagram"))]).toEqual([st]);
        for (const e of r.slide.elements) {
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.x + e.w).toBeLessThanOrEqual(960);
        }
      }
    });

  test("fixed geometry: the picture panel does not move or resize with the text", () => {
    const t = themeOf("ks3");
    const box = (lead: string) =>
      editReference(
        { reference: "explain-picture", slots: { heading: "H", lead, picture: photo } },
        t,
        "ks3",
      ).slide.elements.find((e) => e.type === "image");
    const a = box("Short.");
    const b = box("A much longer lead sentence that wraps over several lines in the column.");
    expect([a?.x, a?.y, a?.w, a?.h]).toEqual([b?.x, b?.y, b?.w, b?.h]);
  });

  test("over capacity: one step down, then a flag", () => {
    const t = themeOf("ks3");
    const long = "This sentence is far too long for the slot. ".repeat(12);
    const r = editReference(
      { reference: "explain-picture", slots: { heading: "H", lead: long, picture: photo } },
      t,
      "ks3",
    );
    expect(r.stepped).toContain("lead");
    expect(r.over.some((o) => o.startsWith("lead:"))).toBe(true);
    const slight = editReference(
      {
        reference: "objectives",
        slots: {
          heading: "Objectives",
          items: [
            "Describe how the Romans built and defended the wall along the northern frontier in detail.",
            "Explain why.",
          ],
        },
      },
      t,
      "ks3",
    );
    expect(slight.over).toEqual([]);
  });

  test("an unknown reference throws", () => {
    expect(() => editReference({ reference: "nope", slots: {} }, themeOf("ks3"), "ks3")).toThrow();
  });
});
