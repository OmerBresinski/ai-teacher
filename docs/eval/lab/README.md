# Lab harness (copied from Greg's local lab, 30 Sep 2026)

The scripts that produced the 30 Sep results, so the runs can be repeated. They were untracked lab tools, so expect rough edges.

- `docs/eval/lab/fit-lab/harness/fit-drive.ts`: runs the real lesson pipeline in process against any worktree (no DB, no worker). Hard spend guard between lessons. Reads the OpenAI key from `OPENAI_KEY_FILE` (default `~/.dayback-openai-key`); photos need `PEXELS_API_KEY`.
- `docs/eval/lab/fit-lab/harness/fit-score.ts`: fit and overflow score per deck, measured with a worktree's slides code.
- `docs/eval/lab/fit-lab/briefs/`: the 8 text briefs used in every round.
- `docs/eval/lab/visual/`: the Chalkie-matched visual harness (render stack, renderer, blind packet, unblind) and `docs/eval/lab/visual/VISUAL-JUDGE.md`. See `docs/eval/lab/visual/README.md`.
- `docs/eval/lab/visual/briefs/`: the 9 Chalkie-matched briefs. The `_chalkie` field names a local folder of Chalkie reference slides. Those slides are not in the repo (third-party content); ask Greg for access if you need to re-judge against them.

Not copied: generated decks, judge JSON, render PNGs, the Chalkie reference set and the spend ledgers. Four lab helpers also stayed in Greg's local lab: `harness/sheet.py` (the contact sheet that `docs/eval/lab/visual/harness/build-packet.py` runs), `harness/marks/{T,B}-{teal,white}.png` (the Chalkie wordmark masks it opens at start-up), `harness/chalkie-convert.py` (Chalkie PDF to slide PNGs) and `fit-drive.ts.bak-visual` (fit-drive before `--images`). Without the first two, `build-packet.py` does not run from the repo alone; ask Greg for them with the Chalkie set.
