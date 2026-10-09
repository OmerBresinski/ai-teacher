import { describe, expect, test } from "bun:test";
import { slideStates } from "./slide-states";

describe("slide states put back on restore (#423 review)", () => {
  test("an override set after the swap is cleared when the slide is restored", () => {
    const override = new Map<string, string>([["2:diagram", "failed"]]);
    const drawn = new Map<string, string>([["3:diagram", "spec"]]);
    const states = slideStates([override, drawn]);
    const original = { heading: "Find the pairs", picture: { shows: "a cow" } };
    states.save(3, original);
    // orphan6 drops the picture of the rewrite; the rewrite is worse and is undone.
    override.set("3:picture", "failed");
    drawn.delete("3:diagram");
    states.put(3, original);
    expect([...override]).toEqual([["2:diagram", "failed"]]);
    expect([...drawn]).toEqual([["3:diagram", "spec"]]);
  });

  test("an override set before the slide was swapped out stays", () => {
    const override = new Map<string, string>([["3:diagram", "failed"]]);
    const states = slideStates([override]);
    const s = { heading: "h" };
    states.save(3, s);
    override.set("3:picture", "failed");
    states.put(3, s);
    expect([...override]).toEqual([["3:diagram", "failed"]]);
  });

  test("a slide never saved changes nothing", () => {
    const override = new Map<string, string>([["3:picture", "failed"]]);
    slideStates([override]).put(3, { heading: "h" });
    expect(override.size).toBe(1);
  });
});
