import { describe, expect, test } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import { resolveTextStyle } from "../text-style";
import { atKeyStage, getTheme, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { type KeyCard, PT_CAPS, PT_NAMES } from "./picture-text";
import { measurePictureTextCaps } from "./picture-text-capacity";
import CAPACITY from "./picture-text-capacity.json" with { type: "json" };
import { PT_CASES, photo, SVG } from "./picture-text-fixtures";

/*
 * TEACH-75 part ae (C6): picture and text, the v13 gold B "tucked field", and its key card look.
 * The cases are the gold's (`northstars-v13/picture-text/cases.js`).
 */
const base = (stage: Stage) => (stage === "ks1" ? "ks1" : stage === "ks2" ? "ks2" : "ks3");

const paper = getTheme("paper", null);
const lay = (name: string, theme: Theme = paper, stage?: Stage) => {
  const c = PT_CASES[name];
  if (!c) throw new Error(name);
  return layoutTemplate(c.input, theme, stage ?? c.stage);
};
const named = (r: ReturnType<typeof layoutTemplate>, n: string) =>
  r.slide.elements.filter((e) => e.name === n) as unknown as {
    x: number;
    y: number;
    w: number;
    h: number;
    style?: { fontSize?: number; color?: string };
    doc?: unknown;
    src?: string;
  }[];

describe("picture and text: every gold case on every theme", () => {
  for (const theme of THEMES)
    for (const [name, c] of Object.entries(PT_CASES).filter(([n]) => !n.endsWith("-gold-text")))
      test(`${name} on ${theme.id}: nothing over, sizes on the stage's steps`, () => {
        const r = layoutTemplate(c.input, theme, c.stage);
        expect(r.over).toEqual([]);
        const staged = atKeyStage(theme, base(c.stage));
        for (const e of r.slide.elements) {
          if (e.type !== "text") continue;
          const st = (e as { style: { fontSize: number } }).style;
          expect(resolveTextStyle(st as never, staged, "body").fontSize).toBe(st.fontSize);
          expect(e.y + e.h).toBeLessThanOrEqual(540);
          expect(e.x + e.w).toBeLessThanOrEqual(960);
        }
      });
});

describe("picture and text: the field", () => {
  test("width by aspect: landscape 427, square 387, portrait 333 (640/580/500 at 1440), bleeding", () => {
    for (const [a, w] of [
      [1.5, 427],
      [1, 387],
      [0.75, 333],
    ] as const) {
      const input = { ...(PT_CASES["ks2-wrapping"]?.input as TemplateInput), figure: photo(a) };
      const [p] = named(layoutTemplate(input, paper, "ks2"), PT_NAMES.photo);
      expect(960 - (p?.x ?? 0)).toBe(w);
      // It bleeds: its right and bottom run past the slide's edges by its corner radius.
      expect((p?.x ?? 0) + (p?.w ?? 0)).toBeGreaterThan(960);
      expect((p?.y ?? 0) + (p?.h ?? 0)).toBeGreaterThan(540);
      expect((p?.x ?? 0) + w).toBe(960);
    }
  });
  test("lead only: the picture takes 53 more", () => {
    const [p] = named(lay("ks1-chick"), PT_NAMES.photo);
    expect(960 - (p?.x ?? 0)).toBe(387 + 53);
  });
  test("failed picture: the sand field holds the icon's medal; no icon: the words take the width", () => {
    const r = lay("ks2-wrapping-nopic");
    expect(named(r, PT_NAMES.field)).toHaveLength(1);
    expect(named(r, PT_NAMES.medal)).toHaveLength(1);
    expect(named(r, PT_NAMES.photo)).toHaveLength(0);
    const bare = lay("ks1-chick-nopic-noicon");
    expect(named(bare, PT_NAMES.field)).toHaveLength(0);
    expect(named(bare, PT_NAMES.lead)[0]?.w).toBe(667);
  });
  test("a near-square model sits on the paper, restyled, with no field; a wide one is flagged", () => {
    const r = lay("ks2-diagram-circuit");
    expect(named(r, PT_NAMES.field)).toHaveLength(0);
    expect(decodeURIComponent(named(r, PT_NAMES.diagram)[0]?.src ?? "")).toContain(
      'data-restyle="tj"',
    );
    const wide = layoutTemplate(
      {
        ...(PT_CASES["ks2-diagram-circuit"]?.input as TemplateInput),
        figure: { drawn: { src: SVG(1140, 538), aspect: 1140 / 538, bare: true } },
      },
      paper,
      "ks2",
    );
    expect(wide.over).toContain("picture-text model too wide: figure slide");
  });
  test("the title zone's declared height joins a banded theme's band to the field", () => {
    const poster = { ...paper, id: "poster" } as Theme;
    const r = lay("ks2-wrapping", poster);
    const [band] = named(r, PT_NAMES.band);
    const [field] = named(r, PT_NAMES.photo);
    expect(band?.y).toBe(0);
    expect((band?.y ?? 0) + (band?.h ?? 0)).toBe(field?.y as number);
    // No column text starts under the band.
    for (const n of [PT_NAMES.lead, PT_NAMES.point])
      for (const e of named(r, n)) expect(e.y).toBeGreaterThanOrEqual(field?.y as number);
    expect(named(lay("ks2-wrapping"), PT_NAMES.band)).toHaveLength(0);
  });
});

describe("picture and text: hierarchy", () => {
  for (const theme of THEMES)
    for (const name of ["ks1-chick", "ks2-wrapping", "ks2-canopic-portrait", "ks3-composite"])
      test(`${name} on ${theme.id}: the points sit a step under the lead, in muted`, () => {
        const r = lay(name, theme);
        const lead = named(r, PT_NAMES.lead)[0]?.style?.fontSize ?? 0;
        for (const p of named(r, PT_NAMES.point)) {
          expect(p.style?.fontSize ?? 99).toBeLessThan(lead);
          expect(p.style?.color).toBe(theme.colors.muted);
        }
      });
});

describe("picture and text: caps flag, never clip", () => {
  test("the gold's full KS3 text is reported over and every word is drawn", () => {
    const c = PT_CASES["ks3-composite-gold-text"];
    const r = lay("ks3-composite-gold-text");
    expect(r.over.some((o) => o.startsWith("picture-text words "))).toBe(true);
    const drawn = r.slide.elements
      .filter((e) => e.name === PT_NAMES.lead || e.name === PT_NAMES.point)
      .map((e) => JSON.stringify((e as { doc?: unknown }).doc));
    for (const t of [c?.input.lead ?? "", ...((c?.input.points ?? []) as string[])])
      expect(drawn.some((d) => d.includes(t))).toBe(true);
  });
  test("past the caps: named in over, every word still drawn", () => {
    const input: TemplateInput = {
      ...(PT_CASES["ks2-wrapping"]?.input as TemplateInput),
      heading: "Wrapping the mummy took a very long time indeed",
      points: Array.from(
        { length: 4 },
        (_, i) => `Point ${i} has quite a few words in it to be long.`,
      ),
    };
    const r = layoutTemplate(input, paper, "ks2");
    expect(r.over).toContain("picture-text title words 9/7");
    expect(r.over).toContain("picture-text points 4/3");
    expect(named(r, PT_NAMES.point)).toHaveLength(4);
  });
  test("over the measured word cap at the floor: over, never shrunk under the small step", () => {
    const pts = Array.from(
      { length: 3 },
      () =>
        "The blast throws out ash, pumice and pyroclastic flows that race downhill at over a hundred kilometres an hour.",
    );
    const r = layoutTemplate(
      { ...(PT_CASES["ks3-composite"]?.input as TemplateInput), points: pts },
      paper,
      "ks3",
    );
    expect(r.over.some((o) => o.startsWith("picture-text column "))).toBe(true);
    const small = atKeyStage(paper, "ks3");
    for (const e of named(r, PT_NAMES.point))
      expect(e.style?.fontSize).toBeGreaterThanOrEqual(
        resolveTextStyle({ preset: "body" }, small, "body").fontSize - 6,
      );
  });
  test("a cap of 0 reports over, never 'no cap'", () => {
    const r = layoutTemplate(
      {
        template: "picture-text",
        heading: "Magma",
        figure: photo(1.5),
        pictureText: {
          cards: [{ kind: "fact", label: "Key fact", num: "1234567", unit: "metres per second" }],
        },
      },
      paper,
      "ks2",
    );
    expect(r.over).toContain("picture-text card 1 number characters 7/6");
    expect(r.over).toContain("picture-text card 1 unit words 3/1");
    expect(PT_CAPS.KS1.points).toBe(2);
  });
});

describe("picture and text: the key card look", () => {
  test("no red in the title; the term is in the accent", () => {
    const r = lay("key-ks2-photosynthesis");
    expect(JSON.stringify(named(r, "Heading")[0]?.doc)).not.toContain(paper.colors.accent);
    expect(named(r, PT_NAMES.term)[0]?.style?.color).toBe(paper.colors.accent);
  });
  test("plain look: the accent word is red", () => {
    expect(JSON.stringify(named(lay("ks2-wrapping"), "Heading")[0]?.doc)).toContain(
      paper.colors.accent,
    );
  });
  test("no picture: the cards go side by side across the width", () => {
    const cards = named(lay("key-ks2-spelling"), PT_NAMES.card);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.y).toBe(cards[1]?.y as number);
    expect(named(lay("key-ks2-spelling"), PT_NAMES.example)).toHaveLength(3);
  });
  test("fact: the number in the accent with its unit", () => {
    const r = lay("key-ks3-fact");
    expect(named(r, PT_NAMES.num)[0]?.style?.color).toBe(paper.colors.accent);
    expect(named(r, PT_NAMES.unit)).toHaveLength(1);
  });
  test("a key card beside points with no picture is flagged; no element builds", () => {
    const r = layoutTemplate(
      {
        ...(PT_CASES["key-ks2-photosynthesis"]?.input as TemplateInput),
        figure: undefined,
        points: ["A point."],
      },
      paper,
      "ks2",
    );
    expect(r.over).toContain("picture-text key card beside points");
    expect(r.slide.elements.some((e) => "revealStep" in e && e.revealStep)).toBe(false);
  });

  // TEACH-247 part ao: Romans Y4 verify5 s5. A placed picture outranks the card's look.
  const romans = (cards?: KeyCard[]): TemplateInput => ({
    template: "picture-text",
    heading: "Why build a guarded wall?",
    lead: "The Romans wanted to defend their frontier and control movement.",
    points: [
      "The wall made raids into Roman Britain harder for groups living north of it.",
      "Gates let Roman soldiers check travellers and goods crossing the frontier.",
    ],
    figure: { photo: "/files/gateway.jpg", aspect: 4 / 3, alt: "A gateway" },
    pictureText: {
      icon: "roman shield",
      cards: cards ?? [
        {
          kind: "word",
          label: "Meaning",
          term: "Frontier",
          meaning: "The edge of land an empire controls.",
        },
      ],
    },
  });
  test("cards beside points and a picture fold into points beside it, in every theme at KS2", () => {
    const faults: string[] = [];
    for (const theme of THEMES) {
      const r = layoutTemplate(romans(), theme, "ks2");
      const els = r.slide.elements;
      const where = theme.id;
      if (r.over.length) faults.push(`${where}: over ${r.over.join(",")}`);
      if (
        !els.some((e) => e.type === "image" && (e as { src?: string }).src === "/files/gateway.jpg")
      )
        faults.push(`${where}: no picture`);
      if (named(r, PT_NAMES.card).length) faults.push(`${where}: a card drawn`);
      if (!JSON.stringify(els).includes("Frontier: The edge of land an empire controls."))
        faults.push(`${where}: the card's words lost`);
    }
    expect(faults).toEqual([]);
  });
  test("a folded card keeps its meaning's case: proper nouns and acronyms stay", () => {
    for (const meaning of ["DNA carries the code for a living thing.", "Roman soldiers kept it."]) {
      const r = layoutTemplate(
        romans([{ kind: "word", label: "Meaning", term: "Gene", meaning }]),
        paper,
        "ks2",
      );
      expect(r.over).toEqual([]);
      expect(JSON.stringify(r.slide.elements)).toContain(`Gene: ${meaning}`);
    }
  });
  test("a fold that does not fit, or a card that is not one line, leaves the slide flagged", () => {
    // KS1 holds two points and fewer words: the fold is over, so the slide stays as it was.
    const ks1 = layoutTemplate(romans(), paper, "ks1");
    expect(ks1.over).toContain("picture-text key card beside points");
    const ex = layoutTemplate(
      romans([{ kind: "examples", label: "Examples", examples: [["fort", "soldiers"]] }]),
      paper,
      "ks2",
    );
    expect(ex.over).toContain("picture-text key card beside points");
  });
});

describe("picture and text: old slides and capacity", () => {
  test("a saved picture-text slide without pictureText keeps the old layout", () => {
    const old = { ...(PT_CASES["ks2-wrapping"]?.input as TemplateInput), pictureText: undefined };
    const r = layoutTemplate(old, paper, "ks2");
    expect(named(r, PT_NAMES.field)).toHaveLength(0);
    expect(named(r, PT_NAMES.dot)).toHaveLength(0);
  });
  test("picture-text-capacity.json is what the renderer measures", () => {
    expect(measurePictureTextCaps()).toEqual(CAPACITY);
  });
});
