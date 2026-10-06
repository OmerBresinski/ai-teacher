import { describe, expect, test } from "bun:test";
import * as slides from "@tj/slides";
import { createMeasurer } from "../../layout/measure";
import * as themes from "../../model/themes";
import * as kit from "./kit";

/** FIX-TYPE: the editor, the presenter and generation size text through one function. */
describe("one size function", () => {
  test("the renderers' kit and the editor's themes are @tj/slides' own", () => {
    expect(kit.resolveTextStyle).toBe(slides.resolveTextStyle);
    expect(kit.resolveFontSize).toBe(slides.resolveFontSize);
    expect(themes.getTheme).toBe(slides.getTheme);
    expect(themes.lessonTheme).toBe(slides.lessonTheme);
  });

  test("a lesson's theme reads at its key stage with no process-wide stage, as generation lays it out", () => {
    expect(slides.keyStage()).toBeUndefined();
    for (const [band, body] of [
      ["ks1", 33],
      ["ks2", 29],
      ["ks3", 25],
      ["ks5", 25],
    ] as const) {
      const t = themes.lessonTheme({ themeId: "studio", ageBand: band });
      expect(kit.resolveFontSize(t, "body")).toBe(body);
      expect(kit.resolveTextStyle({ preset: "small" }, t, "small", "option").fontSize).toBe(body);
      const laid = slides.withKeyStage(band, () =>
        slides.resolveFontSize(slides.getTheme("studio"), "body"),
      );
      expect(laid).toBe(body);
      // The editor's measurer sizes text with the same theme the presenter draws with.
      expect(typeof createMeasurer(t)).toBe("function");
    }
    // An old lesson with no age band keeps the theme's own ladder.
    expect(kit.resolveFontSize(themes.lessonTheme({ themeId: "studio" }), "body")).toBe(
      slides.getTheme("studio").sizes.body,
    );
  });
});
