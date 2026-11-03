import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualState } from "./materialise";
import { replayServices } from "./replay-fixture";
import { lostable, runWriter } from "./stage";

/*
 * TEACH-247 part cy (rivers v4.21b s8): a stages strip shows a picture on every stage or on none.
 * Stage 4's picture was still out when its slide's wait ended, the stage logged the slide as
 * "picture-placed", and the set's panels were never in the lost-picture retry, so the strip
 * shipped as numbered text with three judged pictures made. Here: the y1 animals replay with its
 * slide 6 swapped for the human writer's stages slide (chick, young hen, hen), as in part bx.
 */
type S = Record<string, unknown>;
const B = "y1-science-animals-young";
const read = (f: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", f), "utf8")) as unknown;
const STAGES = (read("human-writer-y1-slides.json") as S[]).find((s) => s.template === "stages");
const AT = 5;
/** Its place in the run's deck: the stage adds the objectives slide and the hook before it. */
const DECK = AT + 2;
const text = (() => {
  const o = JSON.parse((read(`replay/${B}/main.json`) as { text: string }).text) as {
    slides: S[];
  };
  o.slides[AT] = STAGES as S;
  return JSON.stringify(o);
})();
const picture = (shows: string) => ({ shows, must_see: [shows], subject: "generic" });
/** Rivers pr754 s4: a panel list whose rows each ask a picture. */
const PANEL_LIST = {
  template: "panel-list",
  heading: "How young animals change",
  lead: null,
  panel: null,
  items: ["Chick", "Pullet", "Hen", "Rooster"].map((name) => ({
    name,
    text: `The ${name.toLowerCase()} is one stage.`,
    icon: null,
    picture: picture(`A ${name.toLowerCase()}`),
  })),
};
const panelText = (() => {
  const o = JSON.parse((read(`replay/${B}/main.json`) as { text: string }).text) as {
    slides: S[];
  };
  o.slides[AT] = PANEL_LIST;
  return JSON.stringify(o);
})();
const photo = (i: number, k: string): VisualState => ({
  status: "photo",
  photo: { src: `https://img.test/${i}-${k}.png`, alt: k, aspect: 1, request: k } as never,
});

type Opts = {
  /** May the gap be asked again (it ran out of time)? */
  retryable: boolean;
  /** Does the one remake land? */
  remakeLands: boolean;
  /** Stage 2 is still pending when the slide's own wait ends (the early job's look). */
  slideDone?: boolean;
  /** A panel list, not a strip: its `row.1` is the picture still out at the early wait. */
  panelList?: boolean;
  /** The picture still out lands by the settle. */
  landsAtSettle?: boolean;
};
const run = async (o: Opts) => {
  const events: S[] = [];
  const retried: string[] = [];
  let settled = false;
  let remade = false;
  const gap = `${DECK}:${o.panelList ? "row.1" : "stage.2"}`;
  const out = await runWriter({
    brief: read(`replay/${B}/brief.json`) as Brief,
    objectives: (
      read(`replay/${B}/objectives.json`) as { objectives: { teacher: string }[] }
    ).objectives.map((x) => x.teacher),
    checks: "log",
    services: {
      ...replayServices(B),
      log: (e: object) => {
        events.push(e as S);
      },
      writer: async () => ({
        text: o.panelList ? panelText : text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual: (i: number, k: string, a: { type: string }) => {
      if (a.type !== "photo") return { status: "failed" };
      if (`${i}:${k}` !== gap) return photo(i, k);
      if (remade || (o.landsAtSettle && settled)) return photo(i, k);
      return settled ? { status: "failed" } : { status: "pending" };
    },
    beforeEditable: async () => {
      // The round's settle comes after the slide's own wait has ended and its early job looked.
      if (o.slideDone) await new Promise((r) => setTimeout(r, 20));
      settled = true;
    },
    ...(o.slideDone ? { slideDone: async () => {} } : {}),
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("drawer down");
      },
    },
    drawAs: () => "process",
    retryable: (i: number, k: string) => o.retryable && `${i}:${k}` === gap,
    placeMore: async (i: number, more: { key: string }[]) => {
      for (const a of more) retried.push(`${i}:${a.key}`);
      if (o.remakeLands) remade = true;
    },
  } as never);
  const slide = out.slides.find((s) => s.id === `s${DECK + 1}`);
  const pictures = JSON.stringify(slide?.elements ?? []).match(/https:\/\/img\.test\/[^"]+/g) ?? [];
  return { out, events, retried, pictures: [...new Set(pictures)] };
};
const at = (events: S[], ev: string) => events.filter((e) => e.ev === ev && e.slide === DECK + 1);

describe("a stages set with one gap (TEACH-247 part cy)", () => {
  test("the gap is made again once, alone, and the strip shows every stage's picture", async () => {
    const { retried, pictures, events } = await run({ retryable: true, remakeLands: true });
    // Only the lost panel is asked again, once, and never handed to the drawer.
    expect(retried).toEqual([`${DECK}:stage.2`]);
    expect(pictures).toHaveLength(3);
    expect(at(events, "lost-picture")).toEqual([
      expect.objectContaining({ ok: true, landed: 1, asked: 1 }),
    ]);
  });

  test("a slide with a stage still out at its early wait is not logged as placed", async () => {
    const { retried, pictures, events } = await run({
      retryable: true,
      remakeLands: true,
      slideDone: true,
    });
    expect(at(events, "lost-early-landed")).toEqual([]);
    expect(at(events, "lost-early-partial")).toEqual([
      expect.objectContaining({ placed: 2, asked: 3 }),
    ]);
    // The tail then makes the gap again, once.
    expect(retried).toEqual([`${DECK}:stage.2`]);
    expect(pictures).toHaveLength(3);
  });

  test("a gap that cannot be made again goes to the writer's reroute, never logged as placed", async () => {
    const { retried, events } = await run({ retryable: false, remakeLands: false });
    expect(retried).toEqual([]);
    const paths = events.filter((e) => e.ev === "visual-path" && e.slide === DECK + 1);
    expect(paths.map((e) => e.path)).not.toContain("picture-placed");
    expect(paths.map((e) => String(e.path))).toEqual([expect.stringMatching(/^picture-/)]);
    expect(events.some((e) => e.ev === "repair" && e.slide === DECK + 1)).toBe(true);
  });

  test("when the reroute cannot rewrite it, the strip's pictures really go and the log says so", async () => {
    // The replay has no writer answer for this rewrite, so restage takes its fixed fallback.
    const { out, events, pictures } = await run({ retryable: false, remakeLands: false });
    expect(at(events, "restage-fallback")).toEqual([
      expect.objectContaining({ how: "stage-pictures-dropped" }),
    ]);
    const paths = events.filter((e) => e.ev === "visual-path" && e.slide === DECK + 1);
    expect(paths.map((e) => e.path)).toEqual(["picture-stage-pictures-dropped"]);
    // What the teacher sees: no stage asks a picture, and none is drawn.
    const slide = out.slides.find((s) => s.id === `s${DECK + 1}`);
    const input = JSON.stringify(slide?.elements ?? []);
    expect(input).not.toContain('"picture":{');
    expect(pictures).toEqual([]);
  });
});

describe("a slide that is not a stages strip keeps master's route (rivers pr754 s4)", () => {
  test("a panel list with a picture still out at its wait is not partial and nothing is made again", async () => {
    const { retried, events, pictures } = await run({
      retryable: true,
      remakeLands: false,
      slideDone: true,
      panelList: true,
      landsAtSettle: true,
    });
    expect(at(events, "lost-early-partial")).toEqual([]);
    expect(at(events, "lost-early-landed")).toHaveLength(1);
    expect(retried).toEqual([]);
    expect(pictures).toHaveLength(4);
  });
});

describe("which pictures count towards a slide being placed (TEACH-247 part cy)", () => {
  const photoAsk = (key: string, over: object = {}) =>
    ({ key, type: "photo", shows: key, mustSee: [], named: false, ...over }) as never;
  test("a single picture and a stages panel count; a card, a fixed shape and a sequence set do not", () => {
    expect(lostable(photoAsk("picture"))).toBe(true);
    expect(lostable(photoAsk("stage.0", { set: "stages" }))).toBe(true);
    expect(lostable(photoAsk("card.0"))).toBe(false);
    expect(lostable(photoAsk("figure", { fixedShape: true }))).toBe(false);
    expect(lostable(photoAsk("seq.0", { set: "seq" }))).toBe(false);
  });
});
