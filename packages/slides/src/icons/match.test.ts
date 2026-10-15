import { describe, expect, test } from "bun:test";
import { ICON_CONCEPTS } from "./catalogue";
import pilotRuns from "./fixtures/match-results.json";
import { ICON_IDS } from "./library";
import {
  buildIndex,
  ICON_LABELS,
  matchIcon,
  normalise,
  resolveIcon,
  resolveIcons,
  SCOPED_TERMS,
} from "./match";
import type { IconConcept } from "./types";

/** A subject per concept list, so scoped terms ("root", "shield") resolve in their own subject. */
const SUBJECT_OF: Record<string, string> = { plants: "Science", reasons: "History" };

describe("concepts", () => {
  test("201 concepts (122 pilot, 79 for the new layouts), each with a drawing", () => {
    expect(ICON_CONCEPTS).toHaveLength(201);
    expect([...ICON_IDS].sort()).toEqual(ICON_CONCEPTS.map((c) => c.id).sort());
  });

  test("every concept's id, label and synonyms resolve to that concept", () => {
    for (const c of ICON_CONCEPTS) {
      expect(resolveIcon(c.id)).toBe(c.id);
      const context = { subject: SUBJECT_OF[c.lesson] };
      for (const s of [c.label, ...c.synonyms]) {
        // a term two concepts share goes to the first (see "first wins" below)
        if (FIRST_WINS[normalise(s)]) continue;
        expect(`${s} -> ${matchIcon(s, undefined, context)}`).toBe(`${s} -> ${c.id}`);
      }
    }
  });
});

/** Reviewed collisions: the term -> the concept that keeps it (the earlier one in the list). */
const FIRST_WINS: Record<string, string> = {
  // papyrus (pilot Egypt) lists "scroll"; the stages set's parchment scroll keeps its id
  scroll: "papyrus",
};

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
    expect(clashes).toEqual(["scroll: papyrus,scroll", "~scroll: papyrus,scroll"]);
  });

  test("first wins: a term two concepts share goes to the one listed first", () => {
    const list: IconConcept[] = [
      { id: "a", label: "Alpha", synonyms: ["shared thing"], lesson: "x", keyStage: "KS2" },
      { id: "b", label: "Beta", synonyms: ["shared thing"], lesson: "x", keyStage: "KS2" },
    ];
    expect(matchIcon("Shared thing", buildIndex(list))).toBe("a");
    expect(matchIcon("Shared things", buildIndex(list))).toBe("a");
    expect(matchIcon("Shared thing", buildIndex([...list].reverse()))).toBe("b");
    // the real collision: the label goes to the first concept, the exact id still to its own
    for (const [term, id] of Object.entries(FIRST_WINS)) expect(matchIcon(term)).toBe(id);
    expect(resolveIcon("scroll")).toBe("scroll");
  });

  test("a scoped word matches only in its subject (root is a square root in maths)", () => {
    expect(Object.keys(SCOPED_TERMS).sort()).toEqual(["root", "shield"]);
    for (const label of ["Root", "Roots", "root"]) {
      expect(matchIcon(label)).toBeNull();
      expect(matchIcon(label, undefined, { subject: "Maths" })).toBeNull();
      expect(matchIcon(label, undefined, { subject: "Science" })).toBe("root");
      expect(matchIcon(label, undefined, { subject: "Year 3 plants" })).toBe("root");
    }
    expect(matchIcon("Square root", undefined, { subject: "Science" })).toBeNull();
    expect(matchIcon("Root system")).toBe("root"); // a qualified phrase is not scoped
    expect(matchIcon("Shield")).toBeNull();
    expect(matchIcon("Shield", undefined, { subject: "Geography" })).toBeNull();
    expect(matchIcon("Shield", undefined, { subject: "History" })).toBe("shield");
    expect(matchIcon("Shield volcano", undefined, { subject: "Geography" })).toBe("shield-volcano");
    // a layout that names the id has chosen the drawing already
    expect(resolveIcon("root")).toBe("root");
    expect(resolveIcons(["Roots", "Stem"], { subject: "Science" }).complete).toBe(true);
    expect(resolveIcons(["Roots", "Stem"], { subject: "Maths" }).misses).toEqual(["Roots"]);
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
      "Shield",
      "Composite",
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
    expect(matchIcon("Shield volcano")).toBe("shield-volcano");
    expect(matchIcon("Composite volcano")).toBe("composite-volcano");
    expect(resolveIcon("shield-volcano")).toBe("shield-volcano");
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
    // 34 of the pilot's 37 hits: "Support", "Shield" and "Composite" are generic, so pruned;
    // pilot slides reach those icons through an explicit key (resolveIcon takes an exact id first)
    expect(pilotRuns.filter((r) => r.id)).toHaveLength(34);
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
    expect(ICON_LABELS).toHaveLength(201);
    const sorted = [...ICON_LABELS].sort((a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" }),
    );
    expect(ICON_LABELS).toEqual(sorted);
    for (const l of ICON_LABELS)
      expect(resolveIcon(l, { subject: "Science History" }), l).not.toBeNull();
  });
});

describe("the new layouts' golds (TEACH-310 part c)", () => {
  // every icon key and noun in the v12/v13 golds' cases.js (ROOT/northstars-v12, -v13), 15 Oct
  const GOLD_NOUNS = [
    ...["afterlife", "air", "apple", "bakery", "ballot-box", "bat", "beaker", "bean", "bee"],
    ...["bird", "bird-feather", "blood-vessels", "bowl", "bread-roll", "bunsen-burner", "cake"],
    ...["canopic-jar", "cat", "circulatory-system", "coffin", "coin", "combine-harvester"],
    ...["composite-volcano", "copper oxide", "crepe", "croissant", "crown", "crystals", "dog"],
    ...["dough", "egg", "estuary", "evaporating basin", "evaporating dish", "evaporating-dish"],
    ...["exercise", "explosive-eruption", "feather", "fish", "fish-skeleton", "flame", "flour"],
    ...["flower", "fossil", "fries", "frog", "funnel", "germination", "glass rod", "glass-rod"],
    ...["growth-over-time", "hammer", "hazard", "healthy-plant", "heart", "helmet", "hen"],
    ...["horse", "ice-cream", "igneous-rock", "lava", "leaf", "leaf-food", "lemon", "light"],
    ...["lungs", "magnifying-glass", "meander", "moon-night", "mountain-spring", "mouse", "mummy"],
    ...["natron", "oven", "paper towel", "pen", "penguin", "plant", "plant pot", "portcullis"],
    ...["rabbit", "roast-chicken", "rock-layers", "root", "safety-goggles", "salt", "sand"],
    ...["scroll", "seed", "seedling", "shield", "shield-volcano", "ship", "soil", "spatula"],
    ...["speech-bubbles", "stem", "stomach", "subduction", "sweat-drop", "tea towel", "teacup"],
    ...["thermometer", "town-near-volcano", "tripod-gauze", "volcano", "warmth", "water"],
    ...["waterfall", "watering can", "watering-can", "wheat", "willow-tub", "wind", "windowsill"],
    ...["without-light", "without-water", "work-alone", "work-pairs", "work-group", "finish-flag"],
  ];
  // the golds' deliberate fallback cases: a key the library lacks, so the layout drops to numbers
  const DESIGNED_MISSES = [
    ...["beanstalk", "spoon", "roman-coin-hoard", "pebble", "v-shaped-valley", "oxbow-lake"],
    ...["sun", "cloud", "rain", "zz-missing", "no-such-icon", "petal-xx", "omelette-xx"],
  ];

  test("every icon the golds name resolves", () => {
    const misses = GOLD_NOUNS.filter((n) => resolveIcon(n) === null);
    expect(misses).toEqual([]);
  });

  test("the golds' fallback cases still miss, so they fall back to numbers", () => {
    expect(DESIGNED_MISSES.filter((n) => resolveIcon(n) !== null)).toEqual([]);
  });

  test("the steps practicals' nouns resolve as labels (steps-honest cases)", () => {
    for (const [label, id] of [
      ["Evaporating basin", "evaporating-dish"],
      ["Copper(II) oxide", "copper-oxide"],
      ["Stirring rod", "glass-rod"],
      ["Tripod and gauze", "tripod-gauze"],
      ["Dilute sulfuric acid", "acid"],
      ["Bread rolls", "bread-roll"],
      ["Safety goggles", "safety-goggles"],
      ["In pairs", "work-pairs"],
      ["Crêpes", "crepe"],
      ["Ice cream", "ice-cream"],
    ] as const) {
      expect(`${label} -> ${matchIcon(label)}`).toBe(`${label} -> ${id}`);
    }
  });
});
