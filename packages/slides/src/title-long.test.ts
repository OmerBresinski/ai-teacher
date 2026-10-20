import { describe, expect, it } from "bun:test";
import { fitsPlanned } from "./fit-check";
import type { SlideSpec } from "./specs";

const title = (text: string) =>
  ({ kind: "title", title: text, subtitle: "Year 5 · Geography", factRefs: ["o1"] }) as SlideSpec;

describe("a long title keeps its picture (UX ruling 134)", () => {
  it("sets a title over 45 characters in the taller photo band when split and photo-band cannot", () => {
    const spec = title("Rivers: the journey of a river from source to mouth");
    // Every theme now sets its cover in its own composition (TEACH-215 part g), which takes the
    // title in its own column on every variant: the long title fits split and photo-band too, on
    // every theme, and the taller band still holds it.
    for (const variant of ["split", "photo-band", "photo-band-long"])
      expect({ variant, ok: fitsPlanned(spec, { variant, stepDown: 0 }).ok }).toEqual({
        variant,
        ok: true,
      });
  });

  it("does not count the band run to the slide's foot as an overflow", () => {
    expect(
      fitsPlanned(title("The Romans in Britain"), { variant: "photo-band", stepDown: 0 }).ok,
    ).toBe(true);
  });
});
