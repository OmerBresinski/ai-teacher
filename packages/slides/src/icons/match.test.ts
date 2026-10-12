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

describe("no ambiguity", () => {
  const fold = (t: string) =>
    t
      .split(" ")
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
      .join(" ");

  test("no label, id or synonym maps to two concepts, exactly or after the plural fold", () => {
    const owners = new Map<string, Set<string>>();
    for (const c of ICON_CONCEPTS) {
      for (const s of [c.label, c.id.replace(/-/g, " "), ...c.synonyms]) {
        for (const key of new Set([normalise(s), `~${fold(normalise(s))}`])) {
          const set = owners.get(key) ?? new Set<string>();
          set.add(c.id);
          owners.set(key, set);
        }
      }
    }
    const clashes = [...owners]
      .filter(([, ids]) => ids.size > 1)
      .map(([k, ids]) => `${k}: ${[...ids]}`);
    expect(clashes).toEqual([]);
  });

  test("generic words from other subjects' lessons never draw a pilot icon", () => {
    for (const label of [
      "Smoke",
      "Earth",
      "Pressure",
      "Time",
      "The Sun",
      "Support",
      "Core",
      "Mountains",
      "Results",
      "Damage",
      "Risk",
      "Space",
      "Room",
      "Queen",
      "Priest",
      "Cells",
      "Running",
      "Mask",
      "Gas",
      "Chamber",
      "Plates",
      "Layers",
      "Brain",
      "King",
      "Window",
      "Island",
      "Writing",
    ]) {
      expect(`${label} -> ${resolveIcon(label)}`).toBe(`${label} -> null`);
    }
  });

  test("the qualified phrase still finds the concept", () => {
    expect(matchIcon("Blood pressure")).toBe("blood-pressure");
    expect(matchIcon("Cigarettes")).toBe("smoking");
    expect(matchIcon("Magma chamber")).toBe("magma-chamber");
    expect(matchIcon("Heart chambers")).toBe("heart-chambers");
    expect(matchIcon("Volcanic gas")).toBe("volcanic-gas");
    expect(matchIcon("Intestine")).toBe("intestines"); // once also digestion's synonym
  });
});

describe("plural folding", () => {
  test("a trailing s folds on each word, both ways; ss and short words do not", () => {
    expect(matchIcon("Seedlings")).toBe("seedling");
    expect(matchIcon("Blood vessel")).toBe("blood-vessels");
    expect(matchIcon("Canopic jars")).toBe("canopic-jar");
    expect(matchIcon("Earthquakes")).toBe("earthquake");
    expect(matchIcon("Mummies")).toBe("mummy"); // irregular: a synonym, not the fold
    expect(matchIcon("Glass")).toBeNull(); // "ss" is never folded to "glas"
    expect(matchIcon("Gas")).toBeNull(); // too short to fold, and pruned
  });
});

describe("matchIcon", () => {
  test("gives the pilot matcher's result on every item name in the pilot lessons' runs", () => {
    expect(pilotRuns).toHaveLength(46);
    for (const row of pilotRuns) {
      expect(`${row.label} -> ${matchIcon(row.label)}`).toBe(`${row.label} -> ${row.id}`);
    }
    // 36 of the pilot's 37 hits: "Support" no longer matches healthy-heart (generic, pruned)
    expect(pilotRuns.filter((r) => r.id)).toHaveLength(36);
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
