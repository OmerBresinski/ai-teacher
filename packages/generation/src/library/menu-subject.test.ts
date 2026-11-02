import { describe, expect, test } from "bun:test";
import { catalogue, inferSubjects, type MenuFilter } from "./catalogue";

/*
 * TEACH-247 part cu (root cause M, first-principles/5): the brief form's subject is optional and
 * was blank in 63 of 63 runs, so the menu filter kept every subject and a Year 2 Great Fire lesson
 * was offered coins, clocks and shapes among 36 models. With no subject the code reads the lesson's
 * subjects from its topic and objectives (words the curriculum or a model's teaches line uses for
 * at most two subjects). It only drops a subject with no such word; weak evidence filters nothing.
 */

/** The six SET lessons as the v4.21a2 records hold them (topic, year, confirmed objectives). */
const SET = {
  greatfire: {
    topic: "The Great Fire of London",
    yearGroup: "Year 2",
    objectives: [
      "Describe how the Great Fire started in Pudding Lane in 1666.",
      "Explain why wooden houses and strong winds helped the fire spread.",
      "Describe firefighting using leather buckets, water squirts and pulling down houses.",
    ],
  },
  romans: {
    topic: "Why the Romans built Hadrian's Wall",
    yearGroup: "Year 4",
    objectives: [
      "Locate Hadrian’s Wall and identify Emperor Hadrian as the ruler who ordered it.",
      "Explain why Romans built Hadrian’s Wall to defend their frontier and control movement.",
      "Describe how Roman soldiers used forts, milecastles and gates to guard Hadrian’s Wall.",
    ],
  },
  plants: {
    topic: "Parts of a plant and what they do",
    yearGroup: "Year 1",
    objectives: [
      "Identify and name roots, stems, leaves and flowers on flowering plants.",
      "Describe what roots, stems, leaves and flowers do.",
    ],
  },
  rivers: {
    topic: "Rivers: erosion and meanders",
    yearGroup: "Year 9",
    objectives: [
      "Describe hydraulic action, abrasion, attrition and solution as processes of river erosion.",
      "Distinguish between vertical erosion, which deepens river channels, and lateral erosion, which widens them.",
      "Explain how faster outer-bend flow and slower inner-bend flow cause erosion and deposition, shaping meanders.",
    ],
  },
  photosynthesis: {
    topic: "Photosynthesis",
    yearGroup: "Year 8",
    objectives: [
      "State the word equation for photosynthesis, identifying carbon dioxide and water as reactants and glucose and oxygen as products.",
      "Explain how chlorophyll in chloroplasts absorbs the light needed for photosynthesis.",
      "Describe how plants use glucose for respiration and growth, and store it as starch.",
    ],
  },
  equations: {
    topic: "Solving two-step equations",
    yearGroup: "Year 9",
    objectives: [
      "Identify the inverse operations and their order when solving two-step equations.",
      "Solve two-step equations involving multiplication or division and addition or subtraction, including negative numbers.",
      "Check solutions to two-step equations by substituting into the original equation.",
    ],
  },
} as const;

const menu = async (
  stage: "KS1" | "KS2" | "KS3-5",
  l: { topic: string; yearGroup: string; objectives: readonly string[] },
  subject = "",
) => {
  const f: MenuFilter = {
    yearGroup: l.yearGroup,
    subject,
    topic: l.topic,
    objectives: [...l.objectives],
  };
  return (await catalogue(stage, f)).map((e) => e.id);
};
/** Today's menu for a blank subject: year filter only. */
const yearOnly = async (stage: "KS1" | "KS2" | "KS3-5", yearGroup: string) =>
  (await catalogue(stage, { yearGroup, subject: "" })).map((e) => e.id);

describe("menu subject read from the topic and objectives when the brief has none", () => {
  test("each SET lesson's own subject is among those read", async () => {
    expect(await inferSubjects(SET.greatfire)).toContain("History");
    expect(await inferSubjects(SET.romans)).toContain("History");
    expect(await inferSubjects(SET.plants)).toContain("Science");
    expect(await inferSubjects(SET.rivers)).toContain("Geography");
    expect(await inferSubjects(SET.photosynthesis)).toContain("Science");
    expect(await inferSubjects(SET.equations)).toContain("Maths");
  });

  test("great fire y2: no coins, clocks or shapes; general models stay", async () => {
    const m = await menu("KS1", SET.greatfire);
    for (const id of ["coins_money", "clock_time", "shape_2d", "number_bonds", "fractions"])
      expect(m).not.toContain(id);
    for (const id of ["timeline", "data_chart", "sort_venn_carroll", "cycle_wheel"])
      expect(m).toContain(id);
    expect(m.length).toBeLessThan((await yearOnly("KS1", "Year 2")).length);
  });

  test("every SET lesson keeps the model it needs", async () => {
    expect(await menu("KS2", SET.romans)).toContain("hist_map");
    expect(await menu("KS1", SET.plants)).toContain("plant_growth");
    const rivers = await menu("KS3-5", SET.rivers);
    expect(rivers).toContain("rivers_coasts");
    expect(rivers).toContain("erosion_processes");
    expect(await menu("KS3-5", SET.photosynthesis)).toContain("leaf_section");
    expect(await menu("KS3-5", SET.equations)).toContain("balance_equations");
  });

  test("plants y1 is narrowed to science and general models", async () => {
    const m = await menu("KS1", SET.plants);
    expect(m).not.toContain("coins_money");
    expect(m).not.toContain("clock_time");
    expect(m.length).toBeLessThan((await yearOnly("KS1", "Year 1")).length);
  });

  test("weak evidence filters nothing: one telling word is not a subject", async () => {
    const volcanoes = {
      topic: "Volcanoes",
      yearGroup: "Year 5",
      objectives: ["Explain how volcanoes form."],
    };
    expect(await inferSubjects(volcanoes)).toBeUndefined();
    expect(await menu("KS2", volcanoes)).toEqual(
      (
        await catalogue("KS2", {
          yearGroup: "Year 5",
          subject: "",
          objectives: [...volcanoes.objectives],
        })
      ).map((e) => e.id),
    );
    expect(await inferSubjects({ topic: "", yearGroup: "Year 5", objectives: [] })).toBeUndefined();
  });

  test("a cross-curricular lesson keeps both subjects", async () => {
    const coasts = {
      topic: "Coasts",
      yearGroup: "Year 8",
      objectives: ["Explain how waves erode cliffs to form caves, arches and stacks."],
    };
    const s = await inferSubjects(coasts);
    expect(s).toContain("Geography");
    expect(s).toContain("Science");
  });

  test("never English or languages, which no model carries", async () => {
    const s = await inferSubjects({
      topic: "Persuasive letters",
      yearGroup: "Year 5",
      objectives: ["Use persuasive devices and rhetorical questions in a letter."],
    });
    expect(s ?? []).not.toContain("English");
    expect(s ?? []).not.toContain("Languages");
  });

  test("the teacher's subject wins over the words", async () => {
    const m = await menu("KS1", SET.greatfire, "Maths");
    expect(m).toContain("coins_money");
    expect(m).not.toContain("plant_growth");
  });
});
