/**
 * Myth and fact (TEACH-75 part ag): the most words each field holds at full fit, measured by the
 * renderer in filler wording on every theme of the age, beside the gold NOTES caps (myth-c: title
 * 6, claim 12, fact 18 or 14 with a picture, proof line 14). `cap` is the NOTES value (never more
 * than measured); `hardMax` the most that still lays out with nothing over. Regenerate:
 * `bun packages/slides/src/templates/myth-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import type { Age } from "./items-row-deps";
import { type MythCap, type MythField, type MythInput, withoutMythCaps } from "./myth";

export const MYTH_AGES: Record<Age, Stage[]> = {
  early: ["ks1"],
  primary: ["ks2"],
  secondary: ["ks3", "ks4", "ks5"],
};
/** The gold NOTES caps (myth-c "Fields (writer) and caps"). */
export const MYTH_NOTES_CAPS: Record<MythField, number> = {
  title: 6,
  claim: 12,
  fact: 18,
  factPicture: 14,
  proof: 14,
};
const MOST = 40;
const POOL =
  "Without air resistance all objects of every size and shape fall towards the ground at exactly the same rate whatever they are made of and however heavy they seem to be when you hold them in your hand at home".split(
    " ",
  );
export const filler = (n: number) =>
  `${POOL.slice(0, n).join(" ")}.`.replace(/^./, (s) => s.toUpperCase());

const base = (picture: boolean): { heading: string; myth: MythInput } => ({
  heading: "How things fall",
  myth: {
    claim: "Heavier objects fall faster.",
    fact: filler(10),
    proof: {
      line: "On the Moon, a hammer and a feather **land together.**",
      ...(picture
        ? { picture: { photo: "x", alt: "the Moon" } }
        : { icons: ["hammer", "bird-feather"] }),
    },
  },
});

function fits(field: MythField, n: number, stages: Stage[]): boolean {
  const b = base(field === "factPicture");
  const myth = { ...b.myth, proof: b.myth.proof ? { ...b.myth.proof } : null };
  let heading = b.heading;
  if (field === "title") heading = filler(n).replace(/\.$/, "");
  if (field === "claim") myth.claim = filler(n);
  if (field === "fact" || field === "factPicture") {
    myth.fact = filler(n);
    // Beside the gold's usual proof (10 words, the falling slide).
    if (myth.proof) myth.proof.line = filler(10);
  }
  if (field === "proof" && myth.proof) {
    myth.fact = filler(10);
    myth.proof.line = filler(n);
  }
  for (const theme of THEMES)
    for (const stage of stages) {
      const input = { template: "myth", heading, myth } as TemplateInput;
      const r = withoutMythCaps(() => layoutTemplate(input, theme, stage));
      if (r.over.length) return false;
      if (field === "title") {
        const h = r.slide.elements.find((e) => e.name === "Heading") as
          | { h: number; style: { fontSize: number } }
          | undefined;
        if (!h || h.h > h.style.fontSize * 1.6) return false;
      }
    }
  return true;
}

export function measureMythCaps(): Record<Age, Record<MythField, MythCap>> {
  const out = {} as Record<Age, Record<MythField, MythCap>>;
  for (const [age, stages] of Object.entries(MYTH_AGES) as [Age, Stage[]][]) {
    const row = {} as Record<MythField, MythCap>;
    for (const field of Object.keys(MYTH_NOTES_CAPS) as MythField[]) {
      let hardMax = 0;
      for (let n = 1; n <= MOST && fits(field, n, stages); n++) hardMax = n;
      row[field] = { cap: Math.min(MYTH_NOTES_CAPS[field], hardMax), hardMax };
    }
    out[age] = row;
  }
  return out;
}

if (import.meta.main)
  writeFileSync(
    new URL("./myth-capacity.json", import.meta.url),
    `${JSON.stringify(measureMythCaps(), null, 2)}\n`,
  );
