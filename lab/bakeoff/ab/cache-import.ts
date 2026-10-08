// Importer (8 Oct; exact-only since audit F1) for lesson dirs written before calls.jsonl existed.
// Those logs hold the writer's request as hashes (request.json: model, effort, user, systemSha,
// schemaSha, and from now on the sent shas and locale) and its raw output (stream.txt). Only the writer
// can be tied to the live request exactly, so only the writer is imported. Lesson notes and repairs
// are not replayable from old logs (their full requests were never logged; the old loose matchers
// served notes written for other slides) and are called fresh, or refused under --offline. The cache
// stores an import under the live request's exact key. See ab/CACHE.md.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { CallMeta, Imported, Importer, ReqForm } from "./cache";

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

/** The system and user text a chat-completions request actually sent (after localising). */
export function sentTexts(form: ReqForm): { system?: string; user?: string } {
  const msgs = (form.body as { json?: { messages?: { role: string; content: unknown }[] } } | null)
    ?.json?.messages;
  const text = (role: string) => {
    const c = msgs?.find((m) => m.role === role)?.content;
    return typeof c === "string" ? c : undefined;
  };
  return { system: text("system"), user: text("user") };
}

export function legacyImporter(lessonDir: string): Importer {
  const req = readJson(`${lessonDir}/request.json`) as
    | {
        model: string;
        effort?: string;
        user: string;
        systemSha?: string;
        schemaSha?: string;
        sentSystemSha?: string;
        sentUserSha?: string;
      }
    | undefined;
  const cost = (readJson(`${lessonDir}/cost.json`) ?? {}) as Record<string, number>;
  const stream = existsSync(`${lessonDir}/stream.txt`)
    ? readFileSync(`${lessonDir}/stream.txt`, "utf8")
    : undefined;
  let usedWriter = false;

  return ({ form, meta }: { form: ReqForm; meta?: CallMeta }): Imported | undefined => {
    if (!meta || !req || meta.name !== "lesson" || !stream || usedWriter) return undefined;
    // Writer: exact. Same model, effort, template system sha, schema sha and user text, and the text
    // actually sent must be the text the old run sent: its logged sent shas, or, for logs older than
    // those, sent == template (no locale token filled), which holds for the old run too.
    const sent = sentTexts(form);
    if (sent.system === undefined || sent.user === undefined) return undefined;
    const sysOk = req.sentSystemSha
      ? sha(sent.system) === req.sentSystemSha
      : sha(sent.system) === req.systemSha;
    const userOk = req.sentUserSha ? sha(sent.user) === req.sentUserSha : sent.user === req.user;
    if (
      meta.model === req.model &&
      (meta.effort ?? undefined) === (req.effort ?? undefined) &&
      req.systemSha === sha(String(meta.system)) &&
      req.schemaSha === sha(JSON.stringify(meta.schema)) &&
      meta.user === req.user &&
      sysOk &&
      userOk
    ) {
      usedWriter = true;
      return {
        text: sseOf(stream),
        contentType: "text/event-stream",
        usd: cost.main ?? 0,
        verify: "exact-sha",
      };
    }
    return undefined;
  };
}
