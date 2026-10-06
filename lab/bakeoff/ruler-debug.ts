// Debug: which elements the eval ruler (slideFits) flags on a run's lesson.json.
import { readFileSync } from "node:fs";
import * as S from "../../packages/slides/src/index.ts";

const plain = (d: any): string => d?.text ?? (d?.content ?? []).map(plain).join(" ");
for (const run of process.argv.slice(2)) {
  const l = JSON.parse(readFileSync(`${run}/lesson.json`, "utf8"));
  const theme = S.getTheme(l.themeId);
  S.withKeyStage(l.ageBand, () =>
    l.slides.forEach((s: any, i: number) => {
      const f = S.slideFits(s, theme, 1);
      if (!f.overflow.length) return;
      const els = f.overflow.map((id: string) => {
        const e = s.elements.find((x: any) => x.id === id);
        return e
          ? `${e.name}@${e.x},${e.y},${e.w}x${e.h} fs${e.style?.fontSize ?? e.textStyle?.fontSize} "${plain(e.doc).slice(0, 40)}"`
          : id;
      });
      console.log(run.split("/").pop(), `s${i + 1}`, els.join(" | "));
    }),
  );
}
