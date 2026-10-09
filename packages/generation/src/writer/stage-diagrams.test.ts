import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripBuilds, svgOfDataUrl } from "@tj/slides/diagram-builds";
import type { DrawerCall } from "./diagrams";
import type { Brief } from "./fixes";
import { recordedVisuals, replayServices, savedSlides } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 end to end through the writer stage: the saved base4 runs replayed with diagrams drawn
 * by this stage (the writer's spec by code, freeform kinds through a drawer that answers with the
 * run's recorded spec). Every drawing the lab placed is placed again, byte for byte once its build
 * tags are stripped, and carries its builds.
 */
const DIR = join(import.meta.dir, "fixtures/replay");
const read = (b: string, f: string) => readFileSync(join(DIR, b, f), "utf8");
type El = Record<string, unknown>;

/** Slides (0-based) whose lab drawing was the G3 pile bug, with the rings the writer's spec asks for. */
const G3_FIXED: Record<string, Record<number, number>> = {
  "y2-maths-halves-quarters": { 5: 2, 7: 4 },
};

for (const b of [
  "y1-science-animals-young",
  "y2-maths-halves-quarters",
  "y11-chemistry-rates-of-reaction",
  "y12-psychology-multi-store-model",
]) {
  describe(`writer stage diagrams: ${b}`, () => {
    test("every diagram the lab drew is drawn again; structured specs need no drawer call", async () => {
      const brief = JSON.parse(read(b, "brief.json")) as Brief;
      const objectives = (
        JSON.parse(read(b, "objectives.json")) as { objectives: { teacher: string }[] }
      ).objectives.map((o) => o.teacher);
      const main = JSON.parse(read(b, "main.json")) as { text: string; finishReason?: string };
      const recorded = read(b, "diagrams.jsonl")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { key: string; kind: string; spec: unknown });
      const calls: string[] = [];
      // The drawer answers each freeform request, in order, with the run's recorded spec of that kind.
      const callDrawer: DrawerCall = async (req) => {
        const kind = /Kind: ([a-z-]+)/.exec(req.user)?.[1];
        const k = recorded.findIndex((r) => r.kind === kind);
        const hit = k >= 0 ? recorded.splice(k, 1)[0] : undefined;
        calls.push(hit?.kind ?? "none");
        return { out: hit?.spec };
      };
      const events: El[] = [];
      const services = replayServices(b);
      const out = await runWriter({
        brief,
        objectives,
        services: { ...services, log: (e) => events.push(e as El) },
        visual: recordedVisuals(b),
        recordedWriter: { text: main.text, finishReason: main.finishReason ?? null },
        drawDiagrams: { callDrawer },
      });
      const svgs = (els: El[]) =>
        els
          .filter((e) => e.name === "Diagram" && typeof e.src === "string")
          .map((e) => stripBuilds(svgOfDataUrl(String(e.src)) ?? ""));
      // G3 (FAULT-ORIGINS): the lab drew these slides' two hidden-count rings as one unshared pile,
      // because "Find the number in one ring" in the alt matched the pile rule. They are drawn
      // again as the writer's spec asked (two rings, "?" in each), not as the lab's wrong pile.
      const rings = G3_FIXED[b] ?? {};
      const fixed = new Set(Object.keys(rings).map(Number));
      const lab = savedSlides(b).flatMap((s, i) => (fixed.has(i) ? [] : svgs(s.elements)));
      const ours = out.slides.flatMap((s) => svgs(s.elements as El[]));
      const missing = lab.filter((svg) => !ours.includes(svg));
      for (const i of fixed) {
        const svg = svgs((out.slides[i]?.elements ?? []) as El[]).join("");
        expect(svg.match(/>\?</g)?.length, `slide ${i}`).toBe(rings[i]);
      }
      if (missing.length)
        console.log(
          b,
          events
            .filter((e) => /diagram|r2/.test(String(e.ev)))
            .map((e) => JSON.stringify(e).slice(0, 200)),
        );
      expect(missing.length).toBe(0);
      // Every drawer call (a retry included) is a freeform kind or a writer spec that did not draw;
      // a slide whose spec drew by code never calls the drawer.
      const called = events.filter((e) => e.ev === "diagram-call");
      expect(calls.length).toBe(called.length);
      const drawn = new Set(events.filter((e) => e.ev === "r2-spec-drawn").map((e) => e.slide));
      expect(called.filter((e) => drawn.has(e.slide))).toEqual([]);
      if (lab.length) expect(ours.length).toBeGreaterThan(0);
    });
  });
}
