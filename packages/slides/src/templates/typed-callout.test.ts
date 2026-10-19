import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { POINT_KIND_ICONS, POINT_KIND_LABELS, POINT_KINDS, pointTone } from "../callout";
import { getTheme, THEMES } from "../themes";
import { OLD_LESSON_INPUTS, OLD_LESSON_STAGES } from "./fixtures/old-lesson-inputs";
import MASTER from "./fixtures/old-lesson-master.json";
import { layoutTemplate, type Stage, type TemplateInput, type TemplatePoint } from "./index";
import { typedLast } from "./key-card";

/*
 * UX ruling 203, P1 (TEACH-75 part e): a support point may be typed as a callout. It is the key
 * card the lead + points column and ruling 194's strip already set, tinted per type with an icon,
 * under the text. An untyped key card is unchanged.
 */

type El = {
  type: string;
  name?: string;
  fill?: string;
  stroke?: string;
  icon?: string;
  y?: number;
};
const els = (input: TemplateInput, theme = THEMES[0], stage: Stage = "ks2") =>
  layoutTemplate(input, theme as (typeof THEMES)[number], stage).slide.elements as El[];
const textOf = (e: unknown): string => JSON.stringify(e).match(/"text":"([^"]*)"/)?.[1] ?? "";

const flow = {
  diagram: {
    kind: "flow",
    alt: "The heart's double loop",
    steps: [{ label: "Lungs" }, { label: "Heart" }, { label: "Body" }, { label: "Heart" }],
  },
};
const photo = { photo: "", aspect: 4 / 3, alt: "a heart" };
const plain = (n: number): TemplatePoint[] =>
  ["Blood carries oxygen.", "The heart pumps blood.", "Veins bring blood back."].slice(0, n - 1);

const hosts = (kind: (typeof POINT_KINDS)[number], n: number): TemplateInput[] => {
  const points: TemplatePoint[] = [
    { kind, text: "The heart pumps blood; it does not make it." },
    ...plain(n),
  ];
  return [
    {
      template: "picture-text",
      heading: "The heart",
      lead: "The heart is a pump.",
      points,
      figure: photo,
    },
    {
      template: "diagram-text",
      heading: "The heart",
      lead: "The heart is a pump.",
      points,
      figure: flow,
    },
    { template: "explain", heading: "The heart", lead: "The heart is a pump.", points },
  ];
};

describe("typed callout card", () => {
  for (const stage of OLD_LESSON_STAGES)
    test(`each type fits on every theme at ${stage} at 2, 3 and 4 items, with its tone, icon and label, last`, () => {
      for (const theme of THEMES)
        for (const kind of POINT_KINDS)
          for (const n of [2, 3, 4])
            for (const input of hosts(kind, n)) {
              const r = layoutTemplate(input, theme, stage);
              // Capacity is the key card's: at 4 items beside a figure the typed card is over only
              // where the same labelled key card already was (the measured catalogue's limit).
              const asKey = {
                ...input,
                points: input.points?.map((p) =>
                  typeof p === "string" ? p : { label: POINT_KIND_LABELS[kind], text: p.text },
                ),
              };
              const allowed = n === 4 && layoutTemplate(asKey, theme, stage).over.length > 0;
              if (!allowed)
                expect({ over: r.over, theme: theme.id, kind, n, t: input.template }).toMatchObject(
                  {
                    over: [],
                  },
                );
              const e = r.slide.elements as El[];
              const card = e.find((x) => x.name === "Key card");
              const tone = pointTone(theme, kind);
              expect(card?.fill).toBe(tone.fill);
              expect(card?.stroke).toBe(tone.line);
              expect(e.find((x) => x.name === "Callout icon")?.icon).toBe(POINT_KIND_ICONS[kind]);
              expect(textOf(e.find((x) => x.name === "Key label"))).toBe(POINT_KIND_LABELS[kind]);
              // Under the text: the card is the lowest body block.
              const points = e.filter((x) => x.name === "Point" || x.name === "Bullet");
              for (const p of points)
                if (p !== undefined && textOf(p) !== "The heart pumps blood; it does not make it.")
                  expect((p.y ?? 0) < (card?.y ?? 0)).toBe(true);
            }
    });

  test("a full-width diagram's key card strip takes the type too (ruling 194)", () => {
    for (const theme of THEMES) {
      const e = els(
        {
          template: "big-diagram",
          heading: "The double loop",
          lead: "Blood goes to the lungs, then the body.",
          points: [
            { kind: "watch-out", text: "Blood is never blue." },
            "Arteries carry blood away.",
          ],
          figure: flow,
        },
        theme,
      );
      const card = e.find((x) => x.name === "Key card" && x.stroke);
      if (!card) continue; // the slide fell back to diagram + text: covered above
      expect(card.fill).toBe(pointTone(theme, "watch-out").fill);
      expect(e.some((x) => x.name === "Callout icon")).toBe(true);
    }
  });

  test("an untyped key card has no hairline and no icon, as before", () => {
    const e = els({
      template: "picture-text",
      heading: "Lambs and ewes",
      lead: "A lamb is a young sheep.",
      points: [{ label: "Lamb", text: "a young sheep" }],
      figure: photo,
    });
    const card = e.find((x) => x.name === "Key card");
    expect(card?.stroke).toBeUndefined();
    expect(e.some((x) => x.name === "Callout icon")).toBe(false);
  });

  test("an unknown type is read as no type", () => {
    const e = els({
      template: "explain",
      heading: "x",
      lead: "y",
      points: [{ kind: "nonsense" as never, text: "z" }, "w"],
    });
    expect(e.some((x) => x.name === "Callout icon")).toBe(false);
  });

  test("Remember and Fun fact read on every theme (ink 7:1, icon 4.5:1 on the fill)", () => {
    const lum = (c: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = Number.parseInt(c.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
    };
    for (const theme of THEMES)
      for (const kind of ["remember", "fun-fact"] as const) {
        const t = pointTone(theme, kind);
        expect({ theme: theme.id, kind, ink: ratio(t.ink, t.fill) >= 7 }).toMatchObject({
          ink: true,
        });
        expect({ theme: theme.id, kind, icon: ratio(t.icon, t.fill) >= 4.5 }).toMatchObject({
          icon: true,
        });
      }
  });

  test("never throws on odd typed points", () => {
    for (const stage of ["ks1", "ks3", "ks5"] as Stage[])
      for (const theme of THEMES)
        for (const template of [
          "explain",
          "picture-text",
          "diagram-text",
          "big-diagram",
        ] as const) {
          const r = layoutTemplate(
            {
              template,
              heading: "word ".repeat(30),
              lead: "word ".repeat(80),
              points: POINT_KINDS.map((kind) => ({ kind, text: "word ".repeat(40), label: "" })),
              figure:
                template === "explain" ? undefined : template === "picture-text" ? photo : flow,
            } as TemplateInput,
            theme,
            stage,
          );
          expect(Array.isArray(r.slide.elements)).toBe(true);
        }
  });

  // 18 Oct 2026 (GOLD-THROUGH-PROD.md): hinge hashes re-pinned; only the field reports' cap and
  // hardMax moved (measured per option count, to the character); the layout is unchanged.
  // TEACH-230 part b: practice and the exit ticket are the "work alone" slides by design (ruling
  // 231), so their hashes were re-pinned to the new layout; stored decks keep their elements.
  // Ruling 21 A (TEACH-215 part e): the cover and the hinge take the golds' sizes, so their hashes
  // were re-pinned too.
  test("old lessons: byte-identical to master on every theme and stage (ids aside)", () => {
    const want = MASTER as Record<string, string>;
    let n = 0;
    // Theme v2 (TEACH-152 part b) and the round 5 themes (TEACH-215 part c) are new: no old lesson
    // was laid out on them. The themes are the ones the pins name, Night Lab included (16 Oct 2026).
    const pinned = [...new Set(Object.keys(want).map((k) => k.split("/")[1] as string))];
    for (const stage of OLD_LESSON_STAGES)
      for (const theme of pinned.map((id) => getTheme(id)))
        OLD_LESSON_INPUTS.forEach((input, i) => {
          const key = `${stage}/${theme.id}/${i}-${input.template}`;
          const j = JSON.stringify(layoutTemplate(input, theme, stage), (k, v) =>
            k === "id" ? undefined : v,
          );
          expect({ key, hash: createHash("sha1").update(j).digest("hex") }).toEqual({
            key,
            hash: want[key] as string,
          });
          n++;
        });
    expect(n).toBe(Object.keys(want).length);
    // Every old input on every theme and stage: about 6 s when the turbo run is loaded.
  }, 30_000);

  test("the first typed point goes under the text; a later one stays, labelled with its type", () => {
    expect(
      typedLast([
        { kind: "remember", text: "a" },
        "b",
        { kind: "watch-out", text: "c" },
        { kind: "fun-fact", text: "d", label: "Wow" },
      ]),
    ).toEqual([
      "b",
      { label: "Watch out", text: "c" },
      { label: "Wow", text: "d" },
      { kind: "remember", text: "a" },
    ]);
    expect(typedLast(["a", "b"])).toEqual(["a", "b"]);
  });
});
