import { describe, expect, it } from "bun:test";
import { fitsPlanned } from "./fit-check";
import type { SlideSpec } from "./specs";

const title = (text: string) =>
  ({ kind: "title", title: text, subtitle: "Year 5 · Geography", factRefs: ["o1"] }) as SlideSpec;

describe("a long title keeps its picture (UX ruling 134)", () => {
  it("sets a title over 45 characters in the taller photo band when photo-band cannot", () => {
    const spec = title("Rivers: the journey of a river from source to mouth");
    // With no class line on the cover (ruling 162) the split holds it too.
    expect(fitsPlanned(spec, { variant: "photo-band", stepDown: 0 }).ok).toBe(false);
    expect(fitsPlanned(spec, { variant: "photo-band-long", stepDown: 0 }).ok).toBe(true);
  });

  it("does not count the band run to the slide's foot as an overflow", () => {
    expect(
      fitsPlanned(title("The Romans in Britain"), { variant: "photo-band", stepDown: 0 }).ok,
    ).toBe(true);
  });
});
