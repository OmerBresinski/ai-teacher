# Visual judging harness (30 Sep 2026)

This harness compares DayBack and Chalkie decks for the same brief as the class sees them, one PNG per slide. It is separate from the text rubric (DECK-CHECKLIST, job B and job C in `docs/eval`), which still runs on text exports.

Directory: `docs/eval/lab/visual/` in the repo (copied from the local lab) (all commands below run from here).

## 1. Render stack (our decks through the product's own presenter)

```
SCRATCH=<folder holding pv-visual> harness/stack.sh   # api :3641 + web :4641, own Postgres :5641
```

The stack runs on the `pv-visual` worktree, a detached worktree at spike/plan-write 75dadbe3 whose root `.env` sets `COMPOSE_PROJECT_NAME=tj-wt-pv-visual` and `TJ_PG_PORT=5641`. `docs/eval/lab/visual/harness/stack.sh` exits unless `SCRATCH` is set to the folder that holds it (`$SCRATCH/pv-visual`). It never touches 5433, 5174, 3001 or 3002. To stop it, kill the bun and vite processes on 3641 and 4641, then run `docker compose stop` in pv-visual.

## 2. Render a lesson to PNG

```
bun harness/render.ts <outDir> <lesson.json>...       # -> <outDir>/<lesson>/slide-NN.png
```

- The renderer seeds each lesson into a fresh test workspace.
- It opens `/l/<id>/present?slide=n` at 1440×810 on the light theme, at reveal step 0 (answers hidden, as the class first sees the slide).
- It hides the presenter's floating control bar and the dev overlays.
- Env options: `ONLY=1,3` renders only those slides; `STEPS=n` advances n reveals first.
- Placed photos: `docs/eval/lab/visual/harness/render.ts` intercepts `/files/<key>` and serves the bytes from `docs/eval/lab/visual/stack/storage/<key>` (or from `VISUAL_PHOTOS`), because the api's `/files` route is workspace-scoped. This is not yet exercised with a real photo.

## 3. Generate (plan-write, Sol planner, images flag)

```
WT=<plan-write checkout> [PEXELS_API_KEY=…] harness/gen-images-stream.sh <tag> <capUsd> briefs/<id>.json...
```

- This wraps `docs/eval/lab/fit-lab/harness/fit-drive.ts`. It uses `--planner plan-write` with `PLAN_WRITE_PLANNER_MODEL=openai/gpt-6.1-sol`, writers on gpt-6-luna low, and the checkout in `WT` (required, read-only; Greg used a worktree named pv-pw).
- Output goes to `runs/<tag>/`. The ledger is `spend/<tag>.json`.
- fit-drive has a new opt-in flag, `--images <photoDir>`. It turns illustrate on with the same Pexels search and store as the worker's `imagePlacer`, and writes the bytes to `<photoDir>/<key>`. The flag needs `PEXELS_API_KEY` in the environment and exits with code 2 without it.
- Without the flag, fit-drive runs exactly as before. The backup, `fit-drive.ts.bak-visual`, stayed in Greg's local lab and is not in the repo.
- Plan-write only places photographs, on its `photo` form. Diagrams stay as "Diagram to add: …" placeholder zones, and the class sees them.

**Cost per lesson.**
- Measured with images off: pilot y8-rivers-flooding-new cost $0.0221 over 17 calls, editable at 48.5 s (Sol planner). pw2 S2 averaged about $0.028.
- With images on: not measured (see Blockers). Pexels is free. Each photo slide adds a caption-shortlist call and a vision pick, plus at most one re-query, on the small class. Estimate: +$0.002–0.004 per photo slide, so about $0.03 per lesson with 2–3 photos.

## 4. Chalkie side

```
python3 harness/chalkie-convert.py <deck.pdf> chalkie/<id>
```

`harness/chalkie-convert.py` is not in the repo; it stayed in Greg's local lab with the Chalkie reference set (see `docs/eval/lab/README.md`).

- Output: `all/page-NN.png` (every page), `slide-NN.png` (kept slides) and `manifest.json`.
- Answer pages are dropped and listed in the manifest. A page counts as an answer page when its text repeats the previous page (≥90% of its words) or it carries Chalkie's green answer tick in the top-right corner.
- All 9 decks are already converted, with these answer pages dropped:

| chalkie/ id | pages → slides | answer pages dropped | brief (`briefs/`) |
|---|---|---|---|
| y8-rivers-flooding-new (Downloads, Rivers and Flooding (1).pdf) | 12 → 10 | 10, 12 | y8-rivers-flooding-new |
| particle-model-new (Downloads, The Particle Model.pdf) | 7 → 6 | 7 | y7-particle-model-new (Year 7 Science **assumed**: no settings file) |
| y1-science-animals-young | 13 → 10 | 7, 11, 13 | same id |
| y10-english-tempest-prospero | 12 → 10 | 10, 12 | same id |
| y11-chemistry-rates-of-reaction | 11 → 10 | 10 | same id |
| y13-psychology-freud | 11 → 10 | 10 | same id (the "supporting and contrasting schools" note is in the topic) |
| y4-history-romans | 12 → 10 | 8, 12 | same id |
| y5-maths-fractions-of-amounts | 11 → 10 | 11 | same id |
| y8-geography-rivers-flooding | 12 → 10 | 10, 12 | same id |

Each brief has the same topic, year and subject as the Chalkie deck, 60 minutes, and slideCount equal to the Chalkie slide count after the drop.

## 5. Blind packet

```
python3 harness/build-packet.py <briefId> <ours render dir> chalkie/<id> --seed=N
```

- Output: `packets/<id>/{X,Y}/slide-NN.png`, `X-sheet.png`, `Y-sheet.png`, `pass-1.md` (Deck 1 = X) and `pass-2.md` (Deck 1 = Y).
- The key goes to `packets/_keys/<id>.json`. Never give that folder to a judge.
- The Chalkie teal wordmark in the top-right and bottom-right corners is painted over with the local background colour. This caught 78 of 86 slides; on the other 8 the mark is hidden behind a photo. Our presenter shows no DayBack mark.
- To judge: give one fresh agent `pass-1.md` and another fresh agent `pass-2.md`. Each reads `docs/eval/lab/visual/VISUAL-JUDGE.md` and writes `judgments/<id>-pass-<n>.json`.
- `python3 harness/unblind.py` maps each verdict back to ours or chalkie.

## Pilot (y8-rivers-flooding-new)

- Ours: `runs/pilot/y8-rivers-flooding-new.lesson.json`, rendered to `runs/pilot/render/y8-rivers-flooding-new/`.
- Chalkie: `chalkie/y8-rivers-flooding-new/`.
- Packet: `packets/y8-rivers-flooding-new/` (ours = X).
- Dry run: `judgments/dry-run/`. The builder knew the key, so this run only proves the packet works. It is not a result.

## Blockers

- **Images on: no Pexels key available to agents.** The production key can be reached only through `railway run`, and the auto-mode classifier blocked that route (credential exploration). Greg either puts a Pexels key in `~/.dayback-pexels-key` and runs `PEXELS_API_KEY=$(cat ~/.dayback-pexels-key) harness/gen-images-stream.sh …`, or runs the wrapper himself under `railway run --service worker`.
