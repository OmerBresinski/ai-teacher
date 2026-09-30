import { describe, expect, test } from "bun:test";
import { LIVE_BLANK } from "@tj/domain";
import { materialiseSlide } from "@tj/slides";
import { renderWritten } from "./fit";
import { blankOf, liveFields, overBlank } from "./live";
import { planMenu } from "./menu";

const META = { promptVersion: "live", model: "code", at: "1970-01-01T00:00:00.000Z" };

describe("live writing: a slide drawn before it is written", () => {
  test("every menu form draws from blanks alone and from a first field", () => {
    for (const m of planMenu("Science")) {
      for (const partial of [{}, { title: "Particles in a solid" }]) {
        const r = renderWritten(m.form, m.layout, liveFields(m.form, m.layout, partial));
        let n = 0;
        const slide = materialiseSlide(
          r.spec,
          "chalk",
          META,
          () => `e${n++}`,
          r.variant,
          r.structure,
        );
        expect(slide.elements.length).toBeGreaterThan(0);
      }
    }
  });

  test("unwritten text is a run of LIVE_BLANK; written text stands", () => {
    const blank = blankOf({ _zod: { def: { type: "string" }, bag: { maximum: 40 } } });
    expect(typeof blank).toBe("string");
    expect(
      String(blank)
        .replaceAll(" ", "")
        .split("")
        .every((c) => c === LIVE_BLANK),
    ).toBe(true);
    const merged = overBlank({ a: "x", list: ["b", "b"] }, { a: "Hello", list: ["one"] }) as {
      a: string;
      list: string[];
    };
    expect(merged).toEqual({ a: "Hello", list: ["one", "b"] });
  });

  test("an empty string still being written keeps its blank", () => {
    expect(overBlank("blank", " ")).toBe("blank");
    expect(overBlank("blank", "Wo")).toBe("Wo");
  });
});
