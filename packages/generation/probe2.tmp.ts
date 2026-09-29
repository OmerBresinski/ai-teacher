import { fitSlide, getTheme, isCalloutElement, materialiseSlide, THEMES } from "@tj/slides";
const META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };
const themesFailing = (spec: any) => THEMES.filter((t) => { const s = materialiseSlide(spec, t.id, META); if (spec.callout && !s.elements.some(isCalloutElement)) return true; return fitSlide(s, getTheme(t.id)).overflow.length > 0; }).length;
const dir = "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/fit-lab/runs/baseline/";
for (const b of ["y4-plants", "y6-ratio", "y9-weimar", "y10-electrolysis"]) {
  const d = await Bun.file(dir + b + ".lesson.json").json();
  const f = d.facts; const K = f.keyIdeas;
  const out: string[] = [];
  for (let i = 0; i + 1 < K.length; i++) {
    const h1 = { kind: "content", factRefs: [], heading: K[i].statement, body: K[i].explanation + "\n\n" + K[i + 1].explanation };
    const h2 = { ...h1, heading: "Short heading" };
    out.push(`${themesFailing(h1)}/${themesFailing(h2)}`);
  }
  const we = f.workedExamples.map((x: any) => { const s = { kind: "worked-example", factRefs: [], question: x.problem, steps: x.steps }; const s2 = { ...s, heading: "Worked example" }; return `${themesFailing(s)}/${themesFailing(s2)} q${x.problem.length} ${x.steps.map((z: string) => z.length)}`; });
  console.log(b, "pairs expl-only fail(statement heading/short heading):", out.join(" "), "| WE fail(noheading/heading):", we.join(" ; "));
}
// actual delivered slides: re-materialise? print the kind variants in baseline deck slide 7 plants
