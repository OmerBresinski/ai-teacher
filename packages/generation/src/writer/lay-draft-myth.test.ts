import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft } from "./lay-draft";
import { materialise } from "./materialise";

/*
 * TEACH-75 part ag (G1), common acceptance row 7: a myth and fact slide streamed prefix by prefix.
 * A draft shows the slide's first click (the vote card: the claim and its chips), as every draft
 * leaves reveals for the closed slide. Every id a draft shows is kept by every later draft and by
 * the whole slide, so nothing vanishes or remounts while the claim streams in.
 */
type S = Record<string, unknown>;
type El = { id: string; name?: string; children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);

const brief = {
  id: "t",
  topic: "t",
  subject: "science",
  yearGroup: "Year 6",
  year: 6,
  keyStage: "ks2",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 3;
const ctx = {
  brief,
  theme: getTheme("paper"),
  stage: "ks2",
  index: INDEX,
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
} as never;

const SLIDE: S = {
  template: "myth",
  heading: "How things fall",
  myth: {
    opening: "vote",
    verdict: "myth",
    claim: "Heavier objects fall faster.",
    fact: "Without air resistance, all objects fall at the same rate.",
    factEm: "the same rate.",
    proof: {
      icons: ["hammer", "bird-feather"],
      line: "On the Moon, a hammer and a feather **land together.**",
    },
  },
};

describe("myth and fact in draft mode (TEACH-75 part ag)", () => {
  const text = JSON.stringify(SLIDE);
  const drafts: El[][] = [];
  for (let at = 12; at <= text.length; at += 12) {
    const p = peekPartial(text.slice(0, at));
    const v = p?.value as S | undefined;
    if (!v || typeof v.template !== "string" || p?.open?.[0] === "template") continue;
    const { template, ...fields } = v;
    const laid = layDraft(
      { template, fields, ...(p?.open ? { open: p.open } : {}) },
      ctx,
      new Map(),
      "KS2",
    );
    if (laid) drafts.push(flat(laid.elements as unknown as El[]));
  }
  const { template, ...fields } = SLIDE;
  const whole = flat(
    (layDraft({ template: template as string, fields }, ctx, new Map(), "KS2")?.elements ??
      []) as unknown as El[],
  );

  test("the draft shows the vote card; the closed slide has the verdict, the fact and the proof", () => {
    const names = whole.map((e) => e.name);
    for (const n of ["Claim card", "Claim open", "True or false", "Choice chip"])
      expect(names).toContain(n);
    expect(names).not.toContain("Fact");
    const closed = materialise(SLIDE, {
      ...(ctx as object),
      visual: () => ({ status: "pending" }),
    } as never).slide.elements.map((e) => e.name);
    for (const n of ["Claim open", "Claim", "Fact", "Proof line", "Proof icon", "Verdict"])
      expect(closed).toContain(n);
  });

  test("every draft id is kept by later drafts and the whole slide; none vanishes", () => {
    expect(drafts.length).toBeGreaterThan(10);
    const kept = new Set(whole.map((e) => e.id));
    const extra = drafts.flatMap((d) => d.map((e) => e.id).filter((id) => !kept.has(id)));
    expect([...new Set(extra)]).toEqual([]);
    const seen = new Set<string>();
    for (const d of drafts) {
      const ids = new Set(d.map((e) => e.id));
      expect([...seen].filter((id) => !ids.has(id))).toEqual([]);
      for (const id of ids) seen.add(id);
    }
  });
});
