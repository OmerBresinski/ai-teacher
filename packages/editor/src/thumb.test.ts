import { describe, expect, test } from "bun:test";

/*
 * ADR 0022 §8: the thumbnail path the library imports must not carry the editor. Build the entry
 * for the browser and look for the modules that would mean it did. `@tiptap/html` needs
 * `@tiptap/core` and its ProseMirror packages to render static HTML, so those are expected; the
 * React editor binding and every editing-only dependency are not.
 */
const FORBIDDEN = [
  "@tiptap/react",
  "@tiptap/extension-bubble-menu",
  "@use-gesture",
  "zustand",
  "@tanstack/react-virtual",
  "tinykeys",
  "immer",
  "@tanstack/react-query",
];

describe("@tj/editor/thumb", () => {
  test("bundles without any editing module", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dir}/thumb.ts`],
      target: "browser",
      external: ["react", "react-dom", "react/jsx-runtime", "*.css"],
      minify: false,
    });
    expect(result.success).toBe(true);
    const code = result.outputs.map((o) => o.path).join("\n");
    const text = (await Promise.all(result.outputs.map((o) => o.text()))).join("\n");
    for (const name of FORBIDDEN) {
      expect(text.includes(name), `${name} reached the thumb chunk via ${code}`).toBe(false);
    }
  });
});
