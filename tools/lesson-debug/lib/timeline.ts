/**
 * The pure half of `tools/lesson-debug`: one lesson's generation block, job events and debug rows
 * as a readable timeline (no database, so it is tested on a fixture).
 */

export interface LessonRow {
  id: string;
  workspaceId: string;
  title: string | null;
  generatingJobId: string | null;
  updatedAt: string;
  generation: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
}

export interface JobEventRow {
  id: number;
  jobId: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface DebugRow {
  jobId: string;
  attempt: number;
  seq: number;
  kind: string;
  slideIndex: number | null;
  payload: unknown;
  createdAt: string;
}

export interface LessonDebug {
  lesson: LessonRow & { slides?: unknown[] | null };
  events: JobEventRow[];
  debug: DebugRow[];
}

/** Every job id the lesson names: its lock, its last generation, its plan, and its debug rows. */
export function jobIdsOf(lesson: LessonRow, debug: readonly DebugRow[]): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v);
  };
  add(lesson.generatingJobId);
  add(lesson.generation?.jobId);
  add(lesson.plan?.jobId);
  for (const row of debug) add(row.jobId);
  return [...ids].sort();
}

/** The Railway command to run for the lesson's log lines (printed, never run). */
export function railwayCommand(lessonId: string): string {
  return `railway logs --service worker --json | grep '"lessonId":"${lessonId}"'`;
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const json = (v: unknown, n = 140) => clip(JSON.stringify(v) ?? "", n);
const short = (id: string) => id.slice(-8);
type P = Record<string, unknown>;

function firstStackLine(stack: unknown): string {
  if (typeof stack !== "string") return "";
  const at = stack.split("\n").find((l) => l.trim().startsWith("at "));
  return at ? ` (${at.trim()})` : "";
}

/** One debug row in a line: the fields that matter for its kind. */
export function describeDebug(row: DebugRow): string {
  const p = (row.payload ?? {}) as P;
  if (p.truncated === true && "head" in p)
    return `[truncated payload, ${p.originalBytes ?? p.bytes} bytes]`;
  switch (row.kind) {
    case "event": {
      const { ev, slide: _slide, ...rest } = p;
      return `${String(ev ?? "?")} ${Object.keys(rest).length ? json(rest, 120) : ""}`.trim();
    }
    case "model-call": {
      const ctx = (p.context ?? {}) as P;
      const usage = (p.usage ?? {}) as P;
      const resp = (p.response ?? {}) as P;
      const cost = typeof p.costUsd === "number" ? ` $${p.costUsd.toFixed(4)}` : "";
      const err =
        p.ok === false
          ? ` FAILED: ${clip(String((p.error as P | undefined)?.message ?? resp.finishReason ?? ""), 80)}`
          : "";
      const out =
        typeof resp.text === "string" ? ` -> ${resp.text.length} chars, ${resp.finishReason}` : "";
      return `${ctx.promptVersion ?? "?"} on ${p.modelId} (${ctx.stage ?? "?"}, ${p.mode}) ${p.durationMs}ms ${usage.inputTokens ?? "?"}/${usage.outputTokens ?? "?"} tok${cost}${out}${err}${p.truncated ? " [truncated]" : ""}  [--call ${row.jobId.slice(-8)}:${row.attempt}:${row.seq}]`;
    }
    case "writer-output": {
      const text = typeof p.text === "string" ? p.text : "";
      const cost = typeof p.usd === "number" ? ` $${p.usd.toFixed(4)}` : "";
      return `${text.length} chars, finish ${p.finishReason ?? "?"}, ${p.ms}ms${cost}`;
    }
    case "plan":
      return `${p.stage}: ${json({ plan: p.plan, objectives: (p.facts as P | null)?.objectives }, 160)}`;
    case "check": {
      const faults = (p.faults as string[] | undefined) ?? [];
      const over = (p.over as unknown[] | undefined) ?? [];
      return faults.length || over.length
        ? `${faults.join("; ")}${over.length ? ` | over ${json(over, 100)}` : ""}`
        : "ok";
    }
    case "repair": {
      const verdict =
        p.ok === false
          ? `rejected${p.rejected ? ` (${(p.rejected as string[]).join(", ")})` : p.why ? ` (${p.why})` : ""}`
          : p.reverted
            ? "accepted then reverted"
            : "accepted";
      const faults = (p.faults ?? p.faultsBefore) as string[] | undefined;
      return `${p.mode}: ${verdict}${p.fix ? `, fix ${clip(String(p.fix), 60)}` : ""}${faults ? ` | faults ${clip(faults.join("; "), 80)}` : ""}`;
    }
    case "split": {
      const rest = Array.isArray(p.rest) ? ` into ${p.rest.length + 1} slides` : "";
      return `${p.how}${rest}${p.ok !== undefined ? ` ok=${p.ok}` : ""}`;
    }
    case "picture":
      return `${p.outcome} via ${p.via ?? p.plan} for "${clip(String(p.ask ?? ""), 60)}"${p.reason ? ` (${p.reason})` : ""}${p.failure ? ` (${p.failure})` : ""}`;
    case "fact-check": {
      if (p.summary) return `${p.checker}: read ${p.slidesChecked} slides, flagged ${p.flagged}`;
      if (p.checker === "verify") {
        const cs = (p.corrections as P[] | undefined) ?? [];
        const cost = typeof p.usd === "number" ? ` $${p.usd.toFixed(4)}` : "";
        return `verify on ${p.model ?? "?"} ${p.ms}ms${cost}: ${(p.checked as unknown[] | undefined)?.length ?? "?"} facts checked, ${cs.length} corrections, ${p.applied ?? 0} applied, ${p.dropped ?? 0} dropped${p.capped ? ", CAPPED" : ""}${p.skipped ? `, skipped (${p.skipped})` : ""}`;
      }
      return `${p.checker}: ${p.verdict}${p.reason ? ` (${clip(String(p.reason), 70)})` : ""}${p.applied ? ", applied" : p.dropped ? `, dropped (${p.dropped})` : ""}`;
    }
    case "budget-stop":
      return `${p.name} on ${p.model ?? p.cls ?? "?"} refused; totals ${json(p.totals, 100)}`;
    case "stage-error":
    case "job-error": {
      const e = (row.kind === "stage-error" ? p.error : p) as P;
      const stage = row.kind === "stage-error" ? `${p.stage}: ` : "";
      return `${stage}${e?.name ?? "Error"}: ${clip(String(e?.message ?? ""), 120)}${firstStackLine(e?.stack)}`;
    }
    default:
      return json(p);
  }
}

/** One job event in a line. */
export function describeEvent(e: JobEventRow): string {
  const p = e.payload;
  if (e.type === "progress") {
    const pr = (p.progress ?? {}) as P;
    return `${pr.percent ?? ""}% ${pr.stage ?? ""} ${pr.message ?? ""}`.trim();
  }
  if (e.type === "failed") return json(p.error);
  if (e.type === "completed" && p.result) return `result ${json(p.result, 100)}`;
  return "";
}

/** Where each fact id is taught: slide indexes whose elements cite it (`generatedFrom.factRefs`). */
export function slidesByFact(slides: readonly unknown[] | null | undefined): Map<string, number[]> {
  const out = new Map<string, number[]>();
  (slides ?? []).forEach((slide, i) => {
    for (const el of ((slide as P)?.elements as P[] | undefined) ?? [])
      for (const ref of ((el.generatedFrom as P | undefined)?.factRefs as string[] | undefined) ??
        []) {
        const at = out.get(ref) ?? [];
        if (!at.includes(i)) at.push(i);
        out.set(ref, at);
      }
  });
  return out;
}

/** A sentence diff of two texts: unchanged kept, removed `-`, added `+`. */
export function lineDiff(before: string, after: string): string[] {
  const split = (t: string) => t.split(/\n|(?<=[.!?])\s+/).filter(Boolean);
  const a = split(before);
  const b = split(after);
  const inA = new Set(a);
  const inB = new Set(b);
  return [
    ...a.map((l) => (inB.has(l) ? `      ${l}` : `    - ${l}`)),
    ...b.filter((l) => !inA.has(l)).map((l) => `    + ${l}`),
  ];
}

/**
 * The fact check section: per lesson, the slides checked and changed and the change rate, then a
 * before/after diff per changed slide (writer checks: the slide's words; Verify: each corrected
 * field, with the slides that cite the fact).
 */
export function factCheckSection(
  debug: readonly DebugRow[],
  slides?: readonly unknown[] | null,
): string {
  const p = (r: DebugRow) => (r.payload ?? {}) as P;
  const rows = debug.filter((r) => r.kind === "fact-check");
  const out = ["FACT CHECK"];
  if (rows.length === 0) return [...out, "  (no fact-check rows)"].join("\n");
  const deckSize = Math.max(
    0,
    (slides ?? []).length,
    ...rows.filter((r) => p(r).summary).map((r) => Number(p(r).slidesChecked) || 0),
  );
  const perSlide = rows.filter((r) => r.slideIndex !== null && !p(r).summary);
  const verify = rows.filter((r) => p(r).checker === "verify");
  const byFact = slidesByFact(slides);
  const changed = new Map<number, DebugRow[]>();
  for (const r of perSlide)
    if (p(r).applied && p(r).beforeText !== p(r).afterText) {
      const i = r.slideIndex as number;
      changed.set(i, [...(changed.get(i) ?? []), r]);
    }
  const verifyChanged = new Set<number>();
  for (const r of verify)
    for (const c of ((p(r).corrections as P[] | undefined) ?? []).filter((c) => c.applied))
      for (const i of byFact.get(String(c.factId)) ?? []) verifyChanged.add(i);
  const allChanged = new Set([...changed.keys(), ...verifyChanged]);
  const rate = deckSize ? ` (${((100 * allChanged.size) / deckSize).toFixed(0)}%)` : "";
  out.push(
    `  slides checked ${deckSize}, changed ${allChanged.size}${rate}; ${perSlide.length} per-slide checks, ${verify.length} verify runs`,
  );
  for (const r of rows.filter((x) => p(x).summary)) out.push(`  ${describeDebug(r)}`);
  for (const r of verify) {
    out.push(`  ${describeDebug(r)}`);
    for (const c of (p(r).corrections as P[] | undefined) ?? []) {
      const at = byFact.get(String(c.factId)) ?? [];
      out.push(
        `  ${c.applied ? "changed" : "DROPPED"} ${c.factId}.${c.field}${c.index !== undefined ? `[${c.index}]` : ""} (${c.reason})${at.length ? ` on slides ${at.map((i) => i + 1).join(", ")}` : ""}${c.dropped ? `: ${c.dropped}` : ""}`,
        `    - ${json(c.before, 200)}`,
        `    + ${json(c.applied ? c.after : c.correction, 200)}`,
      );
    }
  }
  for (const [i, rs] of [...changed].sort((x, y) => x[0] - y[0])) {
    out.push(
      `  slide ${i + 1}: ${rs.map((r) => `${p(r).checker} ${p(r).verdict}${p(r).reason ? ` (${clip(String(p(r).reason), 60)})` : ""}`).join(", ")}`,
    );
    const first = rs[0] as DebugRow;
    const last = rs[rs.length - 1] as DebugRow;
    out.push(...lineDiff(String(p(first).beforeText ?? ""), String(p(last).afterText ?? "")));
  }
  for (const r of perSlide.filter((x) => !p(x).applied))
    out.push(`  slide ${(r.slideIndex as number) + 1}: ${describeDebug(r)}`);
  return out.join("\n");
}

/** One model call in full: the request (system, messages, schema, settings) and the response. */
export function callDetail(row: DebugRow): string {
  const p = (row.payload ?? {}) as P;
  const req = (p.request ?? {}) as P;
  const resp = (p.response ?? {}) as P;
  const out = [
    `CALL ${row.jobId}:${row.attempt}:${row.seq} at ${row.createdAt}`,
    `  ${describeDebug(row)}`,
    `  context ${JSON.stringify(p.context)}`,
    `  schema ${req.schemaName ?? "-"} (${req.responseFormat ?? "text"}); tools ${JSON.stringify(req.tools ?? [])}`,
    `  settings ${JSON.stringify(req.settings ?? {})}`,
  ];
  if (p.truncated)
    out.push(`  TRUNCATED from ${p.originalBytes} bytes: ${JSON.stringify(p.truncatedFields)}`);
  for (const sys of (req.system as string[] | undefined) ?? []) out.push("", "--- system ---", sys);
  for (const m of (req.messages as P[] | undefined) ?? []) {
    out.push("", `--- ${m.role} ---`);
    if (typeof m.content === "string") out.push(m.content);
    else
      for (const part of (m.content as P[] | undefined) ?? [])
        out.push(part.type === "text" ? String(part.text) : JSON.stringify(part));
  }
  out.push("", `--- response (${resp.finishReason ?? "?"}) ---`, String(resp.text ?? ""));
  if (resp.reasoning) out.push("", "--- reasoning ---", String(resp.reasoning));
  if (p.error) out.push("", `--- error --- ${JSON.stringify(p.error)}`);
  return out.join("\n");
}

/** A call by `<jobId suffix>:<attempt>:<seq>` (as the timeline prints it) or a bare seq. */
export function findCall(debug: readonly DebugRow[], ref: string): DebugRow | undefined {
  const calls = debug.filter((r) => r.kind === "model-call");
  const parts = ref.split(":");
  if (parts.length === 3) {
    const [job, attempt, seq] = parts;
    return calls.find(
      (r) =>
        r.jobId.endsWith(String(job)) && r.attempt === Number(attempt) && r.seq === Number(seq),
    );
  }
  return calls.find((r) => r.seq === Number(ref));
}

/** The readable report: the generation block, then every event and debug row in time order. */
export function timeline({ lesson, events, debug }: LessonDebug): string {
  const out: string[] = [];
  const g = lesson.generation ?? {};
  out.push(`Lesson ${lesson.id} "${lesson.title ?? ""}" (workspace ${lesson.workspaceId})`);
  out.push(`  updated ${lesson.updatedAt}; lock ${lesson.generatingJobId ?? "none"}`);
  out.push(
    `  generation: stage ${g.stage ?? "none"}, job ${g.jobId ?? "?"}, usage ${json(g.usage, 120)}`,
  );
  const findings = (g.findings as unknown[] | undefined) ?? [];
  if (findings.length) out.push(`  findings (${findings.length}): ${json(findings, 300)}`);
  if (g.promptVersions) out.push(`  prompts: ${json(g.promptVersions, 300)}`);
  const kinds = new Map<string, number>();
  for (const r of debug) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
  out.push(
    `  ${events.length} job events, ${debug.length} debug rows${kinds.size ? ` (${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}`,
  );
  out.push("");

  type Item = { t: number; order: number; line: string };
  const items: Item[] = [
    ...events.map((e) => ({
      t: Date.parse(e.at),
      order: e.id,
      line: `job ${short(e.jobId)}      EVENT ${e.type.padEnd(11)} ${describeEvent(e)}`,
    })),
    ...debug.map((r) => ({
      t: Date.parse(r.createdAt),
      order: r.seq,
      line: `job ${short(r.jobId)} a${r.attempt} ${r.kind.padEnd(13)}${r.slideIndex === null ? "    " : ` s${String(r.slideIndex + 1).padEnd(2)}`} ${describeDebug(r)}`,
    })),
  ].sort((a, b) => a.t - b.t || a.order - b.order);
  const t0 = items[0]?.t ?? 0;
  for (const it of items) {
    const at = new Date(it.t).toISOString().slice(11, 23);
    const rel = `+${((it.t - t0) / 1000).toFixed(1)}s`.padStart(8);
    out.push(`${at} ${rel}  ${it.line.trimEnd()}`);
  }
  if (items.length === 0)
    out.push("(no job events or debug rows: older than the TTL, or never recorded)");
  out.push("", factCheckSection(debug, lesson.slides));
  return out.join("\n");
}
