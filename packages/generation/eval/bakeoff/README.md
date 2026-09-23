# Prompt bake-off runner and scoring kit

Runs contestants' prompts for the two tasks in `scratchpad/quality-prd/lab/pe-bakeoff/BRIEF.md` on
the fixed model (`openai/gpt-5.6-luna`, medium effort) and scores the outputs blind. Data lives in
the lab folder (`dev/`, `test/`, `scoring/`); this directory holds code only. Nothing here writes a
prompt for either task.

```
# expected cost, nothing sent
bun eval/bakeoff/run.ts --prompt prompts/<id>-select.json --task select --set test --out runs/<id>/select --budget 0.10 --dry-run
# live (gateway key via railway)
railway run bun eval/bakeoff/run.ts --prompt prompts/<id>-rewrite.json --task rewrite --set test --out runs/<id>/rewrite --budget 0.10
# blind the contestants' run dirs, then score
bun eval/bakeoff/blind.ts --runs runs/a/select runs/b/select runs/c/select --seed 20260923
bun eval/bakeoff/score-code.ts --blind <lab>/scoring/blind/select-test
```

| file | does |
|---|---|
| `schemas.ts` | the brief's output schemas (zod), placeholders per task, input file shapes, output caps |
| `render.ts` | `{{placeholder}}` rendering: unknown or repeated placeholder is an error, omitted is fine |
| `run.ts` | one prompt × one task × one set → `<out>/results.json` (output, attempts, schema failures, tokens, cost, latency per item; prompt path + sha256 for `blind.ts` to strip); `--dry-run` prices the run |
| `blind.ts` | strips identity, labels runs A/B/C by seeded shuffle, key → `scoring/key.json` (never given to the judge), sets → `scoring/blind/<task>-<set>/<label>.json`; refuses if any identifying string survives |
| `metrics.ts` | pure scoring: longest shared word run (flag ≥ 8), evidence validity, select verdict classes, precision/recall, `missing` hit, seeded shuffle |
| `score-code.ts` | the code-only scores over a blind dir → `code-scores.json` + table |
| `support-checker.ts` | the "supported" score: one Luna call per fact (fact with labelled parts + only its cited sentences) → verdict + ≤ 20-word note; `--blind <dir> [--dry-run]` → `support-scores.json` |
| `rubric-judge.ts` | the rubric score: one call per (label, item) on `anthropic/claude-sonnet-5` (or `--model`) → useful 1–5 per item, pitch 1–5 per set; `--blind <dir> [--dry-run]` → `judge-scores.json` |
| `paraphrase.ts` | data build only: Luna paraphrase of Oak pupil outcomes for the select objectives |
| `bakeoff.test.ts` | rendering, schema enforcement, blind shuffle (key never in `blind/`), overlap metric, select scoring |
