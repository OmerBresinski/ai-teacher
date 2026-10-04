import { describe, expect, test } from "bun:test";
import { composeMisconception, normaliseBelief, shortMisconception } from "./misconception";

/* TEACH-87, UX ruling: a COMMON MISTAKE card reads "Thinking that {belief}. In fact, {correction}." */

describe("composeMisconception", () => {
  test("photosynthesis glucose: belief then correction", () => {
    expect(
      composeMisconception(
        "plants store their extra glucose as glucose",
        "They change it into starch first.",
      ),
    ).toEqual({
      text: "Thinking that plants store their extra glucose as glucose. In fact, they change it into starch first.",
      correctionShown: true,
    });
  });

  test("photosynthesis chlorophyll", () => {
    expect(
      composeMisconception(
        "chlorophyll is food that plants eat",
        "Chlorophyll only captures light energy.",
      )?.text,
    ).toBe(
      "Thinking that chlorophyll is food that plants eat. In fact, chlorophyll only captures light energy.",
    );
  });

  test("Weimar: a name keeps its capital", () => {
    expect(
      composeMisconception(
        "printing money made Germany richer",
        "Germany's money became worthless.",
      )?.text,
    ).toBe(
      "Thinking that printing money made Germany richer. In fact, Germany's money became worthless.",
    );
  });

  test("particles", () => {
    expect(
      composeMisconception(
        "particles expand when heated",
        "Particles stay the same size; they move further apart.",
      )?.text,
    ).toBe(
      "Thinking that particles expand when heated. In fact, particles stay the same size; they move further apart.",
    );
  });

  test("older facts are normalised: leading that, capital, full stop", () => {
    expect(normaliseBelief("That particles in a solid do not move at all.")).toBe(
      "particles in a solid do not move at all",
    );
    expect(normaliseBelief("  Particles expand when heated.  ")).toBe(
      "particles expand when heated",
    );
    expect(normaliseBelief("I is a name.")).toBe("I is a name");
    expect(normaliseBelief("DNA is a protein.")).toBe("DNA is a protein");
  });

  test("a missing or empty belief gives no card, never free text", () => {
    expect(composeMisconception(undefined, "True thing.")).toBeUndefined();
    expect(composeMisconception("  . ", "True thing.")).toBeUndefined();
  });

  test("a missing correction gives the belief alone", () => {
    expect(composeMisconception("particles expand when heated", "")).toEqual({
      text: "Thinking that particles expand when heated.",
      correctionShown: false,
    });
  });

  test("fit: past the limit, the belief alone, never shortened", () => {
    const long =
      "Particles stay exactly the same size and shape; when heated they gain energy, move faster and spread further apart.";
    expect(composeMisconception("particles expand when heated", long, { limit: 120 })).toEqual({
      text: "Thinking that particles expand when heated.",
      correctionShown: false,
    });
    const belief = "x".repeat(110);
    expect(composeMisconception(belief, "Short.", { limit: 120 })).toBeUndefined();
  });

  test("de-dupe: a key idea that already says the correction leaves the belief alone", () => {
    expect(
      composeMisconception(
        "plants store their extra glucose as glucose",
        "Plants change extra glucose into starch before storing it.",
        { keyIdeas: ["Plants use glucose for energy or change it into starch for storing"] },
      ),
    ).toEqual({
      text: "Thinking that plants store their extra glucose as glucose.",
      correctionShown: false,
    });
    expect(
      composeMisconception("particles expand when heated", "Particles stay the same size.", {
        keyIdeas: ["Heating makes particles move faster"],
      })?.correctionShown,
    ).toBe(true);
  });

  test("shortMisconception: the render fallback drops only the correction", () => {
    expect(shortMisconception("Thinking that a b c. In fact, d e.")).toBe("Thinking that a b c.");
    expect(shortMisconception("Thinking that a b c.")).toBeUndefined();
    expect(shortMisconception("Some other text.")).toBeUndefined();
  });
});
