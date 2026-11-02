import { describe, expect, test } from "bun:test";
import { KEY_FIT } from "@tj/slides/templates/picture-text";
import { getTheme, THEMES } from "@tj/slides/themes";
import { libSchema } from "../library/catalogue";
import { writerBundle } from "./bundle";
import { materialise } from "./materialise";
import { fitPilot, overFault, pilotOvers } from "./pilot-fit";
import { PILOT_PACK_ID, pilotRequest } from "./pilot-pack";
import { writerSchema } from "./schema";
import { slotFillArrival } from "./slot-fill";

/*
 * TEACH-247 part co: genlab run 20261102-171639-record-y2-greatfire-r1-v421a (Year 2, Crayon Box)
 * shipped slide 9 "Making a firebreak" (visual-text key-card-fig) with `overflow: picture-text
 * column 529/497pt`: a 10-word lead and one key card with a 10-word meaning, every field inside
 * the caps the writer was given (lead and points 26 words, a meaning 16), ran 32pt past the
 * column's foot beside the picture. Slot-fill let it through (`route: as-written`): those caps
 * were the plain look's lead budget and the gold's per-field card caps, never measured together
 * with the card, and key-card-fig is "measured by its own build", which nothing acted on (not a
 * pilot layout; checks only log; ruling 71 A keeps on-slide overflow). The key card look is now
 * measured as rendered (KEY_FIT), and a column past its foot goes back to the writer once with
 * each field's measured room, as the pilot layouts' fit does. Code never cuts its words.
 */
type S = Record<string, unknown>;

/** Slide 9 exactly as the writer wrote it (debug.json, the writer call's text). */
const S9: S = {
  template: "visual-text",
  fit: "key-card-fig",
  heading: "Making a firebreak",
  lead: "Londoners pulled down houses to make gaps in the streets.",
  points: [],
  icon: null,
  cards: [
    {
      kind: "word",
      label: "Key word",
      term: "Firebreak",
      meaning: "A gap that stops flames reaching more houses across it.",
      examples: null,
      num: null,
      unit: null,
    },
  ],
  figure: {
    shows: "Reconstruction of a firebreak during the Great Fire",
    must_see: ["gap between houses", "pulled-down timbers", "flames at one side"],
    subject: "generic",
  },
};

const STAGE_OF = { KS1: "KS1", KS2: "KS2", KS3: "KS3-5" } as const;
const KS = { KS1: "ks1", KS2: "ks2", KS3: "ks3" } as const;
const request = (ks: keyof typeof STAGE_OF) =>
  pilotRequest(
    PILOT_PACK_ID,
    ks,
    writerSchema(STAGE_OF[ks], { min: 9, max: 12 }, writerBundle("base4f-p123"), { objectives: 3 }),
    (sc) => libSchema(sc, ["test-model"]),
  );

/** Laid out with a landscape picture (the field the caps are measured on) or the run's own. */
const ctxFor = (s: S, theme: string, stage: string, aspect = 1.5) =>
  ({
    brief: { keyStage: stage, year: 2, theme } as never,
    theme: getTheme(theme, stage),
    stage,
    index: 8,
    plan: { flow: [], slides: [s] },
    visual: (k: string) =>
      k === "figure" || k === "picture"
        ? { status: "photo", photo: { src: "/files/fire.png", alt: "fire", aspect } }
        : { status: "pending" },
  }) as never;
const lay = (s: S, theme: string, stage: string, aspect = 1.5) =>
  materialise(s, ctxFor(s, theme, stage, aspect));
const columnOver = (m: ReturnType<typeof lay>) =>
  m.over.filter((o) => o.startsWith("picture-text column "));

const SRC =
  "Londoners pulled down houses to make gaps in the streets so the flames had nothing left to burn and the fire slowed down".split(
    " ",
  );
const words = (n: number) => `${SRC.slice(0, n).join(" ")}.`;

describe("TEACH-247 part co: a key card slide fits the column it is written for", () => {
  test("the run's slide 9 overflowed its column on Crayon at KS1 (the reproduction)", () => {
    // The run's picture (395 x 418 field): the column ran to 529pt, as logged.
    expect(columnOver(lay(S9, "crayon", "ks1", 395 / 418))).toEqual([
      "picture-text column 529/497pt",
    ]);
  });

  test("slot-fill took it as written: no cap it was given measured the card with the lead", () => {
    const r = request("KS1");
    const a = slotFillArrival(structuredClone(S9), "KS1", r.schema, r.caps, true);
    expect(a.route).toBe("as-written");
    // The lead held to the plain look's 26 and the meaning to the gold's 16: 20 words together
    // where the column holds the lead and one meaning at KEY_FIT's room each.
    expect(a.fields.find((f) => f.path === "lead")?.capWords).toBe(26);
    expect(KEY_FIT.KS1.words["1"]).toBeLessThan(10);
  });

  for (const ks of ["KS1", "KS2", "KS3"] as const)
    test(`${ks}: at the measured room the column fits on every theme and is never sent back`, () => {
      const n = KEY_FIT[STAGE_OF[ks]].words["1"];
      const full: S = {
        ...S9,
        lead: words(n),
        cards: [{ ...(S9.cards as S[])[0], term: "Thick sticky magma", meaning: words(n) }],
      };
      const over = THEMES.flatMap((t) => [
        ...columnOver(lay(full, t.id, KS[ks])).map((o) => `${t.id}: ${o}`),
        ...pilotOvers(full, ctxFor(full, t.id, KS[ks])).overs.map((o) => `${t.id}: ${o.path}`),
      ]);
      expect(over).toEqual([]);
    });

  test("the fit sends the lead and meaning back to the writer once; code cuts nothing", async () => {
    const ctx = ctxFor(S9, "crayon", "ks1", 395 / 418);
    const at = pilotOvers(S9, ctx);
    expect(at.overs.map((o) => [o.path, o.words, o.clipped])).toEqual([
      ["lead", 10, false],
      ["cards.0.meaning", 10, false],
    ]);
    const room = KEY_FIT.KS1.words["1"];
    // Faults in words, as a pack's repair reads them.
    expect(overFault(at.overs[0] as never, true)).toBe(
      `overflow: lead is 10 words, room about ${room}`,
    );
    let asked: string[] = [];
    const rewritten = {
      ...S9,
      lead: "Londoners pulled down houses.",
      cards: [{ ...(S9.cards as S[])[0], meaning: "A gap that stops the flames." }],
    };
    const r = await fitPilot(
      S9,
      ctx,
      async (_s, faults) => {
        asked = faults;
        return rewritten;
      },
      true,
    );
    expect(asked).toHaveLength(2);
    expect(r.path).toBe("repaired");
    expect(columnOver(lay(r.slide, "crayon", "ks1", 395 / 418))).toEqual([]);
    // No repair (or a failed one): the slide keeps every word; nothing is cut by code.
    const kept = await fitPilot(S9, ctx, undefined, true);
    expect(kept.slide).toEqual(S9);
    expect(kept.cut ?? []).toEqual([]);
  });

  test("a key card slide that fits is never sent back, whatever its counts", () => {
    const fits = { ...S9, lead: "Houses came down." };
    expect(pilotOvers(fits, ctxFor(fits, "crayon", "ks1", 395 / 418)).overs).toEqual([]);
  });
});
