import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { RIVER_PARTS } from "@tj/slides/diagrams";
import { WRITER_VERSION, writerRoute } from "./ai-services";
import { withClose } from "./close";
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Pilot pack v4.17 (TEACH-247 parts ba, bb): v4.16 with three menu changes, gated to this pack.
 * 1. Reasons: the slide may carry one photo of what its question asks about (#702); only a
 *    diagram or model sends reasons to visual-text. v4.16 told the writer both "one slide, even
 *    when a picture could show each" (flow line) and "pictured reasons go to visual-text" (menu).
 * 2. The writer specs river and hydrograph itself (`writerTemplates`, #704), offered as exact
 *    drawings, not freehand sketches; the river line names the three views the templates draw.
 * 3. The freehand labelled-diagram is off the writer's menu and out of its schema (5 Oct audit
 *    item 12). The drawer, repair and director routes keep the kind.
 */
type J = Record<string, unknown>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const read = (v: string, name: string) =>
  readFileSync(new URL(`./bundles/pilot-${v}-menu/${name}`, import.meta.url), "utf8");
const V417 = PILOT_PACKS["v4.17"];
const V416 = PILOT_PACKS["v4.16"];
const OLD_PICTURED =
  "Reasons pupils learn by seeing, through a diagram or model that explains them or a picture of the thing, place or event, go to visual-text";
const NEW_ROUTE =
  "Reasons that a diagram or library model explains go to visual-text beside that figure rather than here.";

describe("pilot pack v4.17", () => {
  test("production runs v4.17", () => expect(PILOT_PACK_ID).toBe("v4.17"));

  for (const stage of STAGES) {
    const ks = KS[stage];
    const text = V417.system[ks];

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(text).toBe(read("v4.17", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: reasons offer the question picture and route only diagrams or models away`, () => {
      expect(text).not.toContain(OLD_PICTURED);
      expect(text).not.toContain("The slide carries no picture or diagram");
      expect(text).toContain(NEW_ROUTE);
      expect(text).toContain("picture is null, or one photo of the thing, place or event");
      // The flow line's one-slide rule stands, and nothing on the menu now contradicts it.
      expect(text).toContain("never a slide a reason, even when a picture could show each");
      // v4.16 is untouched.
      expect(V416.system[ks]).toContain(OLD_PICTURED);
    });

    test(`${ks}: river and hydrograph are exact drawings; no freehand labelled-diagram`, () => {
      expect(text).not.toMatch(/labelled-diagram|labelled diagram/);
      expect(text).toContain("a freehand sketch (particles, cubes)");
      expect(text).toContain("river and hydrograph among them");
      expect(text).not.toContain("a river's course with");
      expect(text).toContain("v-valley, a V-shaped valley in cross-section (");
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the schema offers the writer templates and no labelled-diagram`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const req = pilotRequest("v4.17", stage, prod, (sc) => sc);
          const sent = JSON.stringify(withClose(req.schema, exitTicketOnSlides) as J);
          expect(sent).not.toContain('"labelled-diagram"');
          expect(sent).toMatch(/#\/\$defs\/dg-river/);
          expect(sent).toMatch(/#\/\$defs\/dg-hydrograph/);
          // The reasons def carries #702's optional picture.
          const defs = (req.schema as J).$defs as Record<string, J>;
          const reasons = Object.entries(defs).find(
            ([k]) => k === "reasons" || k.startsWith("reasons~"),
          );
          expect(JSON.stringify(reasons?.[1])).toContain('"picture"');
          // v4.16 still offers labelled-diagram and no templates.
          const old = JSON.stringify(pilotRequest("v4.16", stage, prod, (sc) => sc).schema);
          expect(old).toContain('"labelled-diagram"');
          expect(old).not.toMatch(/#\/\$defs\/dg-river/);
        }
      });
    }
  }

  test("the stream contract: design and flow before the title and slides (the stage opens nothing before the flow)", () => {
    for (const stage of STAGES) {
      const prod = writerSchema(stage, Object.values(SLIDE_TIER_RANGES)[0] as never);
      const order = (v: "v4.16" | "v4.17") =>
        Object.keys((pilotRequest(v, stage, prod, (x) => x).schema as J).properties as J);
      expect(order("v4.17")).toEqual(["design", "flow", "title", "slides"]);
      expect(order("v4.17")).toEqual(order("v4.16"));
    }
  });

  test("river labels: each view's parts are on the menu", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const)
      for (const [view, parts] of Object.entries(RIVER_PARTS)) {
        const at = V417.system[ks].indexOf(`${view}, `);
        expect(at).toBeGreaterThan(-1);
        const clause = V417.system[ks].slice(at, V417.system[ks].indexOf(")", at));
        for (const p of parts) expect(clause).toContain(p);
      }
  });

  test("the writer runs Terra at low; v4.16 sets no writer model", () => {
    expect(V417.writer).toEqual({ model: "openai/gpt-6.1-terra", effort: "low" });
    expect("writer" in V416).toBe(false);
    // The route reads the call's model on the writer call only.
    const pv = `${WRITER_VERSION}/lesson`;
    const terra = "openai/gpt-6.1-terra";
    expect(writerRoute("frontier", { stage: "write", promptVersion: pv, model: terra })).toBe(
      terra,
    );
    expect(writerRoute("frontier", { stage: "write", promptVersion: pv })).toBe(
      "openai/gpt-6.1-sol",
    );
    expect(
      writerRoute("frontier", { stage: "write-frontier", promptVersion: pv, model: terra }),
    ).toBe("openai/gpt-6.1-sol");
  });

  test("the new lines name no lesson and set no quota", () => {
    const added = ["KS1", "KS2", "KS3"]
      .map((ks) => {
        const old = new Set(V416.system[ks as "KS1"].split(/\n|(?<=\.) /));
        return V417.system[ks as "KS1"]
          .split(/\n|(?<=\.) /)
          .filter((l) => !old.has(l))
          .join(" ");
      })
      .join(" ");
    expect(added).not.toMatch(/\b(Hadrian|Roman|London|1666|Severn|Thames|Tees)\b/);
    expect(added).not.toMatch(/\b(at most|no more than|in a row|per lesson|quota)\b/i);
  });
});
