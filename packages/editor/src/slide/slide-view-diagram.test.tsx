import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { DIAGRAM_NAME, materialiseSlide, PANEL_NAME, withoutDiagramSlot } from "@tj/slides";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";

const theme = getTheme("chalk");
const stored = materialiseSlide(
  {
    kind: "content",
    factRefs: [],
    heading: "How a volcano erupts",
    body: "Magma rises through cracks in the crust. Pressure builds as gas collects in the magma chamber. The crust gives way and lava pours out.",
    diagram: "Cross-section: magma chamber, vent, crater, ash cloud",
  },
  "chalk",
  { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" },
);
const rendered = (mode: "edit" | "present" | "view" | "capture") => {
  const { container } = render(<SlideView slide={stored} theme={theme} mode={mode} />);
  return [...container.querySelectorAll("[data-element-id]")].map(
    (e) => (e as HTMLElement).dataset.elementId,
  );
};

describe("a diagram instruction with no drawing", () => {
  const slot = stored.elements.find((e) => e.name === DIAGRAM_NAME);
  const panel = withoutDiagramSlot(stored, theme).elements.find((e) => e.name === PANEL_NAME);

  test("the editor keeps the placeholder in the right half", () => {
    expect(slot).toBeDefined();
    expect(rendered("edit")).toContain(slot?.id);
  });

  for (const mode of ["present", "view", "capture"] as const) {
    test(`${mode}: no empty right half, the key idea takes the panel`, () => {
      const ids = rendered(mode);
      expect(ids).not.toContain(slot?.id);
      expect(panel).toBeDefined();
      expect(ids).toContain(panel?.id);
    });
  }
});
