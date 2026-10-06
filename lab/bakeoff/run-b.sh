#!/bin/zsh
# BAKEOFF arm B (the incumbent as it ships: lab/cand + lab/t3-t9, worktree scratchpad/arm-b): the
# FULL-RUN pipeline (objectives on Sol, streamed T3 t9 writer on Sol, fit, diagrams, picture director
# + stock judge + picture library) via b-drive.ts, then b-post.ts writes BAKEOFF/runs/B/<brief>/.
# B takes an exact slide count, not a range: the Standard tier's middle, 10 (ruling 164 range 9-12).
# Usage: run-b.sh --cap <usd per lesson> [--pg 5616] [--out <runsDir>] <brief-id> ...
# Keys inline from ~/.dayback-*-key; never printed. SPEND rows are the caller's.
O=${0:A:h}; ONE=${O:h:h}
WT=/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/arm-b
B=/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF
CAP=0.10; PG=5616; RUNS=$B/runs
while [[ $1 == --* ]]; do case $1 in --cap) CAP=$2; shift 2;; --pg) PG=$2; shift 2;; --out) RUNS=$2; shift 2;; *) echo "unknown $1"; exit 2;; esac; done
[[ -z $(git -C $WT status --porcelain --untracked-files=no) ]] || { echo "DIRTY WORKTREE $WT"; exit 1; }
for id in "$@"; do
  RUN=$RUNS/B/$id; [[ -f $RUN/lesson.json ]] && { echo "SKIP $id (exists)"; continue; }
  DRIVE=$RUN/drive; mkdir -p $DRIVE
  python3 - "$B/briefs/$id.json" "$DRIVE/brief.json" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))
json.dump({"brief":{"topic":b["topic"],"durationMin":b["durationMin"],"slideCount":10,**({"exitTicketOnSlides":True} if b.get("exitTicketOnSlides") else {})},"subject":b["subject"],"yearGroup":b["yearGroup"]},open(sys.argv[2],"w"))
PY
  mv $DRIVE/brief.json $DRIVE/$id.json
  (cd $ONE && PLAN_WRITE_MODE=simple SIMPLE_CALLS_DIR=$DRIVE/calls PEXELS_API_KEY="$(cat ~/.dayback-pexels-key)" OPENAI_API_KEY="$(cat ~/.dayback-openai-key)" \
    BANK_DB=postgres://postgres:postgres@localhost:$PG/teaching_journey BANK_CAP=0.03 BANK_LOG=$DRIVE/$id.bank.jsonl AI_LOG_FILE=$DRIVE/$id.ai.jsonl \
    PLAN_WRITE_PLANNER_MODEL=openai/gpt-6.1-sol bun $O/b-drive.ts --worktree $WT --planner plan-write \
    --tag BAKEOFF-B --out $DRIVE --budget-file $DRIVE/ledger.json --cap $CAP --reserve 0.06 --images $B/base-pg/store $DRIVE/$id.json \
    > $DRIVE/drive.log 2>&1)
  [[ -f $DRIVE/$id.lesson.json ]] || { echo "FAILED $id (see $DRIVE/drive.log)"; continue; }
  (cd $ONE && bun $O/b-post.ts $DRIVE $id $RUN)
done
