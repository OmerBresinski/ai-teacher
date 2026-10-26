/**
 * The typewriter's catch-up and reduced-motion paces (review of #638). A slide written whole before
 * the view reached it types in over the same few steps whatever its length, never appearing fully
 * formed; with reduced motion a slide's words are all there at once, no typing at all.
 */
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { CATCH_UP_STEPS, useTypewriter } from "./live-draft";

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe("useTypewriter", () => {
  test("catch-up: a 60-word slide types in over a few steps, not at once and not word by word", async () => {
    const r = renderHook(
      ({ key, target }) => useTypewriter(target, key, false, false, undefined, "catch-up"),
      { initialProps: { key: "a", target: 0 } },
    );
    r.rerender({ key: "b", target: 60 });
    // It opens on its first word, not the whole slide.
    expect(r.result.current).toBeLessThan(60);
    await wait(150);
    const early = r.result.current;
    expect(early).toBeGreaterThan(1);
    expect(early).toBeLessThan(60);
    // All of it within the catch-up's fixed number of steps (35 ms each), plus frame slack.
    await wait(CATCH_UP_STEPS * 35 + 400);
    expect(r.result.current).toBe(60);
  });

  test("reduced motion: a new slide's words are all there at once, and so are later ones", () => {
    const r = renderHook(
      ({ key, target }) => useTypewriter(target, key, true, false, undefined, "catch-up"),
      { initialProps: { key: "a", target: 0 } },
    );
    r.rerender({ key: "b", target: 60 });
    expect(r.result.current).toBe(60);
    r.rerender({ key: "b", target: 75 });
    expect(r.result.current).toBe(75);
  });
});
