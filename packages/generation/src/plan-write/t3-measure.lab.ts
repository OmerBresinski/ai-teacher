// @ts-nocheck lab script
// Lab ABLATE T3: token counts (OpenAI input_tokens endpoint) and drawing checks; not shipped.
import { readFileSync } from "node:fs";
import { parseDiagram } from "@tj/slides/diagrams";
import { z } from "zod";
import {
  expandDrawing,
  teacher2LessonSchema,
  teacher2Prompt,
  teacher3LessonSchema,
  teacher3Prompt,
} from "./simple";

const A =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/ABLATE";
const key = readFileSync(`${process.env.HOME}/.dayback-openai-key`, "utf8").trim();
async function count(system: string, user: string, schema?: unknown) {
  const r = await fetch("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-6.1-sol",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(schema
        ? { text: { format: { type: "json_schema", name: "lesson", schema, strict: false } } }
        : {}),
    }),
  });
  const j = (await r.json()) as { input_tokens?: number };
  return j.input_tokens ?? JSON.stringify(j).slice(0, 200);
}
const mode = process.argv[2];
if (mode === "tokens") {
  for (const b of ["y9-weimar", "y5-maths-fractions-of-amounts", "y7-particle-model-new"]) {
    const r = JSON.parse(
      readFileSync(`${A}/calls/T2/ABL-T2-${b}-generate.calls.jsonl`, "utf8").split("\n")[0],
    );
    const subject = /maths/.test(b) ? "Maths" : /weimar/.test(b) ? "History" : "Science";
    const yearGroup = r.context.match(/Year group: (Year \d+)/)[1];
    const ageBand = r.context.match(/\((ks\d)\)/)[1];
    const topic = r.context.match(/Topic: (.*)/)[1];
    const inp = { slideCount: 10, topic, context: r.context, yearGroup, subject, ageBand };
    const objectives = JSON.parse(readFileSync(`${A}/objectives-R3/${b}.json`, "utf8"));
    const p2 = teacher2Prompt(inp),
      p3 = teacher3Prompt({ ...inp, objectives });
    const s2 = z.toJSONSchema(teacher2LessonSchema(subject)),
      s3 = z.toJSONSchema(teacher3LessonSchema(subject));
    const ctx = await count("", r.context);
    const t2a = await count(p2.system, p2.user),
      t2b = await count(p2.system, p2.user, s2);
    const t3a = await count(p3.system, p3.user),
      t3b = await count(p3.system, p3.user, s3);
    console.log(
      JSON.stringify({
        b,
        context: ctx,
        T2: { prompt: t2a, withSchema: t2b, schemaChars: JSON.stringify(s2).length },
        T3: { prompt: t3a, withSchema: t3b, schemaChars: JSON.stringify(s3).length },
      }),
    );
  }
} else {
  // T2's own drawing specs, as written and after the T3 expansion (empties dropped).
  let raw = 0,
    fixed = 0,
    n = 0;
  for (const b of [
    "y5-maths-fractions-of-amounts",
    "y7-particle-model-new",
    "y9-weimar",
    "y10-english-tempest-prospero",
  ]) {
    const r = JSON.parse(
      readFileSync(`${A}/calls/T2/ABL-T2-${b}-generate.calls.jsonl`, "utf8").split("\n")[0],
    );
    for (const s of r.output.slides) {
      if (s.picture?.kind !== "diagram") continue;
      n++;
      const { alt: _a, ...wire } = s.picture.spec;
      if (parseDiagram(s.picture.spec)) raw++;
      const e = expandDrawing(wire);
      if (parseDiagram(e)) fixed++;
      else console.log("FAIL", b, JSON.stringify(e).slice(0, 300));
    }
  }
  console.log({ n, raw, fixed });
}
