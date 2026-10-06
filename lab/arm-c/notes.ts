// Arm C: speaker notes from the shared notes call (BAKEOFF prompts/shared/notes.txt), one gpt-6-luna
// low call per slide, all in parallel, as onecall/lab/bakeoff/harness.ts does for T, K and R.
// The user turn: C's context block + "Lesson:" + the lesson JSON + "Slide: N" (a cacheable prefix).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const SHARED = resolve(import.meta.dir, "../../../quality-prd/lab/rounds/BAKEOFF/prompts/shared");
const P = { in: 0.1, cached: 0.01, out: 0.5 }; // openai/gpt-6-luna per MTok
export interface Notes {
  notes: string;
  answers: string[];
}

/** The slide's visible words from its HTML (what pupils read), for the notes call's lesson JSON. */
export const slideText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

export async function writeNotes(o: {
  stub: boolean;
  user: string;
  lessonJson: string;
  count: number;
  costs: { notes: number };
  log: (r: Record<string, unknown>) => void;
}): Promise<Map<number, Notes>> {
  const out = new Map<number, Notes>();
  if (o.stub) {
    for (let n = 1; n <= o.count; n++)
      out.set(n, { notes: `stub notes for slide ${n}`, answers: [] });
    return out;
  }
  const KEY = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
  const system = readFileSync(`${SHARED}/notes.txt`, "utf8");
  const schema = JSON.parse(readFileSync(`${SHARED}/notes-schema.json`, "utf8"));
  await Promise.all(
    Array.from({ length: o.count }, (_, i) => i + 1).map(async (n) => {
      const t0 = performance.now();
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-6-luna",
            reasoning_effort: "low",
            messages: [
              { role: "system", content: system },
              { role: "user", content: `${o.user}\n\nLesson:\n${o.lessonJson}\n\nSlide: ${n}` },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "notes", strict: true, schema },
            },
          }),
        });
        const j: any = await r.json();
        if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
        const u = j.usage;
        const c = u.prompt_tokens_details?.cached_tokens ?? 0;
        const usd =
          ((u.prompt_tokens - c) * P.in + c * P.cached + u.completion_tokens * P.out) / 1e6;
        o.costs.notes += usd;
        out.set(n, JSON.parse(j.choices[0].message.content));
        o.log({ kind: "notes", slide: n, ms: Math.round(performance.now() - t0), usd });
      } catch (e) {
        o.log({ kind: "notes-error", slide: n, err: String(e).slice(0, 200) });
      }
    }),
  );
  return out;
}
