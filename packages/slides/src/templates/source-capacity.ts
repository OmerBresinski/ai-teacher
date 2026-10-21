/**
 * The source's caps (TEACH-75 part ab), measured by the renderer: per age, the longest prose
 * extract (in words of a plain sample) and the most verse lines the card holds at the age's start
 * size (comfortable) and at its floor (at all), with no title and no notes, on every theme. The
 * writer caps (`words`, `lines`) are the gold's (NOTES "Caps"), held to what the renderer holds at
 * the floor: master's KS1 body has one step (28 pt) and KS2's floor is 25 pt, so KS1 and KS2 hold
 * fewer words than the gold's 1 px steps did.
 * Regenerate: `bun src/templates/source-capacity.ts > src/templates/source-capacity.json`.
 */
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import type { Age } from "./items-row-deps";

const POOL =
  "Oh but he was a tight fisted hand at the grindstone Scrooge a squeezing wrenching grasping scraping clutching covetous old sinner hard and sharp as flint from which no steel had ever struck out generous fire secret and self contained and solitary as an oyster the cold within him froze his old features nipped his pointed nose shrivelled his cheek stiffened his gait made his eyes red his thin lips blue and spoke out shrewdly in his grating voice a frosty rime was on his head and on his eyebrows and his wiry chin he carried his own low temperature always about with him he iced his office in the dog days and did not thaw it one degree at Christmas".split(
    " ",
  );
/** `n` words of the probe passage. */
export const sourceSample = (n: number): string =>
  Array.from({ length: n }, (_, i) => POOL[i % POOL.length]).join(" ");
/** The gold's characters per verse line at the age's start size (NOTES "Caps"). */
export const VERSE_CHARS: Record<Age, number> = { early: 35, primary: 43, secondary: 45 };
const VERSE = "Bent double, like old beggars under sacks, knock-kneed, coughing like hags";
/** `n` verse lines of `chars` characters each (cut at a word). */
export const verseSample = (n: number, chars = 45): string => {
  const line = VERSE.slice(0, chars).replace(/\s+\S*$/, "");
  return Array.from({ length: n }, () => line).join("\n");
};
export const SOURCE_CAP_STAGE: Record<Age, Stage> = {
  early: "ks1",
  primary: "ks2",
  secondary: "ks3",
};
/** The gold's writer caps (NOTES "Caps"): prose words and verse lines. */
export const SOURCE_WRITER_CAPS: Record<Age, { words: number; lines: number }> = {
  early: { words: 45, lines: 8 },
  primary: { words: 65, lines: 8 },
  secondary: { words: 90, lines: 10 },
};

export const sourceCapInput = (
  form: "prose" | "verse",
  n: number,
  age: Age = "secondary",
): TemplateInput => ({
  template: "source",
  heading: "",
  form,
  from: "from A Christmas Carol, Charles Dickens (1843)",
  extract: form === "prose" ? sourceSample(n) : verseSample(n, VERSE_CHARS[age]),
  notes: [],
});

function holds(age: Age, form: "prose" | "verse", n: number, comfort: boolean): boolean {
  return THEMES.every((theme) => {
    const r = layoutTemplate(sourceCapInput(form, n, age), theme, SOURCE_CAP_STAGE[age]);
    const real = r.over.filter((o) => !o.startsWith("source notes"));
    return real.length === 0 && (!comfort || !r.tight);
  });
}

function most(age: Age, form: "prose" | "verse", comfort: boolean, from: number, step: number) {
  let n = from;
  while (n < 400 && holds(age, form, n + step, comfort)) n += step;
  return n;
}

export function measureSourceCapacity() {
  const out: Record<string, Record<string, number>> = {};
  for (const age of ["early", "primary", "secondary"] as Age[]) {
    const comfortWords = most(age, "prose", true, 0, 5);
    const maxWords = most(age, "prose", false, comfortWords, 5);
    const comfortLines = most(age, "verse", true, 0, 1);
    const maxLines = most(age, "verse", false, comfortLines, 1);
    // The writer cap is the gold's, held to what the stage's type steps fit at their floor.
    const gold = SOURCE_WRITER_CAPS[age];
    out[age] = {
      words: Math.min(gold.words, maxWords),
      lines: Math.min(gold.lines, maxLines),
      comfortWords,
      maxWords,
      comfortLines,
      maxLines,
    };
  }
  return out;
}

if (import.meta.main) console.log(JSON.stringify(measureSourceCapacity(), null, 2));
