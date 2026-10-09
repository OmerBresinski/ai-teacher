# Teacher's path

The gate for every pipeline PR (TEACH-227 part b). It measures what a teacher experiences,
through the real product, instead of the pipeline's own counters: a Playwright script drives the
real web app, api and worker, started from the checked-out code, exactly as a teacher would.

Brief → objectives → slide count → go → wait → type into a slide → reload → Export → PDF.

It is not run in CI. Run it locally on a PR's branch and paste the `report.md` table into the PR.

## What it records

All times are seconds from **go** (the last click that starts generation), read off the page.

| check | how it is observed |
| --- | --- |
| first visible slide | the first `[data-slide-root]` on screen |
| first slide editable | typing into slide 1 shows the text (double-click, type, read it back) |
| all slides editable | typing into the last slide works, counted only once the deck stopped growing |
| pictures in | the last change to the saved document's picture `src`s (polled), with 30 s of quiet after done |
| done | the generating shell is gone and the editor is up |
| edit saves | three typed markers (during generation, last slide, after done) are in the document the api returns after a reload (never what the page shows) |
| failed writes | every non-GET api response of 400 or more, and every failed request, from the network log |
| Export → PDF | Export, Export PDF, and the print view renders at least one page per slide |
| slides delivered vs requested | the saved document's slide count against the count chosen on the objectives step |
| picture sources | per picture in the saved document: `stock` (Pexels, Commons), `generated`, `library` (a stored picture made before this lesson started, read from its uuidv7 key), `diagram` |
| text-only teaching slides | teaching slides (not the kinds in `teachingKindsExcluded`, no question) with no picture or diagram |
| figures dropped | the worker's `visual-path` log lines ending in words or a drop (the saved document cannot show a figure that was asked for) |
| objective coverage | a code check of `teaches` when the saved document carries it (master does not), and one small-model call that lists the slides teaching and checking each objective from the slide text; its cost is logged |
| console and network errors | page console errors and api or asset responses of 400 or more (`ignoreNetwork` lists the expected ones) |
| screenshots | every slide at 1440 × 900, light theme, under `<brief>-<who>/slides/` |

Pass and fail come from `thresholds` in `config.json`.

## Modes

- **paid** (default): generates for real with the OpenAI and Pexels keys (`OPENAI_API_KEY`,
  `PEXELS_API_KEY`, or `~/.dayback-openai-key` and `~/.dayback-pexels-key`). Needs
  `--stop-usd` (refused above 49.80) and `--spend <ledger.md>`. It writes a BEFORE row, reserves
  each lesson's worst case (`ceilingPerLessonUsd`) before it starts, refusing when the ledger plus
  everything spent plus that reserve passes the stop, and writes an AFTER row. A lesson's spend is
  priced from the worker's and api's per-call log lines over that lesson, and the picture
  generator's log. It fails closed: if those logs are missing or unreadable, the lesson keeps its
  full reservation as spent and the run stops. `bun test tools/teacher-path` covers the guard.
- **cheap**: replays a lesson recorded by a paid run (`<out>/recording/`). It signs in, seeds the
  lesson through `POST /__test/seed-library` with its pictures, and runs the UI checks (open,
  type, reload, export, screenshots, sources). Only the objective check spends (about $0.002; skip
  it with `--no-objective-check`). It writes no ledger rows.
- **fake**: the paid path over the worker's scripted fake (`AI_FAKE_SCRIPT=pipeline`). Free; it
  checks this tool, not the pipeline.

```sh
# Paid: two briefs, as a guest and signed in
bun tools/teacher-path/run.ts --stop-usd 49.80 --spend ../quality-prd/SPEND.md --briefs 1,2

# Cheap: UI checks on a recorded lesson
bun tools/teacher-path/run.ts --mode cheap --recording .data/teacher-path/<run>/recording --briefs 1

# Free: check the tool itself
bun tools/teacher-path/run.ts --mode fake --briefs 1 --who signed-in
```

Flags: `--briefs 1,2` (1-based, or brief ids; default all four), `--who guest,signed-in`,
`--out <dir>` (default `.data/teacher-path/<time>`, gitignored), `--config <file>`,
`--label <text>` (for the ledger rows).

## Briefs

Four fresh briefs, none of the lab's topics: KS3 science (adaptations, the natural world), KS4
history, KS2 geography and KS1 maths. The brief screen offers Years 3 to 11 only, so a KS1 brief
is seeded as the remembered class (`tj:brief:last-class`), and the report says so.

## Environment

- Its own ports, from `config.json` (5780 api, 5781 worker, 5782 web, a production `vite build`
  plus `vite preview`), and its own database (`tj_teacherpath`), created on the running Postgres
  if missing and migrated. It refuses 5174, 3001, 3002 and 5433, and any busy port.
- It never starts or stops Docker. If no Postgres is listening it stops and says so.
- The api runs with `NODE_ENV=test` and `ENABLE_TEST_ROUTES=1` so a signed-in teacher signs in by
  magic link (`GET /__test/last-magic-link`), with Cloudflare's always-pass Turnstile test keys.
- Pictures are stored under `<out>/storage`. Service logs are in `<out>/logs`.

## Output

`<out>/report.md` (the pass/fail table, then per run: lesson id, spend, pictures by slide, the
objective coverage per objective, errors) and `<out>/results.json` (everything, per run).
