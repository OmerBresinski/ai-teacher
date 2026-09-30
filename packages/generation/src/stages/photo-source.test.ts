import { describe, expect, test } from "bun:test";
import { isSpecificSubject } from "./illustrate";

describe("photo source per brief (ruling 139)", () => {
  test("a named, specific subject goes to Commons first; an everyday scene to Pexels", () => {
    for (const named of [
      "Hadrian's Wall",
      "Roman soldiers on Hadrian's Wall",
      "the River Severn in flood",
      "Roman Colosseum",
      "The Thames Barrier",
    ])
      expect(isSpecificSubject(named)).toBe(true);
    for (const everyday of [
      "Roman soldiers marching",
      "river in flood",
      "children reading",
      "Flooded street",
    ])
      expect(isSpecificSubject(everyday)).toBe(false);
  });
});
