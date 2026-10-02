import { afterEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { Slide } from "@tj/domain/documents";
import { materialiseSlides, PHOTO_NAME } from "@tj/slides";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";
import { setSlotPlaceholders } from "./slot-placeholders";

/*
 * look/image-slot: an open photo slot is the editor's placeholder and never an empty box in
 * present or export; the demo switch draws every slot in present, never in capture.
 */

const theme = getTheme("chalk");
const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
const [withPhoto] = materialiseSlides(
  {
    kind: "content",
    factRefs: [],
    heading: "Why conquer Britain?",
    body: "Rome wanted Britain for its metals, grain and slaves. A victory there made Claudius look strong.",
  },
  "chalk",
  meta,
  undefined,
  0,
  { photo: { subject: "Roman legionaries", mustShow: ["shields", "armour"] } },
) as [Slide];
const [withDiagram] = materialiseSlides(
  {
    kind: "content",
    factRefs: [],
    heading: "The water cycle",
    body: "Water moves between the sea, the air and the land in a loop. The sun heats the sea and water evaporates.",
    diagram: "Cycle: evaporation → condensation → precipitation → collection",
  },
  "chalk",
  meta,
) as [Slide];

type Mode = "edit" | "present" | "view" | "capture";
const shown = (slide: Slide, mode: Mode) => {
  const { container } = render(<SlideView slide={slide} theme={theme} mode={mode} />);
  return container;
};
const slotId = withPhoto.elements.find((e) => e.name === PHOTO_NAME)?.id;

afterEach(() => setSlotPlaceholders(false));

describe("an open photo slot", () => {
  test("the editor draws the placeholder with what the photo should show", () => {
    const c = shown(withPhoto, "edit");
    const box = c.querySelector('[data-slot-placeholder="photo"]');
    expect(box?.textContent).toBe("Photo: Roman legionaries — shields, armour");
    expect(c.querySelector("img")).toBeNull();
  });

  for (const mode of ["present", "view", "capture"] as const) {
    test(`${mode}: no box, the words take the width`, () => {
      const c = shown(withPhoto, mode);
      expect(c.querySelector("[data-slot-placeholder]")).toBeNull();
      expect(c.querySelector(`[data-element-id="${slotId}"]`)).toBeNull();
    });
  }
});

describe("the demo switch", () => {
  test("on, present and thumbnails still never draw a brief", () => {
    setSlotPlaceholders(true);
    for (const mode of ["present", "view"] as const) {
      expect(shown(withPhoto, mode).querySelector("[data-slot-placeholder]")).toBeNull();
      const c = shown(withDiagram, mode);
      expect(c.textContent).not.toContain("Diagram:");
      expect(c.querySelector("[data-slot-placeholder]")).toBeNull();
    }
  });

  test("capture (export, print) never draws a placeholder", () => {
    setSlotPlaceholders(true);
    expect(shown(withPhoto, "capture").querySelector("[data-slot-placeholder]")).toBeNull();
    expect(shown(withDiagram, "capture").textContent).not.toContain("Diagram:");
  });

  test("off, present draws neither", () => {
    expect(shown(withPhoto, "present").querySelector("[data-slot-placeholder]")).toBeNull();
    expect(shown(withDiagram, "present").textContent).not.toContain("Diagram:");
  });
});
