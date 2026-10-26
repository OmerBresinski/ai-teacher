import { describe, expect, test } from "bun:test";
import type { TextElement } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { G, layoutTemplate, STATEMENT_MAX_WORDS, type Stage, templateScale } from "./index";

/*
 * TEACH-247 part al: a sparse explain slide (a lead and at most one plain point) is set as a
 * statement at the type scale's heading step with an accent edge, centred on the band, not a
 * body-size column on an empty slide (ruling 252). The inputs are the Romans Y4 verify3 lesson's
 * saved s3 and s8 (genlab 20261026-062218).
 */
const S3 = {
  template: "explain",
  heading: "Where and when was Hadrian’s Wall built?",
  lead: "Building Hadrian’s Wall in northern Britain began in AD 122.",
  points: [],
} as const;
const S8 = {
  template: "explain",
  heading: "Why were patrols needed too?",
  lead: "A wall alone could not guard the whole frontier.",
  points: ["Soldiers walked between posts to look for signs of danger."],
} as const;
const STAGES: Stage[] = ["ks1", "ks2"];
const named = <T extends { name?: string }>(els: readonly T[], n: string) =>
  els.filter((e) => e.name === n);

describe("explain: a sparse slide is a statement (TEACH-247 part al)", () => {
  test("Romans s3 and s8: larger than body, edged, inside the band, every word, in every theme", () => {
    const faults: string[] = [];
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const input of [S3, S8]) {
          const where = `${theme.id} ${stage} ${input.heading}`;
          const r = layoutTemplate({ ...input, points: [...input.points] }, theme, stage);
          const els = r.slide.elements;
          const body = templateScale(theme, stage).body;
          const words = [...named(els, "Lead"), ...named(els, "Point")] as TextElement[];
          const edge = named(els, "Statement edge")[0];
          if (r.over.length) faults.push(`${where}: over ${r.over.join(",")}`);
          if (!edge) faults.push(`${where}: no edge`);
          if (named(els, "Bullet").length) faults.push(`${where}: a one-item list`);
          if (words.length !== 1 + input.points.length) faults.push(`${where}: words lost`);
          for (const w of words) {
            if ((w.style.fontSize ?? 0) <= body) faults.push(`${where}: ${w.name} not larger`);
            if (w.y < G.band.y || w.y + w.h > G.band.y + G.band.h)
              faults.push(`${where}: ${w.name} outside the band`);
            if (edge && (w.x < edge.x + edge.w || w.y < edge.y || w.y + w.h > edge.y + edge.h + 1))
              faults.push(`${where}: ${w.name} not held by the edge`);
          }
          const head = named(els, "heading")[0] ?? els[0];
          if (head && edge && edge.y < head.y + head.h) faults.push(`${where}: under the heading`);
        }
    expect(faults).toEqual([]);
  });

  test("not sparse: three points, a labelled point or too many words keep the column", () => {
    const long = Array.from({ length: STATEMENT_MAX_WORDS + 1 }, (_, i) => `word${i}`).join(" ");
    const cases = [
      { ...S8, points: ["One point here.", "A second point.", "A third point."] },
      { ...S8, points: [{ text: "Soldiers walked between posts.", label: "Patrol" }] },
      { ...S3, lead: long },
    ];
    for (const theme of [THEMES[0], THEMES[9]])
      for (const input of cases) {
        const r = layoutTemplate(input as never, theme as never, "ks2");
        expect(named(r.slide.elements, "Statement edge")).toHaveLength(0);
      }
  });
});
