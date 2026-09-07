import { describe, expect, it } from "bun:test";
import { THEMES } from "@tj/editor";
import { LIBRARY_THEMES } from "./library-themes";

describe("LIBRARY_THEMES", () => {
  it("mirrors the editor catalogue: same ids, names and ground/ink colours", () => {
    expect(LIBRARY_THEMES.map((t) => [t.id, t.name, t.swatch, t.ink])).toEqual(
      THEMES.map((t) => [t.id, t.name, t.colors.background, t.colors.ink]),
    );
  });
});
