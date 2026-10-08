# A/B response cache (8 Oct)

## How to use
- Code-only arm: `run.ts --arm <base> --replay <baseRun> --code-arm <arm> [--offline]`, then `metrics.py <arm>/T --paired-with <baseRun>/T`.
- Prompt arm: run as before (no `--replay`): every call is fresh, so writer variance stays.

Code-side changes (rendering, drawing, layout, gates, metrics) no longer need the prompt stack called
again. A run replays its base's model responses at $0. Only calls whose compiled request changed go to
the API.

## How it works

- **One choke point.** `run.ts` swaps `globalThis.fetch` for the cache's fetch (`ab/cache.ts`) for each
  lesson. Everything outside goes through it: writer stream, notes, repair, diagram spec, picture
  director, picture judges, set judge, image generation and edits, embeddings, Pexels and Commons
  search, and photo downloads. Localhost (web, API) is never cached.
- **Exact key.** sha256 of method + URL + body. The body uses sorted keys. Data URLs and uploaded files
  are replaced by their own sha256. The model id, every parameter, system, user, schema and images are
  therefore all in the key. Headers are left out of the key, including the API keys. A served response
  always matches the key exactly. Nothing fuzzy is ever served: the legacy importer serves only the
  writer, and only when the text actually sent is provably the old run's (audit F1, below).
- **Bytes, not text.** Bodies are stored and served as raw bytes. A photo download replays byte-exact,
  and a stored body is served only if it still hashes to its recorded sha. Only JSON and SSE bodies are
  decoded, to zero their usage (audit F2; before this fix a replayed JPEG came back with every invalid
  UTF-8 byte as U+FFFD).
- **Order.** The n-th call of a key in a lesson gets the replayed run's n-th recorded response. A retry
  or regeneration of the same request is not collapsed into one response. Failed responses (non-2xx)
  are never served.
- **$0 on a hit.**
  - The served body has its `usage` zeroed, so every cost path books $0. This covers the AI SDK
    director and judge log, image `costUsd` and embeddings.
  - The original usage and cost travel in the `x-ab-cache-usage` and `x-ab-cache-usd` headers.
  - `chat()` and `chatStream()` return the original `usage`, `usd: 0` and `cached: true`.
- **Logged for replay.** Every call a run makes goes to `<lesson>/calls.jsonl`, one line per call. Each
  line holds the key, n, stage, cached or fresh, cost and response sha. The full request is in
  `calls/<key>.req.json` and the bodies are in `calls/blobs/`. Every run from now on is replayable by
  itself. The shared store is `lab/bakeoff/ab/cache/` (gitignored).
- **Summary.** Each lesson writes `cache.json`, adds an `{"ev":"cache"}` line to `log.jsonl` and prints a
  line on stdout. The summary gives policy, callsMade, callsCached, imported, refused, spentUsd,
  savedUsd and a per-stage breakdown.

## Flags (`run.ts`)

| flag | effect |
|---|---|
| (none) | **Safe default:** no reads, so every call is fresh. Calls are still recorded. |
| `--replay <runDir>` | Serves only that run's recorded responses: `<runDir>/T/<brief>`, `<runDir>/<brief>` or the lesson dir. Unchanged requests are served at $0. A changed request has a new key, so it is called fresh. The log note says this. A *file* path still means the old writer-stream replay. |
| `--offline` | A miss throws instead of calling out. This proves a $0 run, and refusals are counted. It also skips the paid-run pin check. |
| `--no-cache` | No reads at all, even with `--replay`. |
| `--cache-any` | Serves from the whole store. Opt-in only: two reps of a prompt arm would then share one writer output. |
| `--code-arm <arm>` | Takes that arm's code switches (polish, polish2, fixes, r2, …). Prompts, schemas and picture versions stay the `--arm` ones. This is how to run a code-only A/B on the base's writer. |

Prompt A/Bs keep their writer variance. Their changed stages have new keys, so they are called fresh.
Two reps of the same arm only share outputs under `--cache-any`.

**Caveat.** Hits book $0, so a replay can pass cap holds that refused in the original run. On a
non-offline replay those steps would then be called fresh. Example: base4-3 y1's lesson notes had
`notes-refused` in the original. In the replay the notes call was attempted and refused offline 4
times. The outcome was the same: no notes.

## Importer for older runs (`ab/cache-import.ts`)

Older runs have no `calls.jsonl`. For those, `--replay` imports from their logs. Only the **writer**
can be tied to the live request exactly, so only the writer is imported. It is stored under the live
request's exact key, with `verify: "exact-sha"` in `calls.jsonl`:

- **writer** `exact-sha`: model, effort, sha(template system) and sha(schema) must equal request.json's
  `systemSha` and `schemaSha`, and the user text must be the same. The text actually sent must also be
  the old run's: request.json's `sentSystemSha` and `sentUserSha` when it has them (written from 8 Oct,
  audit F7). Older request.json files have only the template sha, so the sent system and user must
  equal the template (no locale token filled). That holds for the old run too, so the match is exact.
  A locale arm's old writer (base5) is therefore not importable. The response is `stream.txt` played
  as SSE.
- **Not replayable from old logs** (audit F1, 8 Oct): lesson notes and repairs. Their full requests
  were never logged. The old matchers (`lesson-context`: the notes user turn contains the logged
  context block; `slide-json`: the request contains the logged slide JSON) are retired. They served
  base4's notes to a code arm whose slides had changed (notes describing a picture the slide no longer
  had). These calls are now called fresh, or refused under `--offline`.
- **Not importable:** picture, judge, image and diagram-spec requests were never logged. Old runs use
  `--reuse-visuals <lessonDir>` for those. Runs from now on replay them through the cache.

## Paired metrics

```
python3 BAKEOFF/ab/metrics.py <armRun>/T --paired-with <baseRun>/T
```

This compares slide by slide, from slide 3, and prints `writerSame` (stream sha equal), `slidesChanged`,
the per-metric `delta` and each change. Without the flag the output is unchanged: the full run output
was diffed against the old script. The paired version is committed as `lab/bakeoff/ab/metrics.py`
(a copy of `BAKEOFF/ab/metrics.py`, which is outside git; the two are identical).

`bun lab/bakeoff/ab/cache-diff.ts <runA> <runB> [--ignore <regex>]` diffs shipped slides, ignoring ids.

## Proof at $0 (8 Oct, base4-3)

Command per brief (outputs in `cache/proof/`):

```
run.ts --arm base4 --cap 0.10 --pg 5636 --no-render --objectives-from round5/... \
  --replay ab/runs/base4-3 --reuse-visuals ab/runs/base4-3/T/<b> --offline --out cache/proof/base4-3-replay <b>
```

**Replay of base4-3:** 6 lessons, 23 calls imported, 0 made, 0 refused apart from y1's notes (see the
caveat), $0 spent, $0.235 saved.

- **72/72 slides are identical** in text, layout, diagrams and picture src and geometry.
- The only differences are picture attribution (`source.*`, and image `style` illustration→photo) on
  13 slides. These come from the old `--reuse-visuals` path, which does not carry stored attribution.
  The cache is not involved.
- Paired metrics against base4-3: writerSame 6/6, slidesChanged 0, delta {}.

**polish2's code-only parts, redone 8 Oct (audit F1).** The first proof imported base4's notes and
repairs through the retired loose matchers, so its notes were written for slides it does not ship. It is
superseded. The redo runs both sides with the exact-only importer, offline, so the writer is the only
imported call and notes and repairs are refused in both (outputs in `cache/proof/base4-3-replay-v2/`
and `cache/proof/polish2code-v2-base4-3/`):

```
run.ts --arm base4 [--code-arm polish2] --cap 0.10 --pg 5636 --no-render --objectives-from round5/runs/T/<b> \
  --replay ab/runs/base4-3 --reuse-visuals ab/runs/base4-3/T/<b> --offline --out cache/proof/<dir> <b>
```

- Both sides: 6 lessons, 6 writer imports (exact-sha), 0 calls made, $0. Notes and repairs refused
  (4 to 14 per lesson), identically on both sides. Every lesson finished (summary event).
- **61/72 slides identical**, writerSame 6/6. The 11 that differ:
  - all 6 title slides: the code title subtitle "Year N Subject" replaces the writer's recall line;
  - 4 redrawn diagram SVGs (y12 s10, y8 s4 and s9, y11 s12; the first proof also had y1 s10);
  - y11 s4: relaid text at full width, with one more element.
- Paired metric delta: `elements` +1 (y11 s4), slidesChanged 5 from slide 3. No other metric changes.
- This proves the code-only effect on unrepaired slides without notes. A code-only claim about repairs
  or notes needs those stages called fresh (not `--offline`), and pays for them.
- Overflow was not measured (`--no-render`). Run `render.ts` on the proof dirs to add it.
