import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endDrawThread } from "../library/guard";
import type { DrawerCall } from "./diagrams";
import type { Brief } from "./fixes";
import { recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part cp: a flow that cannot be drawn leaves its slide with no visual. Part cn fixed one
 * cause (a width check on a face no theme uses), but a flow has no recovery: when the writer's spec
 * and the drawer's two tries fail for a real reason, the slide ends `diagram-done ok:false
 * via:none` and ships text-only. A picture is no honest substitute (`MEANING_KINDS`: its arrows
 * are the meaning). Like a lost picture (pictureLost's reroute), the flow now goes back to the
 * writer once, told why it did not draw, and must come back as a flow; code draws its spec.
 *
 * The slide is v4.21a Y8 photosynthesis s4 as the writer wrote it (genlab run
 * 20261102-171851-record-y8-photosynthesis-r1-v421a, the same slide part cn tests), with the one
 * change that makes the failure real: the arrow carries a phrase no arrow holds, and the drawer
 * keeps it on the arrow on both tries, as it kept "photosynthesis" in the run.
 */
const LONG = "light energy is trapped and turned into chemical energy";
const SLIDE4 = {
  template: "visual-text",
  fit: "points-1-key-fig",
  heading: "The word equation",
  lead: "Plants use light energy to make glucose from carbon dioxide and water. Oxygen is also produced.",
  points: [{ kind: "key-point", text: "Carbon dioxide + water → glucose + oxygen" }],
  figure: {
    kind: "flow",
    shows: "The reactants and products of photosynthesis.",
    alt: "Carbon dioxide and water lead to glucose and oxygen.",
    title: null,
    nodes: ["Carbon dioxide + water", "Glucose + oxygen"],
    links: [{ from: 0, to: 1, label: LONG }],
  },
};

/** The drawer's two tries, shaped as the run's (cassette bodies 0006, 0011), the phrase kept. */
const DRAWER = [
  {
    kind: "flow",
    alt: "Photosynthesis uses carbon dioxide and water to make glucose, with oxygen also produced.",
    title: "Photosynthesis word equation",
    layout: "chain",
    steps: [{ label: "Carbon dioxide + water" }, { label: "Glucose + oxygen" }],
    links: [{ from: 0, to: 1, label: LONG }],
  },
  {
    kind: "flow",
    title: "Photosynthesis",
    alt: "Carbon dioxide and water are used to make glucose, and oxygen is produced.",
    layout: "chain",
    steps: [{ label: "Carbon dioxide + water", arrow: LONG }, { label: "Glucose + oxygen" }],
    links: [{ from: 0, to: 1 }],
  },
];

const B = "y8-french-my-family";
const read = (f: string) => readFileSync(join(import.meta.dir, "fixtures/replay", B, f), "utf8");

type E = Record<string, unknown>;
/** The lesson with the run's slide in writer slide 2, the drawer's tries and `repaired` as the writer's repair. */
async function run(repaired: unknown) {
  const brief = JSON.parse(read("brief.json")) as Brief;
  const objectives = (
    JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
  ).objectives.map((o) => o.teacher);
  const main = JSON.parse(read("main.json")) as { text: string; finishReason?: string };
  const out = JSON.parse(main.text) as { slides: unknown[] };
  out.slides[1] = structuredClone(SLIDE4);
  let drawerCalls = 0;
  const callDrawer: DrawerCall = async (req) => {
    if (!JSON.stringify(req).includes("Glucose")) return { out: undefined };
    return { out: DRAWER[drawerCalls++] ?? DRAWER[1] };
  };
  const repairs: string[] = [];
  const base = replayServices(B);
  const events: E[] = [];
  const lesson = await runWriter({
    brief,
    objectives,
    services: {
      ...base,
      log: (e) => events.push(e as E),
      chat: async (r) => {
        if (r.name === "slide" && r.user.includes(LONG)) {
          repairs.push(r.user);
          return { out: repaired, usd: 0, ms: 0 };
        }
        return base.chat(r);
      },
    },
    visual: recordedVisuals(B),
    recordedWriter: { text: JSON.stringify(out), finishReason: main.finishReason ?? null },
    drawDiagrams: { callDrawer },
    library: true,
    checks: "log",
  });
  const at = lesson.slides.findIndex((x) => JSON.stringify(x.elements).includes(SLIDE4.heading));
  const ev = events.filter((e) => e.slide === at + 1);
  const drawn = (lesson.slides[at]?.elements ?? []).filter(
    (e) => (e as { name?: string }).name === "Diagram",
  ) as { src?: string }[];
  return { at, ev, drawn, repairs, drawerCalls };
}

/** The writer's rewrite: the same slide, the arrow's words in its room, the rest kept. */
const REWRITTEN = structuredClone(SLIDE4);
REWRITTEN.figure.links = [{ from: 0, to: 1, label: "photosynthesis" }];

describe("a flow that cannot be drawn goes back to the writer, never to words (TEACH-247 part cp)", () => {
  afterAll(() => endDrawThread());

  test("the drawer fails for a real reason; the writer's rewritten flow is drawn by code", async () => {
    const r = await run({ slide: REWRITTEN, to_notes: "", fix: "shorter arrow label" });
    expect(r.at).toBeGreaterThan(-1);
    // The failure is real: the writer's spec and both drawer tries fail on the arrow's words.
    expect(r.ev).toContainEqual(expect.objectContaining({ ev: "r2-spec-fault" }));
    expect(r.drawerCalls).toBe(2);
    expect(r.ev).toContainEqual(
      expect.objectContaining({ ev: "diagram-done", via: "none", ok: false }),
    );
    // One repair call, told why the drawing failed (the drawer's own fault line).
    expect(r.repairs).toHaveLength(1);
    expect(r.repairs[0]).toContain("figure could not be drawn");
    expect(r.repairs[0]).toContain("too wide");
    expect(r.ev).toContainEqual(
      expect.objectContaining({ ev: "meaning-rerouted", kind: "flow", ok: true }),
    );
    expect(r.ev).toContainEqual(
      expect.objectContaining({ ev: "visual-path", path: "diagram-repaired" }),
    );
    expect(r.ev.filter((e) => e.ev === "unshown-text-only")).toEqual([]);
    // The flow is on the slide, drawn by code from the writer's rewrite.
    expect(r.drawn).toHaveLength(1);
    expect(decodeURIComponent(r.drawn[0]?.src ?? "")).toContain("photosynthesis");
  }, 60_000);

  test("a rewrite that trades the flow for a picture is refused; the slide stands in words", async () => {
    const { figure: _f, ...rest } = REWRITTEN;
    const asPicture = {
      ...rest,
      figure: { shows: "A green leaf in sunlight", must_see: ["leaf"], subject: "generic" },
    };
    const r = await run({ slide: asPicture, to_notes: "", fix: "picture" });
    expect(r.repairs).toHaveLength(1);
    expect(r.ev).toContainEqual(expect.objectContaining({ ev: "repair-rejected" }));
    expect(r.ev).toContainEqual(
      expect.objectContaining({ ev: "meaning-rerouted", kind: "flow", ok: false }),
    );
    // As before the change: no picture stands in for the flow.
    expect(r.ev).toContainEqual(expect.objectContaining({ ev: "visual-path", path: "unshown" }));
    expect(r.drawn).toHaveLength(0);
  }, 60_000);
});
