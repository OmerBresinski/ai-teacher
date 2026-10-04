import { describe, expect, test } from "bun:test";
import { composeMisconception, normaliseBelief } from "./misconception";
import { wordShare } from "./text-overlap";

/* TEACH-87, UX ruling 149 (revised): "{belief in the pupil's words}" In fact, {correction}. */

describe("composeMisconception", () => {
  test("Weimar: the pupil's words quoted, then the correction", () => {
    expect(
      composeMisconception(
        "Printing more money makes everyone richer.",
        "There are no more goods to buy, so prices just rise.",
      ),
    ).toBe('"Printing more money makes everyone richer." In fact, there are no more goods to buy, so prices just rise.');
  });

  test("photosynthesis glucose and chlorophyll", () => {
    expect(composeMisconception("Plants store their extra glucose as glucose.", "They change it into starch first.")).toBe(
      '"Plants store their extra glucose as glucose." In fact, they change it into starch first.',
    );
    expect(composeMisconception("Plants get their food from the soil.", "Chlorophyll traps light to make glucose.")).toBe(
      '"Plants get their food from the soil." In fact, chlorophyll traps light to make glucose.',
    );
  });

  test("particles", () => {
    expect(composeMisconception("Particles expand when they are heated.", "Particles stay the same size; they spread further apart.")).toBe(
      '"Particles expand when they are heated." In fact, particles stay the same size; they spread further apart.',
    );
  });

  test("a name in the correction keeps its capital", () => {
    expect(composeMisconception("Printing money made Germany rich.", "Germany's money lost its value.")).toBe(
      '"Printing money made Germany rich." In fact, Germany\'s money lost its value.',
    );
  });

  test("older facts are normalised: clause, leading that, quotes, no full stop", () => {
    expect(normaliseBelief("that particles expand when heated")).toBe("Particles expand when heated.");
    expect(normaliseBelief("Thinking that the Sun goes round the Earth")).toBe("The Sun goes round the Earth.");
    expect(normaliseBelief('"Heavier things fall faster."')).toBe("Heavier things fall faster.");
    expect(normaliseBelief("Is light a product?")).toBe("Is light a product?");
  });

  test("never a quoted belief without its correction, and never without a belief", () => {
    expect(composeMisconception("Particles expand when heated.", "")).toBeUndefined();
    expect(composeMisconception(undefined, "True thing.")).toBeUndefined();
    expect(composeMisconception(" . ", "True thing.")).toBeUndefined();
  });

  test("past the card's limit: no card, never a shortened text", () => {
    const long = "Particles stay exactly the same size and shape; when heated they gain energy, move faster and spread further apart.";
    expect(composeMisconception("Particles expand when heated.", long, { limit: 120 })).toBeUndefined();
  });
});

describe("wordShare", () => {
  test("shared content words over the first text's", () => {
    expect(wordShare("Printing money pushed prices up", "Printing more money made prices rise")).toBe(0.75);
    expect(wordShare("In 1923 the Ruhr was occupied", "Printing money pushed prices up")).toBe(0);
  });
});
