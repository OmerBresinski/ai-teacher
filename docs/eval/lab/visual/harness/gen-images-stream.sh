#!/bin/zsh
# Stream mode (PLAN_WRITE_MODE=stream, the default since pv-pw 30 Sep). Generate lessons through fit-drive (plan-write, Sol planner) with illustrate ON when a Pexels key
# is in the environment, OFF otherwise (the flag is fit-drive's --images <photoDir>).
# Usage: WT=<plan-write checkout> [PEXELS_API_KEY=...] harness/gen-images-stream.sh <tag> <cap usd> <brief.json>...
# Output: runs/<tag>/<brief>.lesson.json + rows.jsonl; photos under stack/storage (render.ts serves
# them). Ledger: spend/<tag>.json (hard guard, reserve RESERVE, default 0.05). WT=<worktree> (required,
# read-only), PLANNER=<model> (default openai/gpt-6.1-sol).
V="${0:a:h:h}"
TAG=$1 CAP=$2; shift 2
WT=${WT:?set WT to a checkout of spike/plan-write}
IMG=()
if [[ -n "$PEXELS_API_KEY" ]]; then IMG=(--images $V/stack/storage); else echo "no PEXELS_API_KEY: images OFF" >&2; fi
mkdir -p $V/runs/$TAG $V/spend
BRIEFS=(${@:A})
cd $V/../fit-lab
PLAN_WRITE_MODE=stream PLAN_WRITE_PLANNER_MODEL=${PLANNER:-openai/gpt-6.1-sol} bun harness/fit-drive.ts --worktree $WT --planner plan-write \
  --tag vis-$TAG --out $V/runs/$TAG --budget-file $V/spend/$TAG.json --cap $CAP --reserve ${RESERVE:-0.05} $IMG $BRIEFS
