import { describe, expect, test } from "bun:test";
import { LOOK_CHECK_VERSION, lookCheckPrompt } from "../prompts/look-check";
import {
  type LookFlag,
  type LookIO,
  type LookLog,
  type LookSlide,
  lookAction,
  lookCheckSchema,
  lookFailure,
  onScreenFields,
  parseLookFlags,
  photoQuery,
  runLookCheck,
} from "./look-check";

const flag = (o: Partial<LookFlag> = {}): LookFlag => ({
  slideId: "s5",
  slide: 5,
  fault: "question",
  target: "stem",
  seen: "the stem asks 'what is it called?'",
  confidence: "high",
  fix: "ask what a candle's wax becomes when it melts",
  ...o,
});
const hinge: LookSlide = {
  index: 4,
  slideId: "s5",
  form: "hinge",
  fields: ["heading", "stem", "options", "explanation"],
  hasPhoto: false,
  itemFields: ["stem", "options", "explanation", "notes"],
};

describe("look-check prompt", () => {
  test("version and user turn carry the slide, year and objectives", () => {
    expect(LOOK_CHECK_VERSION).toBe("look-check.v2");
    const p = lookCheckPrompt({
      yearGroup: "Year 3",
      subject: "Science",
      topic: "Light and shadow",
      objectives: ["Explain how a shadow forms"],
      slide: 4,
      of: 10,
      kind: "worked-example",
      fields: { heading: "Making a shadow" },
    });
    expect(p.user).toContain("Year 3 Science. Topic: Light and shadow");
    expect(p.user).toContain("- Explain how a shadow forms");
    expect(p.user).toContain("slide 4 of 10, kind worked-example");
    expect(p.user).toContain('"heading":"Making a shadow"');
    expect(p.system).toContain("First write `looked`");
    for (const f of [
      "picture:",
      "question:",
      "options:",
      "examples:",
      "role:",
      "readability:",
      "pitch:",
    ])
      expect(p.system).toContain(`- ${f}`);
  });
});

describe("onScreenFields", () => {
  test("drops notes, picture briefs, diagram specs and empty fields", () => {
    expect(
      onScreenFields({
        heading: "H",
        body: ["a"],
        notes: "n",
        imageBrief: { subject: "x" },
        diagram: {},
        caption: "",
      }),
    ).toEqual({ heading: "H", body: ["a"] });
  });
});

const FAULTS = ["picture", "question", "options", "examples", "role", "readability", "pitch"];
const no = { seen: "looked", answer: "no", target: "picture", confidence: "medium", fix: "" };
const checklist = (yes: Record<string, Partial<typeof no>> = {}) => ({
  looked: "a diagram and two lines",
  checks: Object.fromEntries(FAULTS.map((f) => [f, { ...no, ...(yes[f] ?? {}) }])),
});

describe("lookCheckSchema", () => {
  test("a verdict per fault type; target closed to the slide's fields and picture", () => {
    const s = lookCheckSchema(["heading", "body"]);
    expect(s.safeParse(checklist()).success).toBe(true);
    expect(s.safeParse(checklist({ pitch: { answer: "yes", target: "body" } })).success).toBe(true);
    expect(s.safeParse(checklist({ pitch: { target: "stem" } })).success).toBe(false);
    expect(s.safeParse(checklist({ pitch: { confidence: "low" as "medium" } })).success).toBe(
      false,
    );
    const missing = checklist();
    delete (missing.checks as Record<string, unknown>).role;
    expect(s.safeParse(missing).success).toBe(false);
  });
});

describe("parseLookFlags", () => {
  const ctx = { number: 5, slideId: "s5", targets: ["heading", "stem", "options"] };
  test("each yes with a target and a fix is a flag, stamped with id and number, high first", () => {
    const got = parseLookFlags(
      checklist({
        pitch: { answer: "yes", target: "stem", fix: "simpler words" },
        question: { answer: "yes", target: "stem", confidence: "high", fix: "reword", seen: " s " },
        options: { answer: "yes", target: "options", confidence: "high", fix: "  " },
        readability: { answer: "n/a", target: "heading", fix: "shorter" },
        picture: { answer: "yes", target: "picture", fix: "a candle" },
      }),
      ctx,
    );
    expect(got.map((f) => `${f.fault}:${f.confidence}`)).toEqual([
      "question:high",
      "picture:medium",
      "pitch:medium",
    ]);
    expect(got[0]).toMatchObject({
      slideId: "s5",
      slide: 5,
      target: "stem",
      seen: "s",
      fix: "reword",
    });
  });
  test("a target the slide does not have is dropped, and at most four flags are kept", () => {
    const yes = (target: string) => ({ answer: "yes", target, fix: "x" });
    const got = parseLookFlags(
      checklist({
        picture: yes("picture"),
        question: yes("stem"),
        options: yes("options"),
        examples: yes("body"),
        role: yes("heading"),
        readability: yes("heading"),
      }),
      ctx,
    );
    expect(got.length).toBe(4);
    expect(got.some((f) => f.fault === "examples")).toBe(false);
  });
  test("a malformed answer is no flags, not a throw", () => {
    expect(parseLookFlags(null, ctx)).toEqual([]);
    expect(parseLookFlags({ checks: "x" }, ctx)).toEqual([]);
  });
});

describe("lookAction", () => {
  test("medium flags never act", () => {
    expect(lookAction(flag({ confidence: "medium" }), hinge).kind).toBe("none");
  });
  test("a question or options flag on a keyed item re-asks the whole item", () => {
    expect(lookAction(flag(), hinge)).toEqual({
      kind: "unit",
      fields: hinge.itemFields as string[],
    });
    expect(lookAction(flag({ fault: "options", target: "options" }), hinge).kind).toBe("unit");
  });
  test("any other fault on a field re-asks that field", () => {
    expect(lookAction(flag({ fault: "readability", target: "heading" }), hinge)).toEqual({
      kind: "field",
      field: "heading",
    });
    const teach = { ...hinge, form: "explain", itemFields: undefined, fields: ["heading", "body"] };
    expect(lookAction(flag({ fault: "role", target: "body" }), teach)).toEqual({
      kind: "field",
      field: "body",
    });
  });
  test("picture: diagram slot re-asks the drawing, photo slide swaps in code, else nothing", () => {
    const pic = flag({
      fault: "picture",
      target: "picture",
      fix: "A photo of a lit candle beside a wall.",
    });
    expect(lookAction(pic, { ...hinge, form: "diagram-slot" })).toEqual({ kind: "diagram" });
    expect(lookAction(pic, { ...hinge, form: "photo", hasPhoto: true })).toEqual({
      kind: "photo",
      query: "lit candle beside a wall",
    });
    expect(lookAction(pic, hinge).kind).toBe("none");
  });
});

describe("photoQuery and lookFailure", () => {
  test("query is the fix's first plain words", () => {
    expect(photoQuery('"close-up of a snail shell"')).toBe("close-up of a snail shell");
    expect(photoQuery("Picture showing three red apples; label them")).toBe("three red apples");
    expect(photoQuery("one two three four five six seven eight").split(" ").length).toBe(6);
  });
  test("failure names what was seen, why it is a fault and the one change", () => {
    const t = lookFailure(flag());
    expect(t).toContain("Seen on the rendered slide: the stem asks 'what is it called?'");
    expect(t).toContain("more than one defensible answer");
    expect(t).toContain("Change: ask what a candle's wax becomes when it melts.");
    expect(t).toContain("Keep everything else");
  });
});

/** A fake deck for the orchestrator: slides by index with a mutable version per slide. */
function fakeIO(o: {
  slides: LookSlide[];
  first: Record<number, LookFlag[]>;
  second?: Record<number, LookFlag[]>;
  applyOk?: boolean;
  checkThrows?: number[];
}) {
  const version = new Map<number, number>();
  const logs: LookLog[] = [];
  const rendered: number[][] = [];
  const applied: { index: number; kind: string }[] = [];
  const restored: number[] = [];
  let t = 0;
  const io: LookIO = {
    slides: () => o.slides,
    render: async (indices) => {
      rendered.push(indices);
      return new Map(indices.map((i) => [i, `data:image/png;base64,v${version.get(i) ?? 0}`]));
    },
    check: async (s, image) => {
      if (o.checkThrows?.includes(s.index)) throw new Error("call failed");
      return image.endsWith("v0") ? (o.first[s.index] ?? []) : (o.second?.[s.index] ?? []);
    },
    apply: async (s, action) => {
      if (o.applyOk === false) return false;
      applied.push({ index: s.index, kind: action.kind });
      version.set(s.index, (version.get(s.index) ?? 0) + 1);
      return true;
    },
    snapshot: (i) => ({ i, v: version.get(i) ?? 0 }),
    restore: async (i, snap) => {
      restored.push(i);
      version.set(i, (snap as { v: number }).v);
    },
    log: (e) => logs.push(e),
    now: () => (t += 10),
  };
  return { io, logs, rendered, applied, restored };
}

describe("runLookCheck", () => {
  const slides: LookSlide[] = [0, 1, 2].map((i) => ({
    ...hinge,
    index: i,
    slideId: `s${i + 1}`,
    form: i === 2 ? "photo" : "hinge",
    hasPhoto: i === 2,
  }));
  const at = (i: number, o: Partial<LookFlag>) =>
    flag({ slide: i + 1, slideId: `s${i + 1}`, ...o });

  test("clean deck: one render of every slide, nothing applied, no re-check", async () => {
    const f = fakeIO({ slides, first: {} });
    const r = await runLookCheck(f.io);
    expect(f.rendered).toEqual([[0, 1, 2]]);
    expect(r).toMatchObject({ checked: 3, applied: 0, slidesFixed: 0, recheckPassed: 0 });
    expect(f.logs).toEqual([]);
  });

  test("only high flags act; touched slides alone are re-rendered and re-checked once", async () => {
    const f = fakeIO({
      slides,
      first: {
        0: [at(0, {}), at(0, { fault: "pitch", target: "heading", confidence: "medium" })],
        2: [at(2, { fault: "picture", target: "picture", fix: "a lit candle" })],
      },
      second: { 0: [], 2: [] },
    });
    const r = await runLookCheck(f.io);
    expect(f.applied).toEqual([
      { index: 0, kind: "unit" },
      { index: 2, kind: "photo" },
    ]);
    expect(f.rendered).toEqual([
      [0, 1, 2],
      [0, 2],
    ]);
    expect(r).toMatchObject({
      flagged: { high: 2, medium: 1 },
      slidesFlaggedHigh: 2,
      applied: 2,
      slidesFixed: 2,
      recheckPassed: 2,
      reverted: 0,
    });
    expect(r.byFault).toEqual({ question: 1, pitch: 1, picture: 1 });
    expect(f.logs.map((l) => `${l.pass} ${l.slide} ${l.fault} ${l.action} ${l.outcome}`)).toEqual([
      "1 1 question unit applied",
      "1 1 pitch none medium: logged only",
      "1 3 picture photo applied",
      "2 1 question none passed re-check",
      "2 3 picture none passed re-check",
    ]);
    expect(r.renderMs).toBeGreaterThan(0);
    expect(r.checkMs).toBeGreaterThan(0);
  });

  test("a fault still there on re-check is kept and counted as not passed", async () => {
    const f = fakeIO({ slides, first: { 1: [at(1, {})] }, second: { 1: [at(1, {})] } });
    const r = await runLookCheck(f.io);
    expect(r).toMatchObject({ slidesFixed: 1, recheckPassed: 0, reverted: 0 });
    expect(f.logs.at(-1)?.outcome).toBe("still flagged on re-check; change kept");
  });

  test("a change that adds high flags is reverted", async () => {
    const f = fakeIO({
      slides,
      first: { 1: [at(1, {})] },
      second: {
        1: [
          at(1, { fault: "readability", target: "heading" }),
          at(1, { fault: "role", target: "heading" }),
        ],
      },
    });
    const r = await runLookCheck(f.io);
    expect(f.restored).toEqual([1]);
    expect(r).toMatchObject({ reverted: 1, recheckPassed: 0 });
    expect(f.logs.some((l) => l.outcome.startsWith("reverted"))).toBe(true);
  });

  test("at most two actions per slide, one per target; failed re-asks are logged and not re-checked", async () => {
    const many = [
      at(0, { fault: "question", target: "stem" }),
      at(0, { fault: "options", target: "options" }),
      at(0, { fault: "readability", target: "heading" }),
      at(0, { fault: "pitch", target: "explanation" }),
    ];
    const f = fakeIO({ slides, first: { 0: many }, second: { 0: [] } });
    const r = await runLookCheck(f.io);
    expect(f.applied.length).toBe(2);
    expect(f.logs.filter((l) => l.outcome.startsWith("skipped")).length).toBe(2);
    expect(r.applied).toBe(2);

    const g = fakeIO({ slides, first: { 0: [at(0, {})] }, applyOk: false });
    const r2 = await runLookCheck(g.io);
    expect(r2).toMatchObject({ applied: 0, slidesFixed: 0 });
    expect(g.rendered.length).toBe(1);
    expect(g.logs[0]?.outcome).toContain("not applied");
  });

  test("a failed check call counts as an error and the slide is left alone", async () => {
    const f = fakeIO({ slides, first: { 0: [at(0, {})] }, checkThrows: [0] });
    const r = await runLookCheck(f.io);
    expect(r).toMatchObject({ checked: 2, checkErrors: 1, applied: 0 });
  });
});
