import { describe, expect, test } from "bun:test";

/*
 * ADR 0022 §8: the thumbnail path the library imports must not carry the editor. Build the entry
 * for the browser and look for the modules that would mean it did. `@tiptap/html` needs
 * `@tiptap/core` and its ProseMirror packages to render static HTML, so those are expected; the
 * React editor binding and every editing-only dependency are not.
 *
 * The element renderers reach the editors through `React.lazy` (TEACH-104), so the build is split
 * and only the chunks the entry loads *statically* are inspected: a lazily imported chunk is, by
 * definition, not part of the thumb.
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
      splitting: true,
    });
    expect(result.success).toBe(true);
    const byName = new Map(
      await Promise.all(
        result.outputs.map(
          async (o) => [o.path.split("/").pop() ?? o.path, await o.text()] as const,
        ),
      ),
    );
    const entry = result.outputs.find((o) => o.kind === "entry-point");
    if (!entry) throw new Error("no entry chunk");
    // Walk the static `import ... from "./chunk"` edges only; `import("./chunk")` is lazy.
    const loaded = new Set<string>();
    const queue = [entry.path.split("/").pop() ?? entry.path];
    while (queue.length) {
      const name = queue.pop() as string;
      if (loaded.has(name)) continue;
      loaded.add(name);
      const text = byName.get(name) ?? "";
      for (const m of text.matchAll(/^(?:import|export)[^;]*?from\s*"\.\/([^"]+)"/gm)) {
        if (m[1]) queue.push(m[1]);
      }
    }
    expect(loaded.size).toBeGreaterThan(0);
    // The lazy editor chunks exist, but off the static graph.
    expect(byName.size).toBeGreaterThan(loaded.size);
    const text = [...loaded].map((n) => byName.get(n) ?? "").join("\n");
    for (const name of FORBIDDEN) {
      expect(
        text.includes(name),
        `${name} reached the thumb chunk via ${[...loaded].join(", ")}`,
      ).toBe(false);
    }
  });
});
