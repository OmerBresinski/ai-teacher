// TEACH-247 part by: a writer's icon is drawn only when its item's own words name it.
import { describe, expect, test } from "bun:test";
import { ICON_CONCEPTS } from "./catalogue";
import { iconFits, iconNamedBy, resolveIcon } from "./match";

describe("iconNamedBy: the Romans replay (29 Oct, slide 9)", () => {
  test("Fort and Milecastle never name the volcano; Gate never names the portcullis", () => {
    expect(iconNamedBy("volcano", "Fort\nRoman soldiers lived and worked here.")).toBe(false);
    expect(iconNamedBy("volcano", "Milecastle\nA small guarded post along the wall.")).toBe(false);
    expect(iconNamedBy("portcullis", "Gate\nSoldiers guarded this opening for crossings.")).toBe(
      false,
    );
  });

  test("fort and milecastle resolve to no drawing at all", () => {
    for (const name of ["Fort", "Forts", "Milecastle", "milecastles", "Roman fort"])
      expect(`${name} -> ${resolveIcon(name)}`).toBe(`${name} -> null`);
  });

  test("a label that draws nothing is never named", () => {
    expect(iconNamedBy("fort", "Fort")).toBe(false);
    expect(iconNamedBy(null, "Fort")).toBe(false);
  });
});

describe("iconNamedBy: every concept is named by its own label, id and synonyms", () => {
  test("label, id and each synonym", () => {
    for (const c of ICON_CONCEPTS)
      for (const t of [c.label, c.id.replace(/-/g, " "), ...c.synonyms])
        expect(`${c.id} <- ${t}: ${iconNamedBy(c.id, t)}`).toBe(`${c.id} <- ${t}: true`);
  });
});

/*
 * $0 table: typical KS1-KS3 items (name, line) and the icon a writer picks for them. The good
 * picks still draw; the wrong ones (a drawing of something the item does not name) never do.
 */
const GOOD: [name: string, line: string, icon: string][] = [
  ["Heart", "Pumps blood around the body.", "heart"],
  ["Lungs", "Take in oxygen when we breathe.", "lungs"],
  ["Arteries", "Carry blood away from the heart.", "artery"],
  ["Veins", "Carry blood back to the heart.", "vein"],
  ["Exercise", "Makes your heart beat faster.", "exercise"],
  ["Pulse", "Count the beats for one minute.", "pulse"],
  ["Seed", "A new plant starts from a seed.", "seed"],
  ["Roots", "Take in water from the soil.", "root"],
  ["Stem", "Holds the plant up.", "stem"],
  ["Leaves", "Make food using light.", "leaf"],
  ["Flower", "Makes seeds for new plants.", "flower"],
  ["Water", "Plants need water to grow.", "water"],
  ["Bees", "Carry pollen between flowers.", "bee"],
  ["Volcano", "An opening in the Earth's crust.", "volcano"],
  ["Magma", "Melted rock under the ground.", "magma"],
  ["Lava", "Magma that reaches the surface.", "lava"],
  ["Crater", "The bowl at the top of a volcano.", "crater"],
  ["Earthquakes", "The ground shakes when plates move.", "earthquake"],
  ["Tectonic plates", "Huge pieces of the crust.", "tectonic-plates"],
  ["Pyramids", "Tombs built for pharaohs.", "pyramid"],
  ["Pharaoh", "The ruler of ancient Egypt.", "pharaoh"],
  ["Mummy", "A body kept from decay.", "mummy"],
  ["Canopic jars", "Held the organs.", "canopic-jar"],
  ["Hieroglyphs", "Picture writing.", "hieroglyphs"],
  ["Fossils", "Remains of living things in rock.", "fossil"],
  ["Fossilised fish", "Bones kept in stone.", "fossil"],
  ["Taxes", "Paid for the Roman army.", "coin"],
  ["Shields", "Protected Roman soldiers.", "shield"],
  ["Work with a partner", "Share your ideas.", "work-pairs"],
  ["Safety goggles", "Protect your eyes.", "safety-goggles"],
  ["Bunsen burner", "Heats the mixture.", "bunsen-burner"],
  ["Cats", "Have fur and whiskers.", "cat"],
  ["Penguins", "Birds that cannot fly.", "penguin"],
  ["Parliament", "Debates and votes on new laws.", "portcullis"],
];

const WRONG: [name: string, line: string, icon: string][] = [
  ["Fort", "Roman soldiers lived and worked here.", "volcano"],
  ["Milecastle", "A small guarded post along the wall.", "volcano"],
  ["Castle", "A strong building with thick walls.", "volcano"],
  ["Tower", "Soldiers kept watch from here.", "shield-volcano"],
  ["Village", "People farmed the land nearby.", "pyramid"],
  ["River Thames", "Flows through London.", "river-nile"],
  ["Sun", "Gives us light and heat.", "flame"],
  ["Pencil", "Used to write.", "pen"],
  ["Rocket", "Flies into space.", "rock-layers"],
  ["Hearth", "A fireplace in the home.", "heart"],
];

describe("iconNamedBy: typical KS1-KS3 items", () => {
  test.each(GOOD)("%s (%s) draws %s", (name, line, icon) => {
    expect(resolveIcon(icon)).toBe(icon);
    expect(iconNamedBy(icon, `${name}\n${line}`, { subject: "History" })).toBe(true);
  });

  test.each(WRONG)("%s (%s) never draws %s", (name, line, icon) => {
    expect(resolveIcon(icon)).toBe(icon);
    expect(iconNamedBy(icon, `${name}\n${line}`)).toBe(false);
  });
});

describe("iconFits: the slide and the topic name a drawing of the icon's set", () => {
  const romans = [
    "Why the Romans built Hadrian's Wall",
    "Guarding structures",
    "Fort",
    "Roman soldiers lived and worked here.",
    "Milecastle",
    "A small guarded post along the wall.",
    "Gate",
    "Soldiers guarded this opening for crossings.",
  ].join("\n");
  test("Romans slide 9: neither volcano nor portcullis fits", () => {
    expect(iconFits("volcano", "Fort\nRoman soldiers lived and worked here.", romans)).toBe(false);
    expect(iconFits("volcano", "Milecastle\nA small guarded post along the wall.", romans)).toBe(
      false,
    );
    expect(iconFits("portcullis", "Gate\nSoldiers guarded this opening.", romans)).toBe(false);
  });
  test("a symbol beside its set's named drawing fits", () => {
    const sweat = "Why do we sweat?\nSweat cools us as it dries.";
    expect(iconFits("thermometer", "Our body must stay at 37 °C", sweat)).toBe(true);
    const fire = "How did a small fire burn down London?\nThe wind blows it on";
    expect(iconFits("flame", "Most of London burns", fire)).toBe(true);
    const river = "Source\nWaterfall\nMeander\nMouth";
    expect(iconFits("estuary", "Mouth\nIt widens and meets the sea.", river)).toBe(true);
  });
  test("a volcano lesson's slide lets its set's drawings fit", () => {
    expect(iconFits("magma-chamber", "Under the mountain", "Inside a volcano")).toBe(true);
  });
});
