import { describe, expect, test } from "bun:test";
import { materialiseSlide } from "./materialise";
import { getTheme, keyStage, THEMES, withKeyStage } from "./themes";

/** FIX1: one body size per key stage, fixed across the deck, much larger than the old teaching body. */
describe("key-stage type", () => {
  test("body reads from the back of the room: KS1 ≥ 28 (≈ 42 pt at 1920 wide), KS2 ≥ 24, KS3–5 ≥ 22", () => {
    for (const t of THEMES) {
      const own = t.sizes.body;
      expect(withKeyStage("ks1", () => t.sizes.body)).toBeGreaterThanOrEqual(28);
      expect(withKeyStage("ks2", () => t.sizes.body)).toBeGreaterThanOrEqual(24);
      for (const ks of ["ks3", "ks4", "ks5"])
        expect(withKeyStage(ks, () => t.sizes.body)).toBeGreaterThan(own);
      expect(withKeyStage("ks1", () => t.sizes.heading)).toBeGreaterThan(t.sizes.heading);
    }
    expect(keyStage()).toBeUndefined();
  });

  test("a deck's teaching slides set their reading text at the stage's one body size", () => {
    const meta = { promptVersion: "t", model: "code", at: "1970-01-01T00:00:00.000Z" };
    const theme = getTheme("splash");
    const sizes = withKeyStage("ks1", () =>
      [
        ["Two short points.", "Another."],
        ["A much longer point that wraps over a line or two on the slide.", "Short.", "Third."],
      ].flatMap((points) => {
        const s = materialiseSlide(
          { kind: "content", factRefs: [], heading: "Animals", body: points.join(" ") } as never,
          theme.id,
          meta,
        );
        return s.elements
          .filter((e) => e.type === "text" && e.style?.preset === "body")
          .map((e) => (e.type === "text" ? e.style?.fontSize : undefined));
      }),
    );
    // The reading text sits at the stage's body size on both slides (a lead may stand one stop larger).
    const body = withKeyStage("ks1", () => theme.sizes.body);
    expect(Math.min(...(sizes as number[]))).toBe(body);
    expect(sizes.every((n) => (n ?? 0) >= body)).toBe(true);
  });
});
