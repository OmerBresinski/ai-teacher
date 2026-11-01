import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides";
import {
  borrowCheckVisuals,
  checkSlotKey,
  fitsWithVisual,
  hasVisual,
  leakOf,
  letteredSpec,
  NEUTRAL_ALT,
  safeForm,
} from "./check-pictures";
import { type MaterialiseCtx, materialise, type VisualState } from "./materialise";

/*
 * TEACH-247 part cj: a check slide with no visual shows the visual its objective was taught with;
 * an answer the visual's text gives is kept back (letters, a neutral alt) or the visual is not
 * reused; a visual the words do not fit beside is not placed; every skip is reported. The slides
 * are the saved writer outputs of Great Fire C (20261101-111542-replay-ab6-greatfire-C) and the
 * plants and rivers runs in TEXT-ONLY-DIAG.md.
 */
type S = Record<string, unknown>;

const photo = (alt: string, aspect = 4 / 3): VisualState => ({
  status: "photo",
  photo: { src: "/files/x/images/p.jpg", alt, aspect, request: alt } as never,
});

const buckets: S = {
  template: "visual-text",
  heading: "Passing water",
  figure: {
    shows: "Reconstruction of Londoners passing buckets of water towards a fire in 1666",
    must_see: ["people passing buckets", "water buckets", "burning house"],
    subject: "generic",
  },
};
const pulling: S = {
  template: "visual-text",
  heading: "Pulling houses down",
  figure: {
    shows: "Reconstruction of Londoners pulling down a wooden house during the Great Fire",
    must_see: ["people pulling ropes", "partly demolished house", "gap between houses"],
    subject: "generic",
  },
};
const practice: S = {
  template: "practice",
  heading: "Fighting the fire",
  picture: null,
  items: [
    {
      question: "A house is burning. How could people pass water to the fire?",
      answer: "They could pass buckets of water to one another.",
      working: null,
    },
    {
      question: "Why might buckets be passed along a line?",
      answer: "It moves water quickly.",
      working: null,
    },
  ],
};
const hinge: S = {
  template: "hinge",
  heading: "Which part of the plant makes seeds?",
  correct: 1,
  options: [
    { text: "The flower", icon: null, why: null },
    { text: "The root", icon: null, why: "Thinks roots grow plants" },
    { text: "The leaf", icon: null, why: "Thinks leaves make everything" },
  ],
};
const exit: S = {
  template: "exit-ticket",
  heading: "Fighting the fire",
  items: [
    {
      question: "How did people pass water to a fire?",
      answer: "In buckets along a line.",
      working: null,
    },
  ],
};

const brief = { keyStage: "ks2", topic: "The Great Fire of London", subject: "history" } as never;
const ctxOf = (i: number, visual: (k: string) => VisualState, stage = "ks2"): MaterialiseCtx => ({
  brief,
  theme: getTheme("splash", stage as never),
  stage: stage as never,
  index: i,
  plan: { slides: [] },
  visual,
});
const failed = (): VisualState => ({ status: "failed" });

/** The stage's own wiring: fits at the drawn size with the borrowed state under its key. */
const fitsAt =
  (slides: (S | undefined)[], stage = "ks2") =>
  (i: number, next: S, key: string, st: VisualState) =>
    fitsWithVisual(slides[i] as S, next, ctxOf(i, failed, stage), key, st);

describe("borrowCheckVisuals", () => {
  test("a practice slide takes the teaching photo that shares its words, under `picture`", () => {
    const slides = [undefined, undefined, buckets, pulling, practice];
    const states: Record<number, VisualState> = {
      2: photo("Londoners passing buckets of water to a fire"),
      3: photo("Londoners pulling a house down"),
    };
    const r = borrowCheckVisuals({
      slides,
      teaches: (i) => (i === 4 ? [2, 3] : [3]),
      state: (i) => (k) => (k === "picture" && states[i] ? states[i] : failed()),
      fits: fitsAt(slides),
    });
    expect(r.skips).toEqual([]);
    expect(r.routes).toHaveLength(1);
    const route = r.routes[0];
    expect(route?.slide).toBe(4);
    expect(route?.from).toBe(2);
    expect(route?.key).toBe("picture");
    expect(route?.form).toBe("as-is");
    expect((route?.json.picture as S | undefined)?.shows).toBe((buckets.figure as S).shows);
    // The writer's words are untouched.
    expect(route?.json.items).toEqual(practice.items);
  });

  test("a teaching slide on another objective, or whose picture failed, is no source", () => {
    const slides = [undefined, undefined, buckets, practice];
    const r = borrowCheckVisuals({
      slides,
      teaches: (i) => (i === 3 ? [1] : [3]),
      state: () => () => photo("buckets"),
      fits: () => true,
    });
    expect(r.routes).toEqual([]);
    expect(r.skips).toEqual([
      expect.objectContaining({ slide: 3, template: "practice", reason: "no-source" }),
    ]);
    const lost = borrowCheckVisuals({
      slides,
      teaches: () => [3],
      state: () => failed,
      fits: () => true,
    });
    expect(lost.skips[0]?.reason).toBe("no-source");
  });

  test("a slide that already has a visual, or is not a check, is left alone", () => {
    const own = { ...practice, picture: { shows: "a bucket", must_see: ["bucket"] } };
    const tiles = {
      ...hinge,
      options: (hinge.options as S[]).map((o) => ({ ...o, icon: "leaf" })),
    };
    expect(hasVisual(own)).toBe(true);
    expect(hasVisual(tiles)).toBe(true);
    const r = borrowCheckVisuals({
      slides: [undefined, undefined, buckets, own, tiles, { ...buckets }],
      teaches: () => [3],
      state: () => () => photo("buckets"),
      fits: () => true,
    });
    expect(r).toEqual({ routes: [], skips: [] });
  });

  test("a visual that matches only a hinge's wrong option is not what it works from", () => {
    const pull: S = {
      template: "hinge",
      heading: "Why did they pull down some homes?",
      correct: 1,
      options: [
        { text: "To leave a gap", icon: null, why: null },
        { text: "To bring buckets of water closer", icon: null, why: "Mixes up the ways" },
      ],
    };
    const r = borrowCheckVisuals({
      slides: [undefined, undefined, buckets, pull],
      teaches: () => [3],
      state: () => () => photo("Londoners passing buckets of water"),
      fits: () => true,
    });
    expect(r.routes).toEqual([]);
    expect(r.skips[0]).toMatchObject({ slide: 3, reason: "no-source" });
  });

  test("words that do not fit beside the visual: not placed, logged as fit", () => {
    const r = borrowCheckVisuals({
      slides: [undefined, undefined, buckets, practice],
      teaches: () => [3],
      state: () => () => photo("buckets of water"),
      fits: () => false,
    });
    expect(r.routes).toEqual([]);
    expect(r.skips[0]).toMatchObject({ slide: 3, reason: "fit" });
  });

  test("hinge, quick check and exit ticket take it under `figure`", () => {
    expect(checkSlotKey("hinge")).toBe("figure");
    expect(checkSlotKey("question-set")).toBe("figure");
    expect(checkSlotKey("exit-ticket")).toBe("figure");
    const slides = [undefined, undefined, buckets, exit];
    const r = borrowCheckVisuals({
      slides,
      teaches: () => [3],
      state: (i) => (k) =>
        i === 2 && k === "picture" ? photo("Londoners with buckets") : failed(),
      fits: fitsAt(slides),
    });
    expect(r.routes[0]?.key).toBe("figure");
    // Laid with the borrowed state, the exit ticket draws the photo beside its ticket.
    const st = r.routes[0]?.state as VisualState;
    const m = materialise(
      r.routes[0]?.json as S,
      ctxOf(3, (k) => (k === "figure" ? st : failed())),
    );
    expect(m.over).toEqual([]);
    expect(m.slide.elements.some((e) => e.type === "image")).toBe(true);
  });
});

describe("the answer-leak guard", () => {
  const plantDiagram: VisualState = {
    status: "diagram",
    spec: {
      kind: "labelled",
      title: "Parts of a plant",
      alt: "A plant with its flower, stem, leaf and root labelled.",
      labels: [
        { part: "flower", text: "Flower" },
        { part: "stem", text: "Stem" },
        { part: "leaf", text: "Leaf" },
        { part: "root", text: "Root" },
      ],
    },
  };

  test("a naming question whose answer a diagram's labels show gets letters in their place", () => {
    expect(leakOf(hinge, "Flower Stem Leaf Root")).toContain("The flower");
    const safe = safeForm(hinge, plantDiagram);
    expect(safe).toMatchObject({ form: "letters" });
    const spec = (safe as { state: { spec: S } }).state.spec;
    expect((spec.labels as S[]).map((l) => l.text)).toEqual(["A", "B", "C", "D"]);
    expect(spec.title).toBeNull();
    // The parts the letters point at stay (`part` is where a label goes, never drawn).
    expect((spec.labels as S[]).map((l) => l.part)).toEqual(["flower", "stem", "leaf", "root"]);
    expect(String(spec.alt)).not.toMatch(/flower/i);
  });

  test("a photo whose alt names the answer keeps the photo with a neutral alt", () => {
    const safe = safeForm(hinge, photo("A flowering plant with its flower open"));
    expect(safe).toMatchObject({ form: "neutral-alt" });
    const st = (safe as { state: VisualState }).state;
    expect(st.status === "photo" && st.photo.alt).toBe(NEUTRAL_ALT);
  });

  test("a drawing with no labels to letter is not reused: a leak skip with its reason", () => {
    const drawn: VisualState = {
      status: "diagram",
      spec: { drawn: { src: "data:image/svg+xml,<svg><text>flower</text></svg>", alt: "" } },
    };
    expect(safeForm(hinge, drawn)).toEqual({ leak: expect.stringContaining("The flower") });
    expect(letteredSpec((drawn as { spec: unknown }).spec)).toBeUndefined();
    const plant: S = {
      template: "visual-text",
      heading: "Parts of a plant",
      figure: { kind: "model", shows: "a plant", labels: ["flower"] },
    };
    const r = borrowCheckVisuals({
      slides: [undefined, undefined, plant, hinge],
      teaches: () => [1],
      state: () => () => drawn,
      fits: () => true,
    });
    expect(r.routes).toEqual([]);
    expect(r.skips[0]).toMatchObject({ slide: 3, template: "hinge", reason: "leak" });
  });

  test("an application question is not a naming question: the picture is the context", () => {
    expect(leakOf(practice, "Londoners passing buckets of water to a fire")).toBeUndefined();
  });

  test("a recall question whose short answer the alt gives is a leak", () => {
    const qs: S = {
      template: "question-set",
      heading: "Quick check",
      items: [{ question: "Which London street did the fire start on?", answer: "Pudding Lane" }],
    };
    expect(leakOf(qs, "A bakery in Pudding Lane in 1666")).toContain("Pudding Lane");
  });
});

describe("fitsWithVisual", () => {
  test("words past the room beside the picture are refused; the same words alone pass", () => {
    const long = "AAAA house is burning near the river and the wind is blowing hard";
    const wordy: S = {
      template: "exit-ticket",
      heading: "Fighting the fire",
      items: [1, 2, 3].map(() => ({
        question: `${long}. What do you do?`,
        answer: "x",
        working: null,
      })),
    };
    const ctx = ctxOf(3, failed, "ks1");
    const next = { ...wordy, figure: { shows: "buckets", must_see: ["bucket"] } };
    expect(fitsWithVisual(wordy, next, ctx, "figure", photo("buckets"))).toBe(false);
    const short = { ...exit, figure: { shows: "buckets", must_see: ["bucket"] } };
    expect(fitsWithVisual(exit, short, ctxOf(3, failed), "figure", photo("buckets"))).toBe(true);
  });
});
