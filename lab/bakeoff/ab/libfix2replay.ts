// lib arm, libfix2 ($0): re-draws a lib run's model figures from their recorded fill params
// (lib/<key>/params.json, the fill call's checked output) with the current renderer, lays each slide
// out again with the new figure, and renders it. No model calls: the fill outputs are on disk, and the
// rest of the slide is the run's own lesson.json. Prints each figure's crop, its box on the slide and
// its smallest label in slide points against the diagrams' type floor (TYPE_FLOOR).
// bun lab/bakeoff/ab/libfix2replay.ts <runDir> <outDir>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { TYPE_FLOOR } from "../../../packages/slides/src/diagrams/style";
import { layoutTemplate } from "../../../packages/slides/src/templates";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { normalise } from "../arm-t";
import { diagramContext } from "../harness";
import { renderLesson } from "../render";
import { AB } from "./arms";
import { capabilityRefusals, checkParams } from "./lib";
import { closeRenderer, renderModel } from "./librender";

type J = Record<string, unknown>;
const [runDir, out] = [process.argv[2], process.argv[3]];
if (!runDir || !out) throw new Error("usage: libfix2replay.ts <runDir> <outDir>");
const BAKEOFF = AB.replace(/\/ab$/, "");
const T = existsSync(`${runDir}/T`) ? `${runDir}/T` : runDir;
const textOf = (e: J) =>
  JSON.stringify(e.doc ?? "")
    .match(/"text":"([^"]*)"/g)
    ?.join(" ") ?? "";
const rows: J[] = [];
for (const lesson of readdirSync(T).sort()) {
  const dir = `${T}/${lesson}`;
  if (!existsSync(`${dir}/lib`)) continue;
  const brief = JSON.parse(readFileSync(`${BAKEOFF}/briefs/${lesson}.json`, "utf8")) as J;
  const stage = String(brief.keyStage);
  const doc = JSON.parse(readFileSync(`${dir}/lesson.json`, "utf8")) as J & { slides: J[] };
  const writer = JSON.parse(readFileSync(`${dir}/stream.txt`, "utf8")) as { slides: J[] };
  for (const key of readdirSync(`${dir}/lib`).sort()) {
    const rec = JSON.parse(readFileSync(`${dir}/lib/${key}/params.json`, "utf8")) as {
      model: string;
      intent: string;
      params: J;
      step?: number;
    };
    const n = Number(key.split("_")[0]);
    const slide = doc.slides[n] as J & { elements: J[] };
    const heading = textOf(slide.elements.find((e) => e.name === "Heading") ?? {});
    const w = writer.slides.find((s) => heading.includes(`"text":"${s.heading}"`));
    const check = await checkParams(rec.model, rec.params);
    const refused = [...check.refusals, ...capabilityRefusals(rec.model, rec.intent)];
    if (refused.length) {
      // The fix refuses these params: live, one repair call (paid) with these reasons, then base4's
      // drawer. At $0 neither runs, so the slide is not re-rendered; a hand-set probe of the
      // operation the repair is expected to pick shows what the model can draw.
      const probe = rec.model === "fractions" ? { ...rec.params, operation: "compare" } : undefined;
      const pd = probe
        ? await renderModel(
            rec.model,
            probe,
            `${out}/${lesson}/${key}-probe-compare`,
            rec.step,
            w ? diagramContext(w, stage.toLowerCase()).slot : undefined,
          )
        : undefined;
      const row = {
        lesson,
        key,
        model: rec.model,
        refused,
        probe: pd ? `${key}-probe-compare` : null,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      continue;
    }
    const slot = w ? diagramContext(w, stage.toLowerCase()).slot : undefined;
    const d = await renderModel(rec.model, rec.params, `${out}/${lesson}/${key}`, rec.step, slot);
    let laidImg: J | undefined;
    if (w) {
      const s = normalise({ ...w } as J);
      const input = {
        ...s,
        diagram: undefined,
        figure: { photo: d.src, alt: "", aspect: d.aspect },
      };
      const laid = withKeyStage(stage as never, () =>
        layoutTemplate(
          input as never,
          getTheme(String(doc.themeId), stage as never),
          stage as never,
        ),
      );
      laidImg = (laid.slide?.elements as J[] | undefined)?.find(
        (e) => e.type === "image" && String(e.src).startsWith("data:image/png"),
      );
    }
    const els = slide.elements.map((e) =>
      e.type === "image" && String(e.src).startsWith("data:image/png") && laidImg
        ? { ...e, ...laidImg, id: e.id, name: e.name }
        : e,
    );
    const one = { ...doc, id: `${doc.id}-${key}`, slides: [{ ...slide, elements: els }] };
    const sd = `${out}/${lesson}/${key}`;
    writeFileSync(`${sd}/lesson.json`, JSON.stringify(one));
    await renderLesson(`${sd}/lesson.json`, sd);
    const minPt =
      laidImg && d.unitW && d.minFs ? (d.minFs * Number(laidImg.w)) / d.unitW : undefined;
    const row = {
      lesson,
      key,
      model: rec.model,
      step: rec.step ?? null,
      slot: slot ? { w: slot.w, h: slot.h } : null,
      zoom: Number(d.zoom.toFixed(2)),
      crop: { w: Math.round(d.unitW ?? 0), aspect: Number(d.aspect.toFixed(2)) },
      box: laidImg ? { w: laidImg.w, h: laidImg.h } : "not re-laid (writer slide not found)",
      minLabelPt: minPt === undefined ? null : Number(minPt.toFixed(1)),
      floorPt: TYPE_FLOOR,
      meetsFloor: minPt === undefined ? null : minPt >= TYPE_FLOOR,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
await closeRenderer();
writeFileSync(`${out}/replay.json`, JSON.stringify(rows, null, 1));
