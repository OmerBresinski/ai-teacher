import { describe, expect, test } from "bun:test";
import { declaredPicture, figureBriefFor, photoBriefFor, searchSubject } from "./outline-pictures";

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

describe("declaredPicture (plan-teach-objective v5)", () => {
  const energy = {
    ...idea("An exothermic reaction releases energy to the surroundings."),
    picture: {
      kind: "diagram" as const,
      template: "energy-profile" as const,
      shows: "the energy change",
    },
  };

  test("a template that fits the subject and the idea is kept", () => {
    expect(declaredPicture(energy, "Chemistry")).toEqual({
      kind: "diagram",
      brief: { template: "energy-profile", purpose: "the energy change" },
    });
  });

  test("a template in the wrong subject or on the wrong idea is none", () => {
    expect(declaredPicture(energy, "History")?.kind).toBe("none");
    const weimar = {
      ...idea("Hyperinflation in 1923 destroyed savings in Weimar Germany."),
      picture: {
        kind: "diagram" as const,
        template: "energy-profile" as const,
        shows: "prices rising",
      },
    };
    expect(declaredPicture(weimar)?.kind).toBe("none");
  });

  test("a photo is clipped to the domain caps; none stays none; nothing declared is undefined", () => {
    const long = "x".repeat(80);
    const photo = declaredPicture({
      ...idea("A Roman fort."),
      picture: { kind: "photo", subject: long, notice: ["a", "b", "c", "d"] },
    });
    expect(photo?.kind === "photo" && photo.brief.subject.length).toBe(60);
    expect(declaredPicture({ ...idea("Grammar."), picture: { kind: "none" } })?.kind).toBe("none");
    expect(declaredPicture(idea("Grammar."))).toBeUndefined();
  });
});

describe("searchSubject", () => {
  test("a described scene becomes its head noun phrase", () => {
    expect(searchSubject("A duckling beside an adult duck")).toBe("duckling");
    expect(searchSubject("Photograph of Philipp Scheidemann proclaiming the republic")).toBe(
      "Philipp Scheidemann",
    );
    expect(
      searchSubject("A photograph of a German unemployment queue during the Great Depression"),
    ).toBe("German unemployment queue");
    expect(searchSubject("Photos showing a tadpole, a froglet and an adult frog")).toBe("tadpole");
    expect(searchSubject("oak leaf")).toBe("oak leaf");
  });
});
