"""A/B round 4 results (D13): base3 full vs base2 round 2: python3 ab/results2.py -> ab/RESULTS5.md. Base is base2 (round 5 + A1).
Shipped metrics use ab/metrics.py (the fixed dangling check, D8). $0: reads saved runs and eval outputs only.
Runs: <arm>-1 and <arm>-2 for base, a1, a2, a3. A lesson counts when its run finished (summary event).
Shipped metrics: round9/metrics.py on the finished lessons (symlinked under ab/complete/<run>).
Eval: reader quiz (reader.json score), objectives taught and checked (objectives.json).
Plan counts from the writer output (main.json): lessons with a recall opener (first teaching slide's
`does`), a worked-example twin, a misconception slide, a prediction slide (keyword reads of the flow's
`does`); ask filled (visuals with a non-null ask); visual requests per teaching slide; writer characters per teaching slide."""
import json, os, glob, re, subprocess, statistics as st
# Tracked on lab/ab as lab/bakeoff/eval/results6.py (eval v4); the run data stays in the BAKEOFF round folder.
B = os.environ.get("BAKEOFF", "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF"); AB = f"{B}/ab"
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ab"))
from lessongate import lesson_gate  # D36 (9 Oct): the hard lesson rule, shared with ab/gate.sh
ARMS = sys.argv[1].split(","); REPS = sys.argv[2].split(",")
RECALL = re.compile(r"recall|retriev|remember|last lesson|earlier (learning|lesson)|already know|review|recap", re.I)
TWIN = re.compile(r"your turn|try (one|it|this|a similar)|on (their|your) own|near-identical|similar (question|problem|one|example)|twin|independent(ly)? (try|practice)", re.I)
MISC = re.compile(r"misconception|common (mistake|error|confusion)|wrong idea|myth", re.I)
PRED = re.compile(r"predict", re.I)
def writer(d):
    try: return json.loads(json.load(open(f"{d}/main.json"))["text"])
    except Exception: return None
def figs(s):
    out = []
    for k in ("figure", "picture"):
        if isinstance(s.get(k), dict): out.append(s[k])
    for c in s.get("columns") or []:
        if isinstance(c, dict) and isinstance(c.get("picture"), dict): out.append(c["picture"])
    if s.get("template") == "picture-sequence": out.append(s)
    return out
def text_chars(s):
    n = 0
    for k, v in s.items():
        if k in ("template", "figure", "picture", "sequence", "correct"): continue
        if isinstance(v, str): n += len(v)
        elif isinstance(v, list):
            for x in v:
                if isinstance(x, str): n += len(x)
                elif isinstance(x, dict): n += sum(len(y) for kk, y in x.items() if isinstance(y, str) and kk in ("label", "text"))
    return n
crash = {}
for l in open(f"{AB}/logs/crashes.log") if os.path.exists(f"{AB}/logs/crashes.log") else []:
    m = re.match(r"(\S+)-(\d) (\S+) (crashed|retry (finished|crashed again))", l)
    if m and m.group(4) == "crashed": crash.setdefault(m.group(1), []).append(f"{m.group(1)}-{m.group(2)} {m.group(3)}")
rows = {}
objv, objmiss = {}, []  # evaluator version -> lessons; lessons with no objectives.json (F3, F6)
for a in ARMS:
    for rep in REPS:
        r = f"{a}-{rep}"; d = f"{AB}/runs/{r}/T"
        if not os.path.isdir(d): continue
        comp = f"{AB}/complete/{r}/T"; os.makedirs(comp, exist_ok=True)
        done = [les for les in sorted(os.listdir(d)) if os.path.exists(f"{d}/{les}/log.jsonl") and '"ev":"summary"' in open(f"{d}/{les}/log.jsonl").read()]
        for les in done:
            if not os.path.lexists(f"{comp}/{les}"): os.symlink(f"{d}/{les}", f"{comp}/{les}")
        m = json.loads(subprocess.run(["python3", f"{B}/ab/metrics.py", comp], capture_output=True, text=True).stdout) if done else {}
        reader, objc, d36 = [], [], []
        plan = dict(recall=0, twin=0, misc=0, pred=0, ask=0, vis=0, teach=0, chars=0, lessons=0)
        for les in done:
            e = f"{B}/eval/out/AB-{r}/{les}"
            try:
                sc = json.load(open(f"{e}/reader.json"))["score"]
                if sc is not None: reader.append(sc)
            except Exception: pass
            # F6 (eval v4): a finished lesson with no readable objectives.json scores 0 and is warned about, never dropped.
            try:
                oj = json.load(open(f"{e}/objectives.json"))
                s = oj["summary"]
                objc.append(sum(1 for o in s if o["taught"] and o["checked"]) / max(1, len(s)))
                objv.setdefault(oj.get("version", "unversioned"), []).append(f"{r} {les}")
            except Exception as ex:
                objc.append(0.0); objmiss.append(f"{r} {les}")
                print(f"WARNING: {r} {les}: no readable objectives.json ({type(ex).__name__}); counted as 0", file=sys.stderr)
            d36.append(lesson_gate(f"{d}/{les}", e))
            w = writer(f"{d}/{les}")
            if not w: continue
            plan["lessons"] += 1
            flow = {f.get("slide"): f.get("does", "") for f in w.get("flow", [])}
            does = " | ".join(flow.values())
            plan["recall"] += bool(RECALL.search(flow.get(3, "")))
            plan["twin"] += bool(TWIN.search(does)); plan["misc"] += bool(MISC.search(does)); plan["pred"] += bool(PRED.search(does))
            for s in w.get("slides", []):
                plan["teach"] += 1; plan["chars"] += text_chars(s)
                fs = figs(s); plan["vis"] += bool(fs)
                plan["ask"] += sum(1 for f in fs if f.get("ask"))
        rate = lambda k, den="slides": m[k] / max(1, m[den]) if m else None
        rows[r] = {
            "lessons finished (first try + retry)": len(done),
            "visuals shown (teaching slides)": m.get("visualShown"),
            "characters per shipped slide": m.get("textChars"),
            "shipped overflow per slide": rate("shippedOverflow"),
            "text-only per teaching slide": rate("textOnlyTeach", "teach"),
            "label strings": m.get("labelStrings"),
            "dangling slides (metrics v2)": m.get("dangling"),
            "dangling per slide": rate("dangling"),
            "reader quiz score": st.mean(reader) if reader else None,
            "D36 hard: lessons passing (every objective taught + a hinge or exit-ticket check)": sum(x["passed"] for x in d36),
            "D36 hard: lessons with every objective taught": sum(x["allTaught"] for x in d36),
            "D36 hard: lessons with a hinge or exit-ticket check": sum(x["lessonCheck"] for x in d36),
            "D36 soft: objectives with a check slide": st.mean(x["objectivesChecked"] for x in d36) if d36 else None,
            "objectives taught and checked (soft, pre-D36 measure)": st.mean(objc) if objc else None,
            "plan: recall opener (lessons)": plan["recall"], "plan: worked-example twin (lessons)": plan["twin"],
            "plan: misconception slide (lessons)": plan["misc"], "plan: prediction slide (lessons)": plan["pred"],
            "plan: ask filled (visuals)": plan["ask"],
            "plan: visual requests per teaching slide": plan["vis"] / max(1, plan["teach"]),
            "plan: writer characters per teaching slide": plan["chars"] / max(1, plan["teach"]),
        }
# F3 (eval v4): one table, one evaluator. Mixed objectives versions are refused and listed.
if len(objv) > 1:
    for v, ls in sorted(objv.items()): print(f"  {v}: {len(ls)} lessons, e.g. {ls[0]}", file=sys.stderr)
    raise SystemExit(f"refusing: objectives.json versions are mixed ({', '.join(sorted(objv))}); re-score them to one version first")
num = lambda v: isinstance(v, (int, float))
f = lambda v: "n/a" if v is None else (f"{v:.3f}" if isinstance(v, float) else str(v))
out = ["# A/B round 2 (D8): base2 (round 5 + A1) against b2-a2 and b2-a3, two reps each", "",
       "Generated by ab/results.py from ab/runs/<arm>-<rep>/T and eval/out/AB-<arm>-<rep>. No verdicts: blind judges come next.",
       "base2 = a1 byte for byte (T hash 6232ede0dd40; b2-a2 7d0d355e5470, b2-a3 4ef274a04edc; D4a). Band = |base2-1 - base2-2|, the gap between two runs of identical code. An arm's mean is set against base's mean, read next to the band.", ""]
out += ["## Crash rate (first attempts; each crashed lesson retried once)", "", "| arm | crashed first try | of | lessons |", "|---|---|---|---|"]
for a in ARMS:
    out.append(f"| {a} | {len(crash.get(a, []))} | 12 | {', '.join(crash.get(a, [])) or '-'} |")
out += ["", "Round 5: 1 of 12. See ab/logs/crashes.log for each crash and its retry.", ""]
metrics = [k for k in next(iter(rows.values()))] if rows else []
for k in metrics:
    b = [rows.get(f"base2-{x}", {}).get(k) for x in REPS]
    band = abs(b[0] - b[1]) if all(num(x) for x in b) else None
    bmean = st.mean(b) if all(num(x) for x in b) else None
    out += [f"## {k}", "", f"Base: {f(b[0])} and {f(b[1])}; band {f(band)}.", "", "| arm | rep 1 | rep 2 | mean | mean - base mean | within band |", "|---|---|---|---|---|---|"]
    for a in ARMS:
        v = [rows.get(f"{a}-{x}", {}).get(k) for x in REPS]
        mv = st.mean(v) if all(num(x) for x in v) else None
        dlt = mv - bmean if num(mv) and num(bmean) else None
        inb = "" if a == "base2" or dlt is None or band is None else ("yes" if abs(dlt) <= band else "no")
        out.append(f"| {a} | {f(v[0])} | {f(v[1])} | {f(mv)} | {'' if a == 'base2' else f(dlt)} | {inb} |")
    out.append("")
out += [f"Objectives evaluator: {', '.join(sorted(objv)) or 'none'}."
        + (f" Missing objectives.json (counted as 0): {', '.join(objmiss)}." if objmiss else ""), ""]
out += ["D36 (9 Oct): an arm passes only when every finished lesson in every rep passes the hard rows (lessons passing = lessons finished). The per-objective check is a soft score, compared but never a pass rule. Text-only per teaching slide is 1 - visuals shown (metrics v2) and is reported, not gated.", ""]
out += ["Plan counts are keyword reads of the writer's flow and slides (results.py); a blind judge should confirm them.", ""]
open(f"{AB}/{sys.argv[3]}", "w").write("\n".join(out))
print("\n".join(out[:20]))
