// Best-effort importer (8 Oct) for lesson dirs written before calls.jsonl existed. Those logs hold the
// writer's request as hashes (request.json: model, effort, user, systemSha, schemaSha) and its raw
// output (stream.txt), the lesson notes' output (notes.json) and each repair's slide, faults and
// output (repair.jsonl); no picture, judge or diagram request was logged (`--reuse-visuals` covers
// those for an old run). A recorded response is served only when the live compiled request ties to
// it: see `verify` on each matcher and ab/CACHE.md. The cache stores the import under the live
// request's exact key, so later replays of the new run are exact.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { CallMeta, Imported, Importer } from "./cache";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const readJson = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined);

/** A chat-completions SSE body carrying `text` (usage reported as zero: an import costs nothing now). */
export function sseOf(text: string): string {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 200)
    out.push(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(i, i + 200) } }] })}\n\n`,
    );
  out.push(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } })}\n\n`,
    "data: [DONE]\n\n",
  );
  return out.join("");
}
/** A plain chat-completions JSON body whose message is `content`. */
export const jsonOf = (content: string) =>
  JSON.stringify({
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  });

export function legacyImporter(lessonDir: string): Importer {
  const req = readJson(`${lessonDir}/request.json`) as
    | { model: string; effort?: string; user: string; systemSha?: string; schemaSha?: string }
    | undefined;
  const cost = (readJson(`${lessonDir}/cost.json`) ?? {}) as Record<string, number>;
  const stream = existsSync(`${lessonDir}/stream.txt`)
    ? readFileSync(`${lessonDir}/stream.txt`, "utf8")
    : undefined;
  const notes = readJson(`${lessonDir}/notes.json`) as { slides: unknown[] } | undefined;
  const repairs = (
    existsSync(`${lessonDir}/repair.jsonl`)
      ? readFileSync(`${lessonDir}/repair.jsonl`, "utf8").split("\n").filter(Boolean)
      : []
  ).map((l) => JSON.parse(l) as { slide: number; mode: string; input: unknown; out?: unknown });
  const repairUsd = repairs.length
    ? (cost.repair ?? 0) / repairs.filter((r) => r.out).length || 0
    : 0;
  const used = { writer: false, notes: false, repair: new Set<number>() };

  return ({ meta }: { meta?: CallMeta }): Imported | undefined => {
    if (!meta || !req) return undefined;
    // Writer: exact. Same model and effort, the system and schema hashing to the logged shas, the
    // same user text.
    if (meta.name === "lesson" && stream && !used.writer) {
      if (
        meta.model === req.model &&
        (meta.effort ?? undefined) === (req.effort ?? undefined) &&
        req.systemSha === sha(String(meta.system)) &&
        req.schemaSha === sha(JSON.stringify(meta.schema)) &&
        meta.user === req.user
      ) {
        used.writer = true;
        return {
          text: sseOf(stream),
          contentType: "text/event-stream",
          usd: cost.main ?? 0,
          verify: "exact-sha",
        };
      }
      return undefined;
    }
    // Lesson notes: the first notes call of this lesson whose user turn carries the logged context
    // block (the request's other half, the slides as shown, was not logged).
    if (
      meta.name === "notes" &&
      notes &&
      !used.notes &&
      meta.user?.includes(req.user) &&
      !meta.user.includes("Write the notes for these slides only")
    ) {
      used.notes = true;
      return {
        text: jsonOf(JSON.stringify({ slides: notes.slides })),
        contentType: "application/json",
        usd: cost.notes ?? 0,
        verify: "lesson-context",
      };
    }
    // Repair: the logged row whose exact slide JSON is in the request (faults are logged before
    // their rewording, so they cannot be compared).
    if (meta.name === "slide") {
      const k = repairs.findIndex(
        (r, i) => r.out && !used.repair.has(i) && meta.user?.includes(JSON.stringify(r.input)),
      );
      if (k < 0) return undefined;
      used.repair.add(k);
      return {
        text: jsonOf(JSON.stringify(repairs[k]?.out)),
        contentType: "application/json",
        usd: repairUsd,
        verify: "slide-json",
      };
    }
    return undefined;
  };
}
