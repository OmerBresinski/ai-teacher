#!/usr/bin/env bun
/**
 * One lesson's generation, root-caused from what production stored (Greg, 20 Oct 2026). See
 * README.md.
 *
 *   DATABASE_URL=postgres://… bun tools/lesson-debug/run.ts <lessonId> [--json <file>]
 *
 * Read-only. Prints the document's generation block, its job events and its `generation_debug`
 * rows as one timeline, writes the JSON dump (default `.data/lesson-debug/<lessonId>.json`), and
 * prints the Railway command for the worker's log lines (never runs it).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDb } from "../../packages/db/src/client";
import {
  type DebugRow,
  type JobEventRow,
  jobIdsOf,
  type LessonDebug,
  type LessonRow,
  railwayCommand,
  timeline,
} from "./lib/timeline";

const ROOT = join(import.meta.dir, "..", "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { values: args, positionals } = parseArgs({
  options: { json: { type: "string" } },
  allowPositionals: true,
});
const lessonId = positionals[0];
const url = process.env.DATABASE_URL;
if (!lessonId || !UUID.test(lessonId) || !url) {
  console.error(
    "usage: DATABASE_URL=postgres://… bun tools/lesson-debug/run.ts <lessonId> [--json <file>]",
  );
  process.exit(2);
}

const { sql, close } = createDb(url, { max: 1 });
try {
  const [doc] = await sql<LessonRow[]>`
    select id, workspace_id as "workspaceId", title, generating_job_id as "generatingJobId",
      to_json(updated_at)#>>'{}' as "updatedAt", body->'generation' as generation, body->'plan' as plan
    from documents where id = ${lessonId} and kind = 'lesson'`;
  if (!doc) {
    console.error(`no lesson ${lessonId} in this database`);
    process.exitCode = 1;
  } else {
    const debug = await sql<DebugRow[]>`
      select job_id as "jobId", attempt, seq, kind, slide_index as "slideIndex", payload,
        to_json(created_at)#>>'{}' as "createdAt"
      from generation_debug
      where workspace_id = ${doc.workspaceId} and lesson_id = ${lessonId}
      order by created_at, job_id, attempt, seq`;
    const jobIds = jobIdsOf(doc, debug);
    const events = jobIds.length
      ? await sql<JobEventRow[]>`
          select id::int as id, job_id as "jobId", type, to_json(at)#>>'{}' as at, payload
          from job_events
          where workspace_id = ${doc.workspaceId} and job_id in ${sql(jobIds)}
          order by id`
      : [];
    const all: LessonDebug = { lesson: doc, events: [...events], debug: [...debug] };
    console.log(timeline(all));
    const file = resolve(args.json ?? join(ROOT, ".data", "lesson-debug", `${lessonId}.json`));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
    console.log(`\nJSON dump: ${file}`);
    console.log(`Worker log lines (Railway, optional; not run): ${railwayCommand(lessonId)}`);
  }
} finally {
  await close();
}
