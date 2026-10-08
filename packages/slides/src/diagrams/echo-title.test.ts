import { describe, expect, it } from "bun:test";
import { titleAddsInformation, withoutEchoTitle } from ".";

/* lab/cand: a diagram's own title that only repeats what the slide already says is dropped. */
const chick = {
  kind: "flow",
  alt: "A chick grows into a hen.",
  layout: "chain",
  title: "From chick to hen",
  steps: [
    { label: "Small, fluffy chick", arrow: "Grows" },
    { label: "Bigger, feathered young chicken", arrow: "Grows" },
    { label: "Adult hen" },
  ],
};

describe("a diagram title that echoes the slide", () => {
  it("drops 'From chick to hen' under 'A chick grows' (every word is on the slide)", () => {
    const onSlide = ["A chick grows", "A chick starts small, with soft fluff."];
    expect(titleAddsInformation(chick, onSlide)).toBe(false);
    const out = withoutEchoTitle(chick, onSlide) as typeof chick;
    expect(out.title).toBeUndefined();
    expect(out.steps).toEqual(chick.steps);
    expect(chick.title).toBe("From chick to hen");
  });

  it("drops a title that restates the heading in other inflections", () => {
    const s = { ...chick, title: "How chicks grow" };
    expect(titleAddsInformation(s, ["A chick grows"])).toBe(false);
  });

  it("keeps a title that names something the slide does not say", () => {
    const s = { ...chick, title: "Life cycle of a chicken" };
    expect(titleAddsInformation(s, ["A chick grows"])).toBe(true);
    expect((withoutEchoTitle(s, ["A chick grows"]) as typeof s).title).toBe(
      "Life cycle of a chicken",
    );
  });

  it("leaves a spec without a title, or with no heading to echo, as it is", () => {
    const { title: _t, ...bare } = chick;
    expect(withoutEchoTitle(bare, ["A chick grows"])).toBe(bare);
    expect(withoutEchoTitle(chick, [])).toBe(chick);
  });
});
