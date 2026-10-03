import { describe, expect, test } from "bun:test";
import { figureBriefFor, photoBriefFor } from "./outline-pictures";

const idea = (statement: string, example = "", explanation = "") => ({
  statement,
  explanation,
  example,
});

describe("photoBriefFor (TEACH-163)", () => {
  test("a concrete subject with its visible features", () => {
    expect(
      photoBriefFor(
        idea("Young animals look like their parents.", "A puppy has fur, four legs and a tail."),
      ),
    ).toEqual({ subject: "puppy", mustShow: ["fur", "four legs", "tail"], purpose: "observe" });
  });

  test("no visible features named: no photograph", () => {
    expect(photoBriefFor(idea("The river flows downhill to the sea."))).toBeUndefined();
  });

  test("things too small or invisible for a camera get no photograph", () => {
    expect(
      photoBriefFor(idea("An electron has a negative charge and a tiny mass.")),
    ).toBeUndefined();
    expect(
      photoBriefFor(idea("The power supply has a positive and a negative terminal.")),
    ).toBeUndefined();
  });

  test("abstract subjects get no photograph", () => {
    expect(photoBriefFor(idea("A sentence has a verb and a subject."))).toBeUndefined();
    expect(photoBriefFor(idea("The writer uses a rhetorical question."))).toBeUndefined();
    expect(
      photoBriefFor(idea("Electrolysis splits a compound using electricity.")),
    ).toBeUndefined();
  });
});

describe("figureBriefFor (TEACH-163)", () => {
  test("a shipped template's structure", () => {
    expect(figureBriefFor(idea("Pythagoras' theorem finds the hypotenuse."))?.template).toBe(
      "right-triangle",
    );
    expect(figureBriefFor(idea("An exothermic reaction releases energy."))?.template).toBe(
      "energy-profile",
    );
  });

  test("nothing a template draws: no figure", () => {
    expect(
      figureBriefFor(idea("Ions move to the electrodes during electrolysis.")),
    ).toBeUndefined();
  });
});
