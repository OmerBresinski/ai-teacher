// Replays every pinned writer output through the stage with the checker flags off, then each flag
// on alone, and reports what changed (CHECKER-AUDIT, 9 Oct 2026). No model is called: a call the
// recording has no answer for fails, as a failed repair does. `bun src/writer/measure-checker.ts <out.json>`
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKER_FLAGS, type CheckerFlags } from "./checker-flags";
import { wordsOf } from "./materialise";
import { replayRun, replayServices } from "./replay-fixture";

const DIR = join(import.meta.dir, "fixtures/replay");
const runs = readdirSync(DIR).sort();
const arms: [string, CheckerFlags][] = [
  ["off", {}],
  ...CHECKER_FLAGS.map((f): [string, CheckerFlags] => [f, { [f]: true }]),
  [
    "coverage-all",
    {
      coverageCountsPictureTasks: true,
      coverageExcludesDiscussion: true,
      coverageExcludesPrediction: true,
    },
  ],
];
const out: Record<string, unknown>[] = [];
for (const b of runs)
  for (const [arm, checker] of arms) {
    const events: Record<string, unknown>[] = [];
    const calls: Record<string, number> = {};
    const misses: string[] = [];
    const base = replayServices(b);
    const services = {
      ...base,
      log: (e: object) => events.push(e as Record<string, unknown>),
      chat: async (r: Parameters<typeof base.chat>[0]) => {
        calls[r.name] = (calls[r.name] ?? 0) + 1;
        try {
          return await base.chat(r);
        } catch (e) {
          misses.push(r.name);
          throw e;
        }
      },
    };
    const res = await replayRun(b, { services, checker });
    const plan = res.plan as { slides: Record<string, unknown>[] };
    out.push({
      run: b,
      arm,
      calls,
      misses,
      events: events.filter((e) =>
        [
          "repair",
          "repair-rejected",
          "objective-repair",
          "visual-path",
          "summary",
          "point-guard",
          "duplicate-seen",
          "diagram-relaid",
          "restage-fallback",
          "figure-sync",
        ].includes(String(e.ev)),
      ),
      slides: plan.slides.map((s) => ({ template: s.template, words: s ? wordsOf(s) : "" })),
      images: res.slides.map((s) => s.elements.filter((e) => e.type === "image").length),
    });
  }
writeFileSync(process.argv[2] ?? "measure.json", JSON.stringify(out, null, 1));
console.log("runs", runs.length, "arms", arms.length);
