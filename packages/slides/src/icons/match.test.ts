import { describe, expect, test } from "bun:test";
import { ICON_CONCEPTS } from "./concepts";
import pilotRuns from "./fixtures/match-results.json";
import { ICON_IDS } from "./library";
import { ICON_LABELS, matchIcon, normalise, resolveIcon, resolveIcons } from "./match";

describe("concepts", () => {
  test("122 concepts, each with a drawing", () => {
    expect(ICON_CONCEPTS).toHaveLength(122);
    expect([...ICON_IDS].sort()).toEqual(ICON_CONCEPTS.map((c) => c.id).sort());
  });

  test("every concept's id, label and synonyms resolve to that concept", () => {
    for (const c of ICON_CONCEPTS) {
      expect(resolveIcon(c.id)).toBe(c.id);
      for (const s of [c.label, ...c.synonyms])
        expect(`${s} -> ${matchIcon(s)}`).toBe(`${s} -> ${c.id}`);
    }
  });
});

describe("matchIcon", () => {
  test("gives the pilot matcher's result on every item name in the pilot lessons' runs", () => {
    expect(pilotRuns).toHaveLength(46);
    for (const row of pilotRuns) {
      expect(`${row.label} -> ${matchIcon(row.label)}`).toBe(`${row.label} -> ${row.id}`);
    }
    expect(pilotRuns.filter((r) => r.id)).toHaveLength(37);
  });

  test("folds a trailing plural and needs a synonym for an irregular one", () => {
    expect(matchIcon("Lungs")).toBe("lungs");
    expect(matchIcon("lung")).toBe("lungs");
    expect(matchIcon("Canopic jars")).toBe("canopic-jar");
    expect(matchIcon("Arteries")).toBe("artery");
  });

  test("normalises case, articles, punctuation and a 'Name: description' tail", () => {
    expect(normalise("The Heart: it pumps")).toBe("heart");
    expect(normalise("Sun & rain")).toBe("sun and rain");
    expect(normalise("  Pharaoh's   tomb! ")).toBe("pharaohs tomb");
    expect(matchIcon("Lungs: oxygen enters blood")).toBe("lungs");
  });

  test("never guesses: unknown, partial and empty labels miss", () => {
    for (const miss of [
      "kitten",
      "lamb",
      "chick",
      "",
      "Watch out",
      "photosynthesis in algae",
      "heart attack",
      "plates of food",
      "volcanoes on Mars",
    ]) {
      expect(`${miss} -> ${matchIcon(miss)}`).toBe(`${miss} -> null`);
    }
    expect(matchIcon(null)).toBeNull();
    expect(matchIcon(undefined)).toBeNull();
  });
});

describe("resolveIcon", () => {
  test("takes an exact library id first, then a label or synonym", () => {
    expect(resolveIcon("canopic-jar")).toBe("canopic-jar");
    expect(resolveIcon("Canopic jar")).toBe("canopic-jar");
    expect(resolveIcon("blood vessels")).toBe("blood-vessels");
    expect(resolveIcon("kitten")).toBeNull();
  });
});

describe("resolveIcons (misses are reported, never drawn)", () => {
  test("lists every miss once, in order, and says whether the set is complete", () => {
    const r = resolveIcons(["Heart", "kitten", "lamb", "kitten", "Lungs"]);
    expect(r.ids).toEqual(["heart", null, null, null, "lungs"]);
    expect(r.misses).toEqual(["kitten", "lamb"]);
    expect(r.complete).toBe(false);
    const ok = resolveIcons(["Magma", "Lava"]);
    expect(ok).toEqual({ ids: ["magma", "lava"], misses: [], complete: true });
  });
});

describe("ICON_LABELS", () => {
  test("one label per concept, sorted for a picker, each resolving", () => {
    expect(ICON_LABELS).toHaveLength(122);
    const sorted = [...ICON_LABELS].sort((a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" }),
    );
    expect(ICON_LABELS).toEqual(sorted);
    for (const l of ICON_LABELS) expect(resolveIcon(l)).not.toBeNull();
  });
});
