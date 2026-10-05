import { describe, expect, test } from "bun:test";
import { getTheme, materialiseSlide } from "@tj/slides";
import { fitWritten, renderWritten, type Written } from "./fit";
import {
  adapt,
  placeT3Diagram,
  simpleArm,
  TEACHER3_LESSON_VERSION,
  t3Fit,
  t3Room,
  t3Writer,
} from "./simple";
import { isPlanWriteStamp, resumeFromPlanWrite } from "./steps";

/** Every line a slide was written with, wherever it ended up (slide or notes), word for word. */
const kept = (before: string[], after: Written) => {
  const where = JSON.stringify(after);
  return before.every((line) => where.includes(line));
};

const LONG = [
  "Hyperinflation meant that prices rose so quickly that wages were spent the moment they were paid.",
  "Savers who had put money aside for years found that their savings could no longer buy a loaf of bread.",
  "Workers were paid twice a day and carried their wages home in baskets and wheelbarrows.",
  "People with debts, mortgages or loans gained, because they could pay them back with worthless marks.",
  "Farmers and businesses with goods to sell often did well, because goods kept their value.",
  "The middle classes lost the most, and many never trusted the Weimar government again.",
  "Foreign visitors with dollars or pounds could buy property and goods for almost nothing.",
];
/** Twice the lines, each still its own sentence: more than any explain layout holds. */
const LONGER = [...LONG, ...LONG.map((l) => `Again: ${l}`)];

describe("t3Fit: T3 slides through the fit ladder (lab/t3)", () => {
  test("a slide that fits is left as written", () => {
    const out = { heading: "Savers lost out", body: ["Savings became worthless."], notes: "" };
    const r = t3Fit("explain", "default", out);
    expect(r.rung).toBe("none");
    expect(r.out).toEqual(out);
    expect(r.fits).toBe(true);
  });

  test("an overflowing explain slide moves whole lines to the notes, never cut or summarised", () => {
    const out = { heading: "Who won and who lost in 1923", body: LONGER, notes: "Ask who gained." };
    expect(fitWritten("explain", "default", out).ok).toBe(false);
    const r = t3Fit("explain", "default", out);
    expect(r.fits).toBe(true);
    expect(["layout", "moved"]).toContain(r.rung);
    expect(fitWritten(r.form, r.layout, r.out).ok).toBe(true);
    expect(kept(LONGER, r.out)).toBe(true);
    for (const m of r.moved) expect(String(r.out.notes)).toContain(m);
  });

  test("an overflowing picture slide tries the no-picture form before moving lines", () => {
    const out = {
      heading: "Who won and who lost in 1923",
      body: LONGER.slice(0, 9),
      imageBrief: { subject: "German banknotes 1923", named: null, mustShow: [] },
      notes: "",
    };
    expect(fitWritten("photo", "default", out).ok).toBe(false);
    const r = t3Fit("photo", "default", out);
    expect(r.fits).toBe(true);
    expect(fitWritten(r.form, r.layout, r.out).ok).toBe(true);
    expect(kept(LONGER.slice(0, 9), r.out)).toBe(true);
    if (r.form !== "photo") expect(r.rung === "sibling" || r.rung === "moved").toBe(true);
  });

  test("a check set too long for any rung keeps every question on the slide, unfit (lab/t3 fit-fix)", () => {
    const questions = Array.from({ length: 9 }, (_, i) => ({
      question: `Explain in two sentences why group ${i + 1} gained or lost from hyperinflation in 1923, using one example.`,
      answer: `Group ${i + 1} lost because their fixed incomes bought less each day.`,
    }));
    expect(fitWritten("check-set", "default", { questions, notes: "" }).ok).toBe(false);
    const r = t3Fit("check-set", "default", { questions, notes: "" });
    expect(r.fits).toBe(false);
    expect(r.rung).toBe("unfit");
    expect(r.moved).toEqual([]);
    expect(r.out.questions).toEqual(questions);
  });
});

describe("placeT3Diagram: long labels fitted before a drawing is given up (lab/t3)", () => {
  const theme = getTheme("chalk");
  const photoSlide = () => {
    const r = renderWritten("photo", "default", {
      heading: "The crisis worsens",
      body: ["Each step made the next worse."],
      imageBrief: { subject: "crisis", named: null, mustShow: [] },
      notes: "",
    });
    return materialiseSlide(
      r.spec,
      "chalk",
      { promptVersion: "t", model: "m", at: "2026-10-05T00:00:00Z" },
      () => Math.random().toString(36).slice(2),
      r.variant,
      r.structure,
    );
  };

  test("a flow whose labels run a few characters over draws, whole", () => {
    const spec = {
      kind: "flow",
      alt: "a",
      title: "The crisis worsens",
      layout: "chain",
      steps: [
        { label: "Passive resistance reduces production", arrow: "while" },
        { label: "Government pays resisting workers", arrow: "funded by" },
        { label: "More money printing", arrow: "helps cause" },
        { label: "Mark loses value; prices soar" },
      ],
    };
    const r = placeT3Diagram(photoSlide(), spec, theme);
    expect(r.reasons).toEqual([]);
    expect(r.slide).toBeDefined();
    expect(r.stretched).toBe(true);
  });

  test("a label far past its limit is rejected with a reason for the log", () => {
    const spec = {
      kind: "timeline",
      alt: "a",
      title: "Pressure on Germany",
      events: [
        { date: "1921", text: "x".repeat(90) },
        { date: "1923", text: "Ruhr" },
        { date: "1924", text: "Dawes" },
      ],
    };
    const r = placeT3Diagram(photoSlide(), spec, theme);
    expect(r.slide).toBeUndefined();
    expect(r.reasons.join(" ")).toContain("events.0.text");
  });
});

describe("t3Room: teach plus check for every objective (lab/t3)", () => {
  test("6-slide brief, 3 objectives: 4 writable slides cannot hold 6", () => {
    expect(t3Room(3, 4)).toBe("slide count too low for 3 objectives");
  });
  test("10-slide brief, 3 objectives: room", () => {
    expect(t3Room(3, 8)).toBeUndefined();
  });
  test("exactly two slides per objective is room", () => {
    expect(t3Room(2, 4)).toBeUndefined();
  });
});

describe("T3 is the plan-write writer by default (lab/t3)", () => {
  const was = { mode: process.env.PLAN_WRITE_MODE, arm: process.env.SIMPLE_ARM };
  const restore = () => {
    for (const [k, v] of [
      ["PLAN_WRITE_MODE", was.mode],
      ["SIMPLE_ARM", was.arm],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  };

  test("no env: T3, streamed", () => {
    delete process.env.PLAN_WRITE_MODE;
    delete process.env.SIMPLE_ARM;
    expect(t3Writer()).toBe(true);
    expect(simpleArm()).toBe("T3");
    restore();
  });

  test("PLAN_WRITE_MODE=stream or plan-write still runs R3", () => {
    process.env.PLAN_WRITE_MODE = "stream";
    expect(t3Writer()).toBe(false);
    process.env.PLAN_WRITE_MODE = "plan-write";
    expect(t3Writer()).toBe(false);
    restore();
  });

  test("a T3 lesson's planned stamp is plan-write's, and resumes at the write step", () => {
    expect(isPlanWriteStamp(TEACHER3_LESSON_VERSION)).toBe(true);
    const lesson = {
      generation: { stage: "planned", promptVersions: { planned: TEACHER3_LESSON_VERSION } },
      facts: { objectives: [{ id: "o1", text: "Explain diffusion" }] },
    } as unknown as Parameters<typeof resumeFromPlanWrite>[0];
    expect(resumeFromPlanWrite(lesson)).toBe("write");
  });
});

describe("adapt: no question dropped (lab/t3 fit-fix)", () => {
  test("an open response written with three questions keeps all three, with their answers", () => {
    const questions = [
      { question: "What does a puppy grow into?", answer: "An adult dog." },
      { question: "Name one thing a puppy and an adult dog both have.", answer: "Four legs." },
      { question: "How does a mother cat care for her kittens?", answer: "She gives them milk." },
    ];
    const a = adapt({
      form: "open-response",
      heading: "Your turn",
      body: ["Work on your own."],
      items: [],
      questions,
      picture: null,
      notes: "",
    } as Parameters<typeof adapt>[0]);
    expect(a.form).toBe("check-set");
    expect(a.out.questions).toEqual(questions);
  });

  test("an open response with one question stays an open response", () => {
    const a = adapt({
      form: "open-response",
      heading: "Your turn",
      body: [],
      items: [],
      questions: [{ question: "Explain why.", answer: "Because." }],
      picture: null,
      notes: "",
    } as Parameters<typeof adapt>[0]);
    expect(a.form).toBe("open-response");
    expect(a.out.stem).toBe("Explain why.");
  });
});

describe("T3 option capacity (lab/t3 round 2)", () => {
  test("the hinge menu line carries the capacity the layout code measures", async () => {
    const { optionCapacity, t3Menu, teacher3Prompt } = await import("./simple");
    const n = optionCapacity("hinge");
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThan(80);
    expect(t3Menu()).toContain(
      `hinge: a multiple-choice question with 4 options, each up to ${n} characters`,
    );
    const p = teacher3Prompt({
      slideCount: 10,
      topic: "t",
      context: "c",
      yearGroup: "Year 9",
      subject: "history",
      objectives: ["a"],
    });
    expect(p.user).toContain(`each up to ${n} characters`);
  });
  test("a form without options has no capacity", async () => {
    const { optionCapacity } = await import("./simple");
    expect(optionCapacity("explain")).toBeUndefined();
  });
});

describe("a simple lesson is saved laid out (CANDIDATE y9 s8)", () => {
  test("it carries the current FIT_VERSION, so the editor does not re-fit it on open", async () => {
    const { laidOut } = await import("./simple");
    const { FIT_VERSION } = await import("@tj/slides");
    expect(
      laidOut({ fitVersion: 0 } as never as import("@tj/domain/documents").Lesson).fitVersion,
    ).toBe(FIT_VERSION);
  });
});
