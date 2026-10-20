# Lesson debug

Root-cause one lesson's generation from what the database kept, without re-running it (Greg,
20 Oct 2026; ADR 0015 amendment of that date). Read-only.

```sh
DATABASE_URL=postgres://… bun tools/lesson-debug/run.ts <lessonId> [--json <file>]
```

It prints:

1. the lesson's `generation` block (stage, job, usage, findings, prompt versions);
2. one timeline, in time order, of the lesson's `job_events` (every job the lesson names: its
   lock, its last generation, its plan, and every job in its debug rows) and its
   `generation_debug` rows, one line each: model calls with tokens, cost and time; the plan; the
   writer's output size and finish; each slide's check, repair, split and picture decision;
   fact-check changes; the budget stop; a stage's or a job's full error with its first stack line;
3. where it wrote the JSON dump of all three (default `.data/lesson-debug/<lessonId>.json`, which
   holds every payload in full: the writer's raw text, slides before and after a repair);
4. the `railway logs` command that filters the worker's log lines by `lessonId`. It is printed,
   never run.

Debug rows are kept for `GENERATION_DEBUG_TTL_DAYS` (default 30); an older lesson shows only its
generation block and job events.

Against production, use a read-only connection string from Railway (the `postgres` service's
public URL) and never write with it. The dump holds lesson content: keep it on your machine.

Tests: `bun test tools/lesson-debug` (the timeline on `fixtures/lesson.json`).
