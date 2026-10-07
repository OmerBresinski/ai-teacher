// D13 b3-r2 screen ($0, local): every diagram figure in writer-only main.json, drawn the way the harness would
// (writerSpecOf + acceptWriterSpec, no drawer call), with over-capacity and question-slide facts.
// bun lab/bakeoff/ab/r2screen.ts <runTag>... > out.jsonl
import { readdirSync, readFileSync } from "node:fs";
import {
  SLOT_LIMITS,
  slotBox,
  slotOf,
  stageGroup,
} from "../../../packages/slides/src/diagrams/limits";
import type { DiagramAsk } from "../services";
import { MAIN_LIST } from "../services";
import { AB } from "./arms";
import { acceptWriterSpec, R2_KINDS, writerSpecOf } from "./r2";

const QUESTIONS = new Set(["question-set", "practice", "hinge", "exit-ticket"]);
for (const tag of process.argv.slice(2)) {
  const dir = `${AB}/runs/${tag}/T`;
  for (const b of readdirSync(dir)) {
    const brief = JSON.parse(readFileSync(`${dir}/${b}/brief.json`, "utf8"));
    const w = JSON.parse(JSON.parse(readFileSync(`${dir}/${b}/main.json`, "utf8")).text);
    const flow = new Map(
      (w.flow ?? []).map((f: { slide: number; does: string }) => [f.slide, f.does]),
    );
    (w.slides ?? []).forEach((s: Record<string, unknown>, i: number) => {
      for (const key of ["figure", "picture"]) {
        const f = s[key] as Record<string, unknown> | undefined;
        if (!f || typeof f !== "object" || !("kind" in f)) continue;
        const kind = String(f.kind);
        const slot = slotOf(String(s.template));
        const lim = SLOT_LIMITS.limits[stageGroup(brief.keyStage)][slot][kind];
        const spec = writerSpecOf(f);
        const field = MAIN_LIST[kind];
        const n =
          spec && field && Array.isArray(spec[field])
            ? (spec[field] as unknown[]).length
            : Array.isArray(f.labels)
              ? (f.labels as unknown[]).length
              : undefined;
        const box = slotBox(brief.keyStage, slot);
        const ask: DiagramAsk = {
          key: `${i + 2}:${key}`,
          kind,
          shows: String(f.shows ?? ""),
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
        const r = spec ? acceptWriterSpec(spec, ask) : undefined;
        console.log(
          JSON.stringify({
            tag,
            brief: b,
            slide: i + 3,
            template: s.template,
            kind,
            structured: (R2_KINDS as readonly string[]).includes(kind),
            spec: !!spec,
            drawn: r ? !r.fault : null,
            fault: r?.fault || undefined,
            slot,
            n,
            cap: lim?.items,
            over: n !== undefined && lim ? n > lim.items : false,
            question: QUESTIONS.has(String(s.template)),
            does: flow.get(i + 3),
            text: [s.heading, s.lead, s.formula, ...((s.points as unknown[]) ?? [])]
              .filter(Boolean)
              .join(" | ")
              .slice(0, 300),
            f: JSON.stringify(f).slice(0, 500),
          }),
        );
      }
    });
  }
}
