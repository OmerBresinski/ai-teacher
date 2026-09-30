import { describe, expect, test } from "bun:test";
import { bookendsOf, scopeToSlides } from "./objectives";

describe("r6 scope follows the slide budget", () => {
  test("objectives past the cap are cut, not crammed in", () => {
    const s = scopeToSlides(["a", "b", "c", "d"], undefined, 10, false);
    expect(s.objectives).toEqual(["a", "b", "c"]);
    expect(s.cut).toEqual(["d"]);
    expect(s.bookends).toBeUndefined();
  });

  test("an opening or closing asked for lowers the cap and is kept", () => {
    const s = scopeToSlides(
      ["a", "b", "c"],
      { opening: { kind: "hook" }, closing: { kind: "debate" } },
      10,
      false,
    );
    expect(s.objectives).toEqual(["a", "b"]);
    expect(s.cut).toEqual(["c"]);
    expect(s.bookends).toEqual({ opening: { kind: "hook" }, closing: { kind: "debate" } });
  });

  test("a retrieval opening with no retrieval questions is dropped; a tiny deck drops bookends", () => {
    const s = scopeToSlides(["a"], { opening: { kind: "retrieval" } }, 10, false);
    expect(s.bookends).toBeUndefined();
    expect(s.dropped).toEqual(["opening (no retrieval questions)"]);
    const tiny = scopeToSlides(["a", "b"], { closing: { kind: "plenary" } }, 4, true);
    expect(tiny.objectives).toEqual(["a"]);
    expect(tiny.bookends).toBeUndefined();
    expect(tiny.dropped).toEqual(["closing"]);
  });

  test("bookends read from the call's output; junk is ignored", () => {
    expect(bookendsOf({ opening: { kind: "hook", prompt: "Why?" } })).toEqual({
      opening: { kind: "hook", prompt: "Why?" },
    });
    expect(bookendsOf({ closing: { kind: "nap" } })).toBeUndefined();
    expect(bookendsOf({})).toBeUndefined();
  });
});
