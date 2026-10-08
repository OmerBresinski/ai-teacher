import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeAi } from "@tj/ai/testing";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { getTheme } from "@tj/slides/themes";
import { createWriterPictures } from "../stages/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import { materialise, type Plan, type VisualState, visualsOf } from "./materialise";

/* TEACH-251 part b on P2b's materialise: no slot is a placeholder once pictures settle. */
describe("writer pictures on the writer's own layout", () => {
  const out = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/writer-outputs/1-base4-3.json"), "utf8"),
  ) as { text: string };
  const plan = JSON.parse(out.text) as Plan;
  const brief = { ...sampleBriefLesson().brief, keyStage: "KS1" } as never;
  const base = {
    brief,
    theme: getTheme(undefined as never, "KS1" as never),
    stage: "KS1" as never,
  };
  const placeholders = (visual: (i: number, key: string) => VisualState) => {
    let n = 0;
    let photoAsks = 0;
    plan.slides.forEach((s, i) => {
      if (!s) return;
      const asks = visualsOf(s, i, { ...base, plan });
      photoAsks += asks.filter((a) => a.type === "photo" && !a.set).length;
      const m = materialise(s, { ...base, index: i, plan, visual: (k) => visual(i, k) });
      const walk = (els: { type: string; src?: string; children?: unknown[] }[]) => {
        for (const e of els) {
          if (e.type === "image" && e.src === PLACEHOLDER_IMAGE) n++;
          if (Array.isArray(e.children)) walk(e.children as never);
        }
      };
      walk(m.slide.elements as never);
    });
    return { n, photoAsks };
  };

  test("pending slots are placeholders (control); after settle with no pictures there are none", async () => {
    const control = placeholders(() => ({ status: "pending" }));
    expect(control.photoAsks).toBeGreaterThan(0);
    expect(control.n).toBeGreaterThan(0);
    // Every picture a historical person with no Commons hit: nothing found, nothing generated.
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: {
        search: async () => [],
        searchCommons: async () => [],
        store: async () => ({}) as never,
      },
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => ({
        route: "commons",
        pictures: [{ shows: "x", mustShow: [], queries: ["x"], imagePrompt: "x" }],
        count: null,
        diagram: null,
        named: "person",
        period: "1066",
      }),
    });
    plan.slides.forEach((s, i) => {
      if (!s) return;
      for (const a of visualsOf(s, i, { ...base, plan }))
        if (a.type === "photo") pictures.start(i, a, { heading: "", text: "", point: "" });
    });
    await pictures.settle(2_000);
    const after = placeholders((i, k) => {
      const st = pictures.state(i, k);
      // Diagrams are P3's: they are not this check's subject.
      return st as VisualState;
    });
    const diagramsOnly = placeholders((i, k) => {
      const s = plan.slides[i];
      const a = s ? visualsOf(s, i, { ...base, plan }).find((x) => x.key === k) : undefined;
      return a?.type === "diagram" ? { status: "pending" } : { status: "failed" };
    });
    // The only placeholders left are diagram slots (drawn by P3), never a picture box.
    expect(after.n).toBe(diagramsOnly.n);
    expect(after.n).toBeLessThan(control.n);
  });
});
