import { describe, expect, test } from "bun:test";

/*
 * ADR 0022 §8, TEACH-160 row 8: the worksheet print entry (`@tj/editor/worksheet`, imported by
 * the print route instead of the editor entry so the print chunk never pulls Tiptap) must not
 * carry the image picker or anything editing-only. Mirrors `src/thumb.test.ts`: walk the static
 * import edges only; a lazily imported chunk is, by definition, not part of the print chunk.
 */
const FORBIDDEN = ["ImagePicker", "@tanstack/react-query"];

describe("@tj/editor/worksheet", () => {
  test("bundles without the image picker or editing modules", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dir}/index.ts`],
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
    // Bun annotates bundled modules with `// node_modules/...` path comments: an entry that
    // merely passes *through* such a path would false-positive, so strip comment lines and
    // match real references only.
    const text = [...loaded]
      .map((n) => byName.get(n) ?? "")
      .join("\n")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    for (const name of FORBIDDEN) {
      expect(
        text.includes(name),
        `${name} reached the worksheet print chunk via ${[...loaded].join(", ")}`,
      ).toBe(false);
    }
  });
});
