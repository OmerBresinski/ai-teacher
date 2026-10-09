// lostPic, seqSteps and pointGuard headings (BAKEOFF base4f), from lab/bakeoff/ab/base4f.test.ts.
import { describe, expect, test } from "bun:test";
import { fixedFallback, linkSteps } from "./fixes";
import {
  compoundSubjects,
  libraryKind,
  lostPictureFallback,
  otherVisual,
  routeLostPicture,
  splitLanded,
} from "./lost-picture";
import { stripPointTasks } from "./point-guard";

const D45 = {
  // base7c-1 y1 s7 "Find the families" and base7-1 y1 s11 (compound, 8 animals)
  families:
    "Eight separate animal photographs arranged in two rows: cow, sheep, hen and dog above puppy, chick, calf and lamb; no connecting lines or written names",
  // base7-1 y1 s5 "Watch a match"
  watch:
    "three separate animals: an adult cow on the left, a calf in the middle and a puppy on the right",
  // base7c-1 y1 s10 "Back to the hen"
  hen: "The hook scene again: a hen on the left, a yellow chick in the middle and a puppy on the right",
  // base7c-1 y2 s6 "Name the shaded part"
  shaded:
    "Three separated shapes in a left-to-right row for slide labels A, B and C: a circle split into two equal semicircles with one shaded, a square split into four equal squares with one shaded",
  // base7-1 y2 s5 "Two parts: always halves?"
  squares:
    "Two matching squares: the left divided vertically at its midpoint with one half blue, the right divided into a narrow blue strip and a much wider white part",
};

describe("seqSteps (base4-3 y12 How does information move?)", () => {
  const spec = {
    kind: "flow",
    nodes: ["Sensory register", "STM", "LTM"],
    links: [
      { from: 0, to: 1, label: "Attention" },
      { from: 1, to: 1, label: "Maintenance rehearsal" },
      { from: 1, to: 2, label: "Prolonged rehearsal" },
      { from: 2, to: 1, label: "Retrieval" },
    ],
  };
  test("labelled links become steps, not bare store names", () => {
    expect(linkSteps(spec)).toEqual([
      "Sensory register → STM: Attention",
      "STM: Maintenance rehearsal",
      "STM → LTM: Prolonged rehearsal",
      "LTM → STM: Retrieval",
    ]);
    const r = fixedFallback(
      { heading: "How does information move?" },
      { type: "diagram", kind: "flow" },
      linkSteps(spec),
      6,
    );
    expect(r.how).toBe("sequence-as-steps");
    expect((r.slide.points as string[])[0]).toContain("Attention");
  });
  test("unlabelled links give nothing (the caller keeps the slide's own points)", () => {
    expect(linkSteps({ ...spec, links: [{ from: 0, to: 1 }] })).toEqual([]);
    const r = fixedFallback(
      { template: "visual-text", heading: "h", points: [{ label: "Attention", text: "Selects." }] },
      { type: "diagram", kind: "flow" },
      [],
      6,
    );
    expect(r.how).toBe("figure-dropped");
    expect(r.slide.points).toHaveLength(1);
  });
});

describe("lostPic (D45 y1 and y2 lost pictures), stubbed picture and drawer paths", () => {
  test("compound animal requests split into one subject each", () => {
    expect(compoundSubjects(D45.families)).toEqual([
      "cow",
      "sheep",
      "hen",
      "dog",
      "puppy",
      "chick",
      "calf",
      "lamb",
    ]);
    expect(compoundSubjects(D45.watch)).toEqual(["adult cow", "calf", "puppy"]);
    expect(compoundSubjects(D45.hen)).toEqual(["hen", "yellow chick", "puppy"]);
    expect(compoundSubjects("a hen sitting on a nest")).toEqual([]);
    // D48 live, base4f-1 y1 s6 (no colon, grid positions)
    expect(
      compoundSubjects(
        "Four separate animal photographs, with a puppy top left, hen top right, dog bottom left and chick bottom right",
      ),
    ).toEqual(["puppy", "hen", "dog", "chick"]);
  });
  test("shapes go to the library, never split into photos", () => {
    expect(libraryKind(D45.shaded)).toBe("fraction-shapes");
    expect(libraryKind(D45.squares)).toBe("fraction-shapes");
    expect(routeLostPicture(D45.shaded).how).toBe("library");
    expect(libraryKind(D45.families)).toBeUndefined();
    expect(routeLostPicture(D45.families).how).toBe("split");
  });
  test("order: library or split first; undefined (strip path) only when they fail", async () => {
    const s = {
      template: "picture-text",
      heading: "Name the shaded part",
      picture: { shows: D45.shaded },
    };
    const seen: string[] = [];
    const ok = await lostPictureFallback(s, "picture", D45.shaded, async (next, how) => {
      seen.push(how);
      expect(next.picture).toBeUndefined();
      expect((next.figure as { kind: string }).kind).toBe("fraction-shapes");
      expect(next.template).toBe("visual-text");
      return true;
    });
    expect(ok).toBe("library");
    const y1 = { heading: "Find the families", picture: { shows: D45.families } };
    const split = await lostPictureFallback(y1, "picture", D45.families, async (next) => {
      expect((next.picture as { shows: string }).shows).toBe("cow");
      expect((next.tiles as unknown[]).length).toBe(7);
      return true;
    });
    expect(split).toBe("split");
    const failed = await lostPictureFallback(y1, "picture", D45.families, async () => false);
    expect(failed).toBeUndefined();
    expect(seen).toEqual(["library"]);
  });
});

describe("lostPic after D48 live", () => {
  test("grid and row positions and an 'adults' prefix are not part of a subject", () => {
    expect(
      compoundSubjects(
        "Six separate animal photographs: cow, sheep and dog across the top; puppy, calf and lamb across the bottom, with no connecting lines",
      ),
    ).toEqual(["cow", "sheep", "dog", "puppy", "calf", "lamb"]);
    expect(
      compoundSubjects(
        "Eight separate photographs in two rows: adults cow, sheep, hen, dog above young puppy, chick, calf, lamb; no connecting lines",
      ),
    ).toEqual(["cow", "sheep", "hen", "dog", "young puppy", "chick", "calf", "lamb"]);
  });
  test("a split keeps its pictures when at least 2 and half land (p123-2 y1 s6: 5 of 8)", () => {
    expect(splitLanded(5, 8)).toBe(true);
    expect(splitLanded(2, 3)).toBe(true);
    expect(splitLanded(1, 3)).toBe(false);
    expect(splitLanded(3, 8)).toBe(false);
  });
  test("base4f-1 y1 s12: the 'Look at this farm' heading goes with the picture", () => {
    const r = stripPointTasks({
      template: "question-set",
      heading: "Look at this farm",
      questions: ["Is the lamb beside its own adult? Explain."],
      instruction: "Look carefully. Say why.",
    });
    expect(r.slide.heading).toBe("This farm");
    expect(r.slide.instruction).toBe("Say why.");
  });
});

describe("lostPic never replaces another visual (#423 review)", () => {
  const shaded = "A circle split into two equal parts with one part shaded";
  const animals = "Separate photos: a cow, a sheep and a hen";
  const tryAll = async (s: Record<string, unknown>, shows: string) => {
    const tried: string[] = [];
    const how = await lostPictureFallback(s, "picture", shows, async (_next, kind) => {
      tried.push(kind);
      return true;
    });
    return { how, tried };
  };

  test("a slide whose picture was its one visual takes the fallback", async () => {
    expect((await tryAll({ heading: "h", picture: { shows: shaded } }, shaded)).how).toBe(
      "library",
    );
    expect((await tryAll({ heading: "h", picture: { shows: animals } }, animals)).how).toBe(
      "split",
    );
  });

  test("a figure, tiles or a table on the slide blocks both the library drawing and the split", async () => {
    for (const other of [
      { figure: { kind: "table", shows: "x" } },
      { tiles: [{ shows: "a lamb" }] },
      { table: { rows: [["a", "b"]] } },
    ])
      for (const shows of [shaded, animals])
        expect(await tryAll({ heading: "h", picture: { shows }, ...other }, shows)).toEqual({
          how: undefined,
          tried: [],
        });
  });

  test("an empty tiles list or a null figure is no visual", () => {
    expect(otherVisual({ picture: {}, tiles: [], figure: null }, "picture")).toBe(false);
    expect(otherVisual({ figure: { shows: "x" } }, "figure")).toBe(false);
  });
});

describe("a several-subject picture is a set from the start (TEACH-110 part h)", () => {
  // The paid run's s8 (e2e-speed-1): generated whole, refused twice, split after editable into
  // three unrelated stock dogs.
  const dogs = {
    template: "question-set",
    heading: "Describe what changes",
    questions: ["What young animal can you see?", "How does its size change?"],
    picture: {
      shows:
        "Three golden retrievers shown left to right at the same scale: a small puppy, an older puppy and an adult dog",
      must_see: ["small puppy", "older puppy", "adult dog"],
      subject: "generic",
    },
  };
  test("split into one panel per subject, each keeping the shared subject, as one set", async () => {
    const { splitAtAsk } = await import("./lost-picture");
    const { visualsOf } = await import("./materialise");
    const { getTheme } = await import("@tj/slides/themes");
    const split = splitAtAsk(dogs);
    const asks = visualsOf(split, 7, {
      brief: { keyStage: "ks1" } as never,
      theme: getTheme("studio", "ks1"),
      stage: "ks1",
      plan: { slides: [], objectives: [] },
    } as never);
    const photos = asks.filter((a) => a.type === "photo");
    expect(photos.map((a) => a.key)).toEqual(["picture", "tile.1", "tile.2"]);
    expect(new Set(photos.map((a) => (a as { set?: string }).set))).toEqual(new Set(["split"]));
    expect(photos.every((a) => a.shows.includes("Three golden retrievers"))).toBe(true);
    expect(photos.map((a) => a.mustSee[0])).toEqual(["small puppy", "older puppy", "adult dog"]);
  });
  test("two subjects, a named subject, or another visual: unchanged", async () => {
    const { splitAtAsk } = await import("./lost-picture");
    const two = { ...dogs, picture: { ...dogs.picture, shows: "An adult cow beside a calf" } };
    expect(splitAtAsk(two)).toBe(two);
    const named = { ...dogs, picture: { ...dogs.picture, subject: "named" } };
    expect(splitAtAsk(named)).toBe(named);
    const withFigure = { ...dogs, figure: { kind: "table", shows: "x" } };
    expect(splitAtAsk(withFigure)).toBe(withFigure);
  });
});
