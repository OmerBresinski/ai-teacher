import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cellFor, variants } from "./activities";
import { droppedFits, FIT_ACTIVITIES, FIT_LAYOUTS, fitOffer, fitSlots, withFits } from "./fit-fits";
import { fitTable } from "./fixes";
import { assembleWriterSystem, LAYOUT_WRITER_MENUS, WRITER_RULES } from "./layout-menu";
import { flowLayoutOf, PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import type { WriterStage } from "./schema";
import { MIN_SHOWN_WORDS, PLAN_SHARE, wordsWithin } from "./shown-cap";
import { defCaps, fitKey, slotLayouts, variantCaps } from "./slot-fill";
import { waveCMenu } from "./wave-c-scratch";

/*
 * Loop 1 prompt part (17 Oct 2026): no length is typed into a v4.8 template. Every Fits, the
 * heading's words and the activities' label room are generated (`withFits`, layout-menu.ts menus
 * and rules), so the 75% shown share, the 5-word floor and the no-cliff rule reach every layout.
 */
type J = Record<string, any>;
const dir = new URL("./bundles/pilot-v4.8-menu/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const STAGES = Object.keys(KS) as WriterStage[];

/**
 * Typed numbers a template may keep, each for a stated reason. Anything else that counts words or
 * characters, or any `Fits:`, in a template outside a slot is a hand-typed fit number.
 */
const ALLOWED = [
  /^[123]\. (Flow|Layout|Write)\. /gm, // step numbers
  /[Ss]lide [12]\b/g, // slide positions
  /\bKS\d\b/g, // key stage names
  /say in up to 8 words what it does/g, // the flow's own planning fields, not slide text
  /in up to 6 words, the thing it shows/g,
  /2 to 4 pictures/g, // picture-sequence's counts, pinned to its offered fits below
  /up to 3 points/g, // explain's counts, pinned below
  /counting from 1/g, // answer index convention
  /one to three words of the heading exactly/g, // accentWord copies heading words
  /each one thing in two to four words/g, // a picture's must_see items (figure rules)
];
/**
 * The diagram kinds' limits are figure rules from the diagram contract, not layout Fits; they stay
 * typed per stage as a listed guard exception until that contract renders them (decision desk,
 * 17 Oct 2026; follow-up ticket).
 */
const DIAGRAM_KINDS = /\nDiagram kinds:\n(- [^\n]*\n)+/;

/** Hand-typed fit numbers in a template: what is left after slots and allowed phrases. */
function typedFitNumbers(template: string): string[] {
  let t = template.replace(DIAGRAM_KINDS, "\n");
  t = t.replace(/\{\{[a-z]+:[a-z-]+\}\}/g, "");
  for (const re of ALLOWED) t = t.replace(re, "");
  const spelled = "one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty";
  return [
    ...t.matchAll(/\bFits:[^.\n]*|[^.\n]{0,30}\d+[^.\n]{0,30}/g),
    ...t.matchAll(new RegExp(`\\b(${spelled})\\b[^.\\n]{0,15}\\b(words?|characters?)\\b`, "g")),
  ].map((m) => m[0].trim());
}

describe("v4.8 templates type no fit number", () => {
  for (const stage of STAGES) {
    const ks = KS[stage];
    test(`${ks}: nothing outside a slot counts words, characters or Fits`, () => {
      expect(typedFitNumbers(read(`system-${ks}.template.txt`))).toEqual([]);
    });

    test(`${ks}: every Fits in the assembled text is a generated one`, () => {
      const text = PILOT_PACKS["v4.8"].system[ks];
      const generated = [
        ...Object.values(fitSlots(stage)),
        ...Object.values(LAYOUT_WRITER_MENUS).map((m) => m[stage]),
        ...Object.values(WRITER_RULES),
        // SCRATCH: the wave C lines, generated from the capacity tables (wave-c-scratch.ts).
        ...Object.values(waveCMenu(stage)),
      ];
      const count = (s: string) => s.split("Fits:").length - 1;
      expect(count(text)).toBe(generated.reduce((n, g) => n + count(g), 0));
      for (const g of generated) expect(text.includes(g), g.slice(0, 40)).toBe(true);
      // The heading's words are the generated number.
      expect(text).toContain(`A heading is up to ${fitSlots(stage).heading} words.`);
      // The structural counts the template keeps match what is offered.
      const offer = fitOffer(stage);
      expect(offer["picture-sequence"]).toEqual(["sequence-2", "sequence-3", "sequence-4"]);
      expect(offer.explain?.some((k) => k.startsWith("points-3"))).toBe(true);
    });
  }

  test("the guard catches a Fits or a word count typed into a template", () => {
    const t = read("system-KS2.template.txt");
    expect(typedFitNumbers(t.replace("{{fits:hook}}", "Fits: fig 51."))).not.toEqual([]);
    expect(typedFitNumbers(t.replace("{{fits:heading}}", "8"))).not.toEqual([]);
    expect(
      typedFitNumbers(t.replace("A word count is a ceiling", "Write up to twenty words. A word")),
    ).not.toEqual([]);
    expect(typedFitNumbers(`${t}\nEach item is about 12 words.`)).not.toEqual([]);
  });

  test("a slot missing, repeated or unknown throws", () => {
    const t = assembleWriterSystem(read("system-KS2.template.txt"), "KS2");
    expect(() => withFits(t.replace("{{fits:steps}}", ""), "KS2")).toThrow();
    expect(() => withFits(`${t}\n{{fits:steps}}`, "KS2")).toThrow();
    expect(() => withFits(`${t}\n{{fits:nope}}`, "KS2")).toThrow();
  });
});

describe("fit layouts keep the floor and no cliff", () => {
  for (const stage of STAGES) {
    test(`${KS[stage]}: every prose number shown is at least the floor; dropped fits leave the schema`, () => {
      const slots = fitSlots(stage);
      for (const layout of FIT_LAYOUTS) {
        // Captions name a stage and equation-hero's points are calculation lines (exempt).
        if (layout === "picture-sequence") continue;
        for (const fit of (slots[layout] as string).replace(/^Fits: |\.$/g, "").split("; ")) {
          const nums = [...fit.replace(/label \d+ \+ /g, "").matchAll(/(?:^|[ ,])(\d+)/g)].map(
            (m) => Number(m[1]),
          );
          const prose = layout === "equation-hero" ? nums.slice(0, 1) : nums;
          for (const n of prose)
            expect(n, `${layout} ${fit}`).toBeGreaterThanOrEqual(MIN_SHOWN_WORDS);
        }
      }
      const { schema } = pilotRequest("v4.8", KS[stage], {}, (sc) => sc);
      const sent = JSON.stringify(schema);
      for (const k of droppedFits(stage)) expect(sent.includes(`"#/$defs/${k}"`), k).toBe(false);
      for (const [layout, keys] of Object.entries(fitOffer(stage)))
        for (const key of keys) expect(sent.includes(`"#/$defs/${layout}~${key}"`)).toBe(true);
    });
  }
});

/*
 * The Fits are generated from the caps code checks a slide against (the frozen v4.5 request). That
 * bound stays frozen because it is the measured fit table: pinned here, field for field. The one
 * difference is the hook's text (410 characters checked at KS2 against 374 measured now), kept so
 * stored lessons are judged as they were; its Fits are 75% of 410 (82% of the new measure).
 */
describe("the checked caps are the measured fit table", () => {
  for (const stage of STAGES)
    test(`${KS[stage]}`, () => {
      // The caps code checks (the production pack's caps request), not v4.5's own schema.
      const caps = pilotRequest(PILOT_PACK_ID, KS[stage], {}, (sc) => sc).caps?.$defs as J;
      const heading = (fitTable()[stage] as J).heading as number;
      const diffs: string[] = [];
      for (const layout of FIT_LAYOUTS) {
        if (layout === "hook") continue;
        for (const v of slotLayouts(stage)[layout] ?? []) {
          const def = caps[`${layout}~${fitKey(v)}`];
          if (!def) continue;
          const p = def.properties;
          const c = variantCaps(
            layout,
            v as never,
            { lead: "lead" in p, stem: "stem" in p, instruction: "instruction" in p },
            heading,
          );
          for (const [path, n] of defCaps(def).filter(([, x]) => x > 0)) {
            const want =
              path === "heading"
                ? c.heading
                : path === "lead"
                  ? c.lead
                  : path.endsWith(".label")
                    ? c.label
                    : path === "formula"
                      ? n
                      : c.item;
            if (want !== n) diffs.push(`${layout}~${fitKey(v)} ${path} ${n} vs ${want}`);
          }
        }
      }
      expect(diffs).toEqual([]);
    });
});

/*
 * Loop 1b (17 Oct 2026): the flow names each slide's layout and fit before its size, so an idea is
 * counted against its fit while a split is still possible; the headroom share is generated.
 */
describe("the flow chooses the layout before the slide count is final", () => {
  for (const stage of STAGES)
    test(`${KS[stage]}: flow layout is an enum of the offered slides, before size`, () => {
      const { schema } = pilotRequest("v4.8", KS[stage], {}, (sc) => sc);
      const entry = schema.properties.flow.items as J;
      const keys = Object.keys(entry.properties);
      expect(keys.indexOf("layout")).toBe(keys.indexOf("look_at") + 1);
      expect(keys.indexOf("size")).toBe(keys.indexOf("layout") + 1);
      expect(keys.at(-1)).toBe("teaches");
      expect(entry.required).toEqual(keys);
      const offered = (schema.properties.slides.items.anyOf as J[]).map((r) =>
        flowLayoutOf(String(r.$ref).split("/").pop() ?? ""),
      );
      expect(entry.properties.layout.enum).toEqual(["title", "objectives", ...offered]);
      // A dropped fit is not offered to the flow either.
      for (const k of droppedFits(stage))
        expect(entry.properties.layout.enum).not.toContain(flowLayoutOf(k));
      // The headroom is the code's share, rendered once, never typed.
      const text = PILOT_PACKS["v4.8"].system[KS[stage]];
      const share = `more than about ${Math.round(PLAN_SHARE * 100)}% of its fit's words`;
      expect(text.split(share).length).toBe(2);
    });

  test("v4.7 stays as shipped: no flow layout", () => {
    const { schema } = pilotRequest("v4.7", "KS2", {}, (sc) => sc);
    expect(Object.keys(schema.properties.flow.items.properties)).not.toContain("layout");
  });
});

describe("the activities' label room is in words", () => {
  // Every other v4.8 Fits number is in words, the unit the writer plans in; a character count
  // here was the odd one out (TEACH-110 part ae, 19 Oct 2026). Each run's words are the hard cap
  // in words at the stage's long-word rate (`wordsWithin`) of every card count it names.
  const RUN =
    /(\d+)(?: to (\d+))? cards(?: in [\d, or]+ groups)?, labels (?:one word|up to (\d+) words) each/g;
  for (const stage of STAGES)
    for (const id of FIT_ACTIVITIES)
      test(`${KS[stage]} ${id}: words, never characters, within each count's cell`, () => {
        const line = fitSlots(stage)[id] ?? "";
        expect(line).not.toMatch(/character/);
        const runs = [...line.matchAll(RUN)];
        expect(runs.length).toBeGreaterThan(0);
        // Every clause is a run the parser read: nothing else is said in the line.
        expect(runs.length).toBe(line.split("; ").length);
        for (const m of runs) {
          const w = m[3] ? Number(m[3]) : 1;
          for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n += 1) {
            const cell = cellFor(id, stage, n);
            if (!variants(id, stage).some((v) => v.cards === n)) continue;
            if (id === "group-sort") expect(w).toBeLessThanOrEqual(wordsWithin(cell, stage));
            else expect(w).toBe(wordsWithin(cell, stage));
          }
        }
      });
});
