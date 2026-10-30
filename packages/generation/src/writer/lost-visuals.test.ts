import { describe, expect, test } from "bun:test";
import { dropNulls, parseDiagram, RIVER_PARTS, slotBox } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import {
  type DrawerCall,
  diagramAskOf,
  diagramFaultOf,
  drawWriterDiagram,
  layoutSlotProbe,
  questionSafe,
  writerDiagramElement,
} from "./diagrams";
import { tilesAsPictures } from "./fallbacks";
import rivers from "./fixtures/rivers-v6-lost-visuals.json" with { type: "json" };
import splitFixtures from "./fixtures/split-side-diagrams.json" with { type: "json" };
import { materialise, type Plan, tileDiagramKeys, wordsOf } from "./materialise";
import { slideHidesAnswer } from "./role";
import { writerSlot } from "./stage";

/*
 * TEACH-247 part cg: the two visuals the Rivers v6 replay lost (genlab replay-v6-rivers-master,
 * `scratchpad/design-pass/RIVERS-LOST-VISUALS.md`), with the writer's own slides as fixtures.
 * B (deck 6, split compare): the sides are checked at generation where they draw, and a side the
 * template cannot draw is reported, never shipped as words while the stage logs "diagram".
 * A (deck 7, practice): the drawer is held to the view's own parts and letters the labels.
 */
type S = Record<string, unknown>;
const split = rivers.split as unknown as S;
const practice = rivers.practice as unknown as S;
const theme = getTheme("paper", "ks3");
const stage = "ks3";
const brief = { ...sampleBriefLesson().brief, keyStage: "KS3" } as never;
const ctx = { brief, theme, stage: stage as never };
const MEANDER = [...RIVER_PARTS["meander-section"]];

/** The stage's ask for one of a slide's figures (`stage.ts` diagramAsk), with its slot. */
const askOf = (s: S, key: string, f: S, question = slideHidesAnswer(s)) => {
  const slot = writerSlot(s);
  const box = slotBox(stage, slot);
  return diagramAskOf(key, f, {
    words: wordsOf(s),
    yearGroup: "Year 8",
    stage,
    slot: {
      placement: slot === "full" ? "across the slide" : "beside text",
      w: box.w,
      h: box.h,
      name: slot,
    },
    question,
  });
};
const noCall: DrawerCall = async () => {
  throw new Error("no model call expected");
};
const deps = (callDrawer: DrawerCall, log?: (e: S) => void) => ({
  callDrawer,
  drawerSystem: "SYSTEM",
  theme,
  probe: layoutSlotProbe,
  ...(log ? { log } : {}),
});
const sidePic = (n: number) => ((split.sides as S[])[n] as S).picture as S;
const images = (els: readonly unknown[]): { type: string; src?: string }[] =>
  (els as { type: string; src?: string; children?: unknown[] }[]).flatMap((e) =>
    e.type === "group" && Array.isArray(e.children) ? images(e.children) : [e],
  );
const svgs = (els: readonly unknown[]) =>
  images(els).filter((e) => e.type === "image" && (e.src ?? "").startsWith("data:image/svg"));

describe("B: a split side's drawing is checked where it draws (Rivers v6 s6)", () => {
  test("a split compare's drawings take the split-side slot", () => {
    expect(writerSlot(split)).toBe("split-side");
    expect(writerSlot({ template: "diagram-text" })).toBe("side");
  });

  test("the writer's two river sides draw by code, with no drawer call, and both are laid", async () => {
    const specs: unknown[] = [];
    for (const n of [0, 1]) {
      const r = await drawWriterDiagram(askOf(split, `side.${n}`, sidePic(n)), deps(noCall));
      expect(r).toMatchObject({ via: "code", fault: "" });
      specs.push(r.spec);
    }
    const m = materialise(split, {
      ...ctx,
      index: 5,
      plan: { slides: [] } as unknown as Plan,
      visual: (k) => ({ status: "diagram", spec: specs[Number(k.split(".")[1])] }) as never,
    });
    expect(m.diagram).toBeUndefined();
    expect(m.lost).toBeUndefined();
    expect(svgs(m.slide.elements)).toHaveLength(2);
  });

  test("a side spec the template cannot draw is a fault at generation, retried with it, never ok", async () => {
    // A forces drawing whose labels overlap at side size (TEACH-110 part ad's fixture).
    const crowded = ((splitFixtures["20261016-1221-s3"].sides[0] as S).picture as S).diagram as S;
    expect(layoutSlotProbe(crowded, "split-side", stage, theme, "Banks of a meander")).not.toEqual(
      [],
    );
    const events: S[] = [];
    const users: string[] = [];
    // The drawer sends the crowded drawing back both times: the side is never accepted.
    const again: DrawerCall = async (req) => {
      users.push(req.user);
      return { out: crowded };
    };
    const ask = askOf(split, "side.0", { ...crowded, shows: "Forces on a box" });
    const r = await drawWriterDiagram(
      ask,
      deps(again, (e) => events.push(e)),
    );
    const calls = events.filter((e) => e.ev === "diagram-call");
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(String(c.fault)).toContain("does not fit its slot (366 by 250");
    expect(users).toHaveLength(2);
    expect(users[1]).toContain("Your last spec did not draw: it does not fit its slot");
    expect(r.via).toBe("none");
    expect(r.spec).toBeUndefined();
    // A drawer reply that draws at the side is taken.
    const fixed: DrawerCall = async () => ({ out: sidePic(0) });
    const r2 = await drawWriterDiagram(ask, deps(fixed));
    expect(r2.via).toBe("drawer");
  });

  test("a side the layout drops is reported by its key, and becomes a picture of the same thing", () => {
    const crowded = ((splitFixtures["20261016-1221-s3"].sides[0] as S).picture as S).diagram as S;
    const m = materialise(split, {
      ...ctx,
      index: 5,
      plan: { slides: [] } as unknown as Plan,
      visual: (k) =>
        ({ status: "diagram", spec: k === "side.0" ? crowded : dropNulls(sidePic(1)) }) as never,
    });
    expect(m.diagram?.length).toBeGreaterThan(0);
    expect(m.lost).toEqual(["side.0"]);
    expect(svgs(m.slide.elements)).toHaveLength(0);
    expect(tileDiagramKeys(split)).toEqual(["side.0", "side.1"]);
    const pic = tilesAsPictures(split, ["side.0"]) as S;
    const side0 = (pic.sides as S[])[0]?.picture as S;
    expect(side0).toMatchObject({
      shows: "Cross-section highlighting the steep outer bank of a meander.",
      must_see: ["River cliff"],
    });
    expect((pic.sides as S[])[1]?.picture).toEqual(sidePic(1));
  });
});

describe("A: a practice figure draws with lettered labels (Rivers v6 s7)", () => {
  const figure = practice.picture as S;

  test("the river fault names the view's own parts", () => {
    const fault = diagramFaultOf({ ...figure, title: undefined }, parseDiagram);
    expect(fault).toContain("no channel in a meander-section; its parts are");
    for (const p of MEANDER) expect(fault).toContain(p);
  });

  test("questionSafe letters a river's labels on a question slide", () => {
    const spec = {
      kind: "river",
      alt: "x",
      view: "meander-section",
      labels: [
        { part: "river-cliff", text: "River cliff" },
        { part: "slip-off-slope", text: "Slip-off slope" },
      ],
    };
    expect((questionSafe(spec).labels as S[]).map((l) => l.text)).toEqual(["A", "B"]);
    expect((questionSafe(spec).labels as S[]).map((l) => l.part)).toEqual([
      "river-cliff",
      "slip-off-slope",
    ]);
  });

  test("the drawer is held to the view's parts, retried with them, and its lettered figure draws", async () => {
    expect(slideHidesAnswer(practice)).toBe(true);
    const reqs: Parameters<DrawerCall>[0][] = [];
    // The run's own first reply (live-7): the drawer obeyed "unlabelled" and sent no labels.
    const call: DrawerCall = async (req) => {
      reqs.push(req);
      return reqs.length === 1
        ? {
            out: {
              kind: "river",
              alt: "A meander cross-section",
              view: "meander-section",
              labels: [],
            },
          }
        : {
            out: {
              kind: "river",
              alt: "A meander cross-section",
              view: "meander-section",
              labels: [
                { part: "river-cliff", text: "A" },
                { part: "slip-off-slope", text: "B" },
              ],
            },
          };
    };
    const r = await drawWriterDiagram(askOf(practice, "picture", figure), deps(call));
    expect(reqs).toHaveLength(2);
    const schema = reqs[0]?.schema as S;
    const props = schema.properties as Record<string, S>;
    expect(props.view?.enum).toEqual(["meander-section"]);
    const items = (props.labels as S).items as S;
    const part = (items.properties as Record<string, S>).part;
    expect(part?.enum).toEqual(MEANDER);
    expect(reqs[0]?.user).toContain(`Parts of a meander-section: ${MEANDER.join(", ")}`);
    expect(reqs[0]?.user).toContain("label each part with a letter (A, B, C) in place of its name");
    expect(reqs[1]?.user).toContain("Your last spec did not draw: labels:");
    expect(r).toMatchObject({ via: "drawer", fault: "" });
    expect(((r.spec as S).labels as S[]).map((l) => l.text)).toEqual(["A", "B"]);
    expect(writerDiagramElement(r.spec, theme, stage, { x: 0, y: 0, w: 400, h: 300 })).toBeTruthy();
    // Laid on the practice slide: the figure is on it.
    const m = materialise(practice, {
      ...ctx,
      index: 6,
      plan: { slides: [] } as unknown as Plan,
      visual: () => ({ status: "diagram", spec: r.spec }) as never,
    });
    expect(m.diagram).toBeUndefined();
    expect(svgs(m.slide.elements).length).toBeGreaterThan(0);
  });

  test("a drawer reply that names the answers is lettered before it is stored", async () => {
    const call: DrawerCall = async () => ({
      out: {
        kind: "river",
        alt: "A meander cross-section",
        view: "meander-section",
        labels: [{ part: "river-cliff", text: "River cliff" }],
      },
    });
    const r = await drawWriterDiagram(askOf(practice, "picture", figure), deps(call));
    expect(r.via).toBe("drawer");
    expect(((r.spec as S).labels as S[])[0]).toEqual({ part: "river-cliff", text: "A" });
  });
});
