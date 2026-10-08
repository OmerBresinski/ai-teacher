#!/bin/zsh
# A/B gate on the shipped state: gate.sh <runs dir> [<eval dir>]. $0. Canonical copy in git
# (lab/bakeoff/ab/gate.sh); BAKEOFF/ab/gate.sh only forwards here.
# Shipped metrics (metrics.py v2, next to this file) on the set and on round 5 as it shipped
# (round5/runs/T); exits 1 if the set is worse than round 5 on any gated metric:
#   visuals shown on teaching slides >= round 5    text chars per shipped slide <= round 5 + 10%
#   shipped overflow per slide <= round 5          label strings <= round 5 (and 0 expected)
#   dangling slides per slide <= round 5
# Text-only per teaching slide is 1 - visuals shown on the same slides (metrics v2, audit F4): it is
# printed for reading, never gated on its own.
# D36 (Greg, 9 Oct), hard and absolute: every finished lesson teaches every objective AND has at least
# one hinge or exit-ticket check (lessongate.py, reading eval/out/AB-<run>/<lesson>/objectives.json).
# A check per objective is a soft score: printed, never a pass rule.
HERE=${0:A:h}
B=${BAKEOFF:-/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF}
[ -d "$1" ] || { echo "usage: gate.sh <runs dir> [<eval dir>]"; exit 2; }
NEW=$(python3 $HERE/metrics.py "$1") || exit 2
R5=$(python3 $HERE/metrics.py $B/round5/runs/T) || exit 2
D36=$(python3 $HERE/lessongate.py "$1" ${2:+"$2"}) || exit 2
python3 - "$NEW" "$R5" "$D36" <<'PY'
import json, sys
n, r5, g = (json.loads(x) for x in sys.argv[1:4])
rate = lambda m, k, d="slides": m[k] / max(1, m[d])
rows = [
    ("visuals shown (teaching slides)", n["visualShown"], r5["visualShown"], n["visualShown"] >= r5["visualShown"]),
    ("text chars per shipped slide", n["textChars"], r5["textChars"], n["textChars"] <= r5["textChars"] * 1.10),
    ("shipped overflow per slide", round(rate(n, "shippedOverflow"), 3), round(rate(r5, "shippedOverflow"), 3), rate(n, "shippedOverflow") <= rate(r5, "shippedOverflow")),
    ("label strings", n["labelStrings"], r5["labelStrings"], n["labelStrings"] <= r5["labelStrings"]),
    ("dangling slides per slide", round(rate(n, "dangling"), 3), round(rate(r5, "dangling"), 3), rate(n, "dangling") <= rate(r5, "dangling")),
    ("D36 lessons passing (hard)", f"{g['passed']}/{g['lessons']}", "-", g["lessons"] > 0 and g["passed"] == g["lessons"]),
]
info = [
    ("text-only (1 - visuals; not gated)", round(rate(n, "textOnlyTeach", "teach"), 3), round(rate(r5, "textOnlyTeach", "teach"), 3)),
    ("D36 every objective taught", f"{g['allTaught']}/{g['lessons']}", "-"),
    ("D36 hinge or exit-ticket check", f"{g['lessonCheck']}/{g['lessons']}", "-"),
    ("objectives with a check (soft)", g["objectivesCheckedSoft"], "-"),
]
print(f"{'gate (shipped state)':36} {'this set':>10} {'round 5':>10}  verdict")
for name, a, b, ok in rows: print(f"{name:36} {a!s:>10} {b!s:>10}  {'pass' if ok else 'FAIL'}")
for name, a, b in info: print(f"{name:36} {a!s:>10} {b!s:>10}  info")
print(f"lessons {n['lessons']}, slides {n['slides']}, geom missing {n['missingGeom']}, failed {n.get('failedLessons', 0)}; round 5 lessons {r5['lessons']}, slides {r5['slides']}")
for les, v in g["failed"].items():
    why = ["no objectives.json"] if v["missingObjectives"] else ([f"untaught {', '.join(map(str, v['untaught']))}"] if not v["allTaught"] else []) + ([] if v["lessonCheck"] else ["no hinge or exit ticket"])
    print(f"D36 FAIL {les}: {'; '.join(why)}")
if len(g["versions"]) > 1: print(f"FAIL: objectives.json versions are mixed ({', '.join(g['versions'])})")
if n["missingGeom"]: print("FAIL: render every run before gating (render.ts writes geom.json)")
sys.exit(0 if all(r[-1] for r in rows) and not n["missingGeom"] and len(g["versions"]) <= 1 else 1)
PY
