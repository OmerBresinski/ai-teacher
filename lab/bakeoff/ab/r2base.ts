// D13: base3's drawer specs (full runs' diagrams.jsonl) checked locally the way R2 checks the writer's specs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  dropNulls,
  mendSpec,
  parseDiagram,
  withLongLabels,
} from "../../../packages/slides/src/diagrams/index";
import { slotBox, slotOf } from "../../../packages/slides/src/diagrams/limits";
import { fromMeaning } from "../../../packages/slides/src/diagrams/meaning";
import type { DiagramAsk } from "../services";
import { diagramFaultOf, slotFault } from "../services";
import { AB } from "./arms";
import { R2_KINDS } from "./r2";

/** The drawer's saved spec (drawn or meaning form) checked as the layout will draw it: parse, then its slot. */
const drawFault = (spec: unknown, ask: DiagramAsk) => {
  const out = mendSpec(fromMeaning(dropNulls(spec)));
  return diagramFaultOf(out, (o) => withLongLabels(() => parseDiagram(o))) || slotFault(out, ask);
};
for (const tag of process.argv.slice(2)) {
  let n = 0,
    ok = 0,
    total = 0;
  const faults: string[] = [];
  for (const b of readdirSync(`${AB}/runs/${tag}/T`)) {
    const d = `${AB}/runs/${tag}/T/${b}`;
    const brief = JSON.parse(readFileSync(`${d}/brief.json`, "utf8"));
    const w = JSON.parse(JSON.parse(readFileSync(`${d}/main.json`, "utf8")).text);
    const starts = readFileSync(`${d}/log.jsonl`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.ev === "diagram-start" && (R2_KINDS as readonly string[]).includes(e.kind));
    total += starts.length;
    const specs = existsSync(`${d}/diagrams.jsonl`)
      ? readFileSync(`${d}/diagrams.jsonl`, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    for (const s of specs) {
      if (!(R2_KINDS as readonly string[]).includes(s.kind)) continue;
      const i = Number(String(s.key).split(":")[0]);
      const tpl = String(w.slides[i - 2]?.template ?? "visual-text");
      const slot = slotOf(tpl);
      const box = slotBox(brief.keyStage, slot);
      const ask: DiagramAsk = {
        key: s.key,
        kind: s.kind,
        shows: "",
        labels: [],
        words: "",
        yearGroup: brief.yearGroup,
        stage: brief.keyStage,
        theme: brief.teacherTheme ?? brief.theme,
        slot: {
          placement: slot === "full" ? "across the slide" : "beside text",
          w: box.w,
          h: box.h,
          name: slot,
        },
      };
      n++;
      const fault = drawFault(s.spec, ask);
      if (!fault) ok++;
      else faults.push(`${b.slice(0, 3)} ${s.key} ${s.kind} ${slot}: ${fault.slice(0, 100)}`);
    }
  }
  console.log(
    tag,
    `structured requests ${total}, drawer specs ${n}, draw locally in their slot ${ok}`,
  );
  for (const f of faults) console.log("  ", f);
}
