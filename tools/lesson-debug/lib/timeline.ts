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
  lesson: LessonRow;
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
  if (p.truncated === true) return `[truncated payload, ${p.bytes} bytes]`;
  switch (row.kind) {
    case "event": {
      const { ev, slide: _slide, ...rest } = p;
      return `${String(ev ?? "?")} ${Object.keys(rest).length ? json(rest, 120) : ""}`.trim();
    }
    case "call": {
      const tokens = p.tokens as { input?: number; output?: number } | undefined;
      const cost = typeof p.usd === "number" ? ` $${p.usd.toFixed(4)}` : "";
      const err =
        p.ok === false ? ` FAILED: ${clip(String((p.error as P)?.message ?? ""), 80)}` : "";
      return `${p.name} on ${p.model ?? p.cls ?? "?"} (${p.stage ?? "?"}) ${p.ms}ms${tokens ? ` ${tokens.input}/${tokens.output} tok` : ""}${cost}${err}`;
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
      const c = (p.correction ?? {}) as P;
      return `${c.factId}.${c.field}${c.index !== undefined ? `[${c.index}]` : ""} -> ${json(c.value, 80)}${c.reason ? ` (${c.reason})` : ""}`;
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
  return out.join("\n");
}
