import { describe, expect, test } from "bun:test";
import { LAYOUT_WRITER_MENUS, menuWordCaps } from "./layout-menu";
import type { WriterStage } from "./schema";

/*
 * `menuWordCaps` is the eval's source of caps (TEACH-110 part af): it must say exactly what each
 * menu line prints. This reads every number back out of the printed Fits text, layout by layout
 * and stage by stage, and compares the two, so a menu line and the data can never drift apart.
 */
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
type Caps = Record<number, number>;

/** "2 to 3 items: up to 8 words each; 4 items: up to 3 words each" -> {2: 8, 3: 8, 4: 3}. */
function clauses(text: string, unit: string): Caps {
  const out: Caps = {};
  const re = new RegExp(
    `(\\d+)(?: to (\\d+))? ${unit}s?: (?:heading up to \\d+ words, )?up to (\\d+) words`,
    "g",
  );
  for (const m of text.matchAll(re))
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) out[n] = Number(m[3]);
  return out;
}
const num = (re: RegExp, s: string) => {
  const m = re.exec(s);
  return m ? Number(m[1]) : undefined;
};
const fits = (line: string) => line.split("Fits: ")[1] ?? "";

/** A list layout's Fits: plain clauses, the lead's words and clauses, a heading if printed. */
function listFits(text: string) {
  const [plain = "", lead] = text.split("with a lead of up to ");
  const numbered = text.split("; ").filter((c) => c.includes("every icon null"));
  const plainOnly = plain
    .split("; ")
    .filter((c) => !c.includes("every icon null"))
    .join("; ");
  const leadOnly = (lead ?? "")
    .split("; ")
    .filter((c) => !c.includes("every icon null"))
    .join("; ");
  return {
    heading: num(/^heading up to (\d+) words/, text),
    items: clauses(plainOnly, "item"),
    num: clauses(numbered.map((c) => c.replace(", every icon null", "")).join("; "), "item"),
    lead: lead === undefined ? null : (num(/^(\d+) words/, lead) ?? null),
    leadHeading: lead === undefined ? undefined : num(/^\d+ words \(heading up to (\d+)\)/, lead),
    leadItems: clauses(leadOnly, "item"),
  };
}

describe("menuWordCaps says what the menu prints", () => {
  for (const stage of STAGES) {
    const caps = menuWordCaps(stage);

    test(`${stage} items-row`, () => {
      const f = listFits(fits(LAYOUT_WRITER_MENUS["items-row"][stage]));
      const c = caps["items-row"];
      expect(c.items.icons).toEqual(f.items);
      expect(c.items.num).toEqual(f.num);
      expect(c.items.lead).toEqual(f.leadItems);
      expect(c.lead).toBe(f.lead);
      if (f.heading !== undefined) expect(c.heading.icons).toBe(f.heading);
      if (f.leadHeading !== undefined) expect(c.heading.lead).toBe(f.leadHeading);
    });

    test(`${stage} panel-list`, () => {
      const [plainText = "", picText = ""] = fits(LAYOUT_WRITER_MENUS["panel-list"][stage]).split(
        ". With a picture on every item: ",
      );
      const f = listFits(plainText);
      const c = caps["panel-list"];
      expect(c.items.plain).toEqual(f.items);
      expect(c.items.lead).toEqual(f.leadItems);
      expect(c.lead.plain).toBe(f.lead);
      if (f.heading !== undefined) expect(c.heading.plain).toBe(f.heading);
      // "the same, except ...": only what differs with pictures is printed.
      const except = picText.split("the same, except ")[1]?.split(". Each limit")[0] ?? "";
      const p = listFits(except);
      const pics: Caps = { ...f.items, ...p.items };
      for (const m of except.matchAll(/(\d+)(?: to (\d+))? items: not offered/g))
        for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) delete pics[n];
      expect(c.items.pics).toEqual(pics);
      expect(c.items.picsLead).toMatchObject(p.leadItems);
      expect(c.lead.pics).toBe(p.lead ?? f.lead);
      if (p.heading !== undefined) expect(c.heading.pics).toBe(p.heading);
    });

    test(`${stage} split-compare`, () => {
      const line = LAYOUT_WRITER_MENUS["split-compare"][stage];
      const c = caps["split-compare"];
      expect(c.title).toBe(num(/names its thing in up to (\d+) words/, line) ?? -1);
      const zone = { "words only": "", "with pictures": "p", "with quotes": "q" } as const;
      const sides: Record<string, number> = {};
      const quote: Caps = {};
      for (const m of fits(line).matchAll(
        /(\d) sides (words only|with pictures|with quotes): up to (\d+) words each(?:, plus a quote of up to (\d+) words)?/g,
      )) {
        sides[`${m[1]}${zone[m[2] as keyof typeof zone]}`] = Number(m[3]);
        if (m[4]) quote[Number(m[1])] = Number(m[4]);
      }
      expect(c.sides).toEqual(sides);
      expect(c.quote).toEqual(quote);
    });

    test(`${stage} hinge`, () => {
      const f = fits(LAYOUT_WRITER_MENUS.hinge[stage]);
      expect(caps.hinge.question).toBe(num(/the question up to (\d+) words/, f) ?? -1);
      expect(caps.hinge.options).toEqual(
        clauses(f.split("; options with icons")[0] ?? "", "option"),
      );
      expect(caps.hinge.tile).toBe(num(/options with icons: up to (\d+) words/, f) ?? -1);
    });

    test(`${stage} question-set`, () => {
      const f = fits(LAYOUT_WRITER_MENUS["question-set"][stage]);
      const questions: Caps = {};
      const answers: Caps = {};
      for (const m of f.matchAll(
        /(\d+)(?: to (\d+))? questions: up to (\d+) words each, each answer (?:up to (\d+) words|one word or number)/g,
      ))
        for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) {
          questions[n] = Number(m[3]);
          answers[n] = m[4] ? Number(m[4]) : 1;
        }
      expect(caps["question-set"].questions).toEqual(questions);
      expect(caps["question-set"].answers).toEqual(answers);
    });

    test(`${stage} practice and exit-ticket`, () => {
      const [plain = "", pic = ""] = fits(LAYOUT_WRITER_MENUS.practice[stage]).split(
        "with a picture or diagram:",
      );
      expect(caps.practice.plain).toEqual(clauses(plain, "task"));
      expect(caps.practice.picture).toEqual(clauses(pic, "task"));
      expect(caps["exit-ticket"].questions).toEqual(
        clauses(fits(LAYOUT_WRITER_MENUS["exit-ticket"][stage]), "question"),
      );
    });
  }
});
