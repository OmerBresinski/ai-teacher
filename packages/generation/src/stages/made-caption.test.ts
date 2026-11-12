import { describe, expect, test } from "bun:test";
import { MADE_PHOTO_CAPTION, madeCaption, RECONSTRUCTION_CAPTION } from "./picture-director";

/*
 * 11 Nov blind review (CRITIQUE-1 item 9): y8 photosynthesis s4's generated "micrograph" (photo
 * style, route generic, prompt "A realistic microscope photograph of ... leaf cells") had no label,
 * while s8's painted rows said "Artist's reconstruction". Recorded in genlab
 * 20261111-232340-record-e2e-y8-photosynthesis (debug picture s4: via generated, plan photo).
 */
describe("every generated picture that could pass for a photograph says it is made", () => {
  test("y8 s4: a photo-style generated picture is labelled", () => {
    expect(madeCaption({ provider: "generated", style: "photo", reconstruction: false })).toBe(
      MADE_PHOTO_CAPTION,
    );
    // A made picture with no style recorded is laid as a photo, so it is labelled as one.
    expect(madeCaption({ provider: "generated", reconstruction: false })).toBe(MADE_PHOTO_CAPTION);
  });

  test("ruling 300's painted reconstruction keeps its caption", () => {
    expect(
      madeCaption({ provider: "generated", style: "illustration", reconstruction: true }),
    ).toBe(RECONSTRUCTION_CAPTION);
  });

  test("a painting or drawing that is no reconstruction, and any real photo, carry none", () => {
    expect(
      madeCaption({ provider: "generated", style: "illustration", reconstruction: false }),
    ).toBe(undefined);
    expect(madeCaption({ provider: "generated", style: "drawn", reconstruction: false })).toBe(
      undefined,
    );
    expect(madeCaption({ provider: "commons", style: "photo", reconstruction: false })).toBe(
      undefined,
    );
    expect(madeCaption({ provider: "pexels", reconstruction: false })).toBe(undefined);
  });
});
