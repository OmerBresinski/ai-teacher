// lib arm D30 fixes: question slides never show the answer; intents a model cannot draw are refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AB } from "./arms";
import { capabilityRefusals, isQuestionSlide, libDiagram, library, questionStep } from "./lib";

type S = Record<string, unknown>;
const RUN = `${AB}/runs/lib-wo1/T`;
/** The 17 model figures of lib-wo1 (writer-only, prompts f3947aaf). */
function figures() {
  const out: { lesson: string; slide: number; s: S; model: string; intent: string }[] = [];
  for (const lesson of [...new Bun.Glob("*/main.json").scanSync(RUN)].sort()) {
    const main = JSON.parse(JSON.parse(readFileSync(`${RUN}/${lesson}`, "utf8")).text);
    (main.slides as S[]).forEach((s, i) => {
      for (const k of ["figure", "picture"]) {
        const f = s[k] as S | undefined;
        if (f?.kind === "model")
          out.push({
            lesson: lesson.split("/")[0] as string,
            slide: i + 3,
            s,
            model: String(f.model),
            intent: String(f.intent ?? ""),
          });
      }
    });
  }
  return out;
}
/** Library defaults merged with the preset whose name best fits, standing in for the paid fill. */
async function standIn(id: string) {
  const { models } = await library();
  return (models.get(id)?.presets[0]?.params ?? {}) as Record<string, unknown>;
}

describe("lib D30 fixes on lib-wo1's 17 figures", () => {
  test("capability refusals: y2 unequal split, y5 ⅔ marking, y6 Amazon in hist_map", async () => {
    const f = figures();
    expect(f.length).toBe(17);
    const refused = f.filter((x) => capabilityRefusals(x.model, x.intent).length);
    expect(refused.map((x) => `${x.lesson.slice(0, 2)} s${x.slide - 2} ${x.model}`).sort()).toEqual(
      ["y2 s3 fractions", "y5 s7 equal_groups", "y6 s1 hist_map"],
    );
  });
  test("question slides draw an answer-free build, or no model", async () => {
    const { models, kit } = await library();
    const rows: string[] = [];
    for (const x of figures().filter((y) => isQuestionSlide(y.s))) {
      if (capabilityRefusals(x.model, x.intent).length) continue;
      const p = await standIn(x.model);
      const k = await questionStep(x.model, p);
      const m = models.get(x.model) as unknown as {
        builds: (p: unknown) => { steps: { key: string }[] };
      };
      const steps = m.builds(
        kit.withDefaults((models.get(x.model) as { params: never }).params, p),
      ).steps;
      rows.push(
        `${x.lesson.slice(0, 2)} s${x.slide - 2} ${x.model} ${
          k === undefined
            ? "no model"
            : steps
                .slice(0, k + 1)
                .map((s) => s.key)
                .join(">")
        }`,
      );
      if (k !== undefined)
        for (const s of steps.slice(0, k + 1))
          expect(["name", "share", "count", "sentence", "answer", "calc"]).not.toContain(s.key);
    }
    console.log(rows.join("\n"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
  test("libDiagram: a refused intent falls back before rendering; a question renders its step", async () => {
    const ev: S[] = [];
    let rendered: number | undefined = -1;
    const deps = {
      filler: async () => ({ out: await standIn("equal_groups"), usd: 0 }),
      render: async (_i: string, _p: unknown, _o?: string, step?: number) => {
        rendered = step;
        return { src: "data:image/png;base64,x", aspect: 1.5, warnings: [] };
      },
    };
    const ask = { key: "k", shows: "s", words: "", yearGroup: "Year 2" };
    const a = await libDiagram(
      { ...ask, spec: { model: "equal_groups", intent: "Highlight two rings of the three" } },
      deps as never,
      (e) => ev.push(e as S),
    );
    expect(a.libDrawn).toBeUndefined();
    expect(rendered).toBe(-1);
    expect(ev.some((e) => e.ev === "lib-capability-refused")).toBe(true);
    const b = await libDiagram(
      {
        ...ask,
        question: true,
        spec: { model: "equal_groups", intent: "Ten counters, two empty rings" },
      },
      deps as never,
      () => {},
    );
    expect(b.libDrawn).toBeDefined();
    expect(rendered).toBeGreaterThanOrEqual(0);
  });
  test("isQuestionSlide", () => {
    expect(
      isQuestionSlide({ heading: "Find one half of 10", lead: "How many in one group?" }),
    ).toBe(true);
    expect(isQuestionSlide({ heading: "Find one half of 8", figure: { intent: "why?" } })).toBe(
      false,
    );
    expect(isQuestionSlide({ template: "hinge" })).toBe(true);
  });
});
