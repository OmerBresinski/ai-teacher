"""D36 lesson gate (Greg, 9 Oct; BAKEOFF/ab/DECISIONS.md D36): lessongate.py <runs dir> [<eval dir>] -> one JSON line.

Hard rule, per lesson: every objective is taught (objectives.json: each objective's `taught` is non-empty),
AND the lesson has at least one lesson-level check where all pupils answer: a shipped slide planned as a
hinge or exit ticket (the writer's template in main.json), or shipped with that kind when the plan does not
line up with the deck. Discussion never counts (DISCUSSION_COUNTS_AS_CHECK=false).
exit1 (rulings 141/148): a code-placed exit ticket also counts. lesson.json's `exitTicket` holds its 2-3
questions and its slide: "Before you go" with the questions (onSlides), or ruling 141's closing slide
pointing to the worksheet, which keeps the questions. That slide is not in the writer's plan.
Soft score, reported and compared but never a pass rule: the share of objectives with a check slide
(`checked` non-empty).
A finished lesson with no readable objectives.json fails the hard rule and is listed (never dropped, F6).
The eval dir defaults to BAKEOFF/eval/out/AB-<run> when the runs dir is BAKEOFF/ab/runs/<run>/T."""
import json, os, sys

LESSON_CHECK_TEMPLATES = {"hinge", "exit-ticket"}
LESSON_CHECK_KINDS = {"hinge", "exit-ticket", "exit"}


def load(p):
    try:
        with open(p) as f: return json.load(f)
    except Exception: return None


def finished(r):
    try:
        with open(f"{r}/log.jsonl") as f: return any('"ev":"summary"' in line.replace(" ", "") for line in f)
    except OSError: return False


def lesson_checks(r):
    """Slide numbers (1-based) of the shipped lesson-level checks (hinge or exit ticket)."""
    lesson = load(f"{r}/lesson.json") or {}
    slides = lesson.get("slides") or []
    try: plan = json.loads((load(f"{r}/main.json") or {})["text"]).get("slides") or []
    except Exception: plan = []
    et = lesson.get("exitTicket") if isinstance(lesson.get("exitTicket"), dict) else None
    code_n = et.get("slide") if et else None
    is_code = lambda i, sl: code_n is not None and (sl.get("id") == f"s{code_n}" if sl.get("id") else i + 1 == code_n)
    shipped_code = [i for i, sl in enumerate(slides) if is_code(i, sl)]
    aligned = len(plan) == len(slides) - 2 - len(shipped_code)
    out = []
    for i, sl in enumerate(slides):
        if i < 2: continue
        if i in shipped_code:
            q = et.get("questions") or []
            if 2 <= len(q) <= 3 and (not et.get("onSlides") or str(sl.get("kind")) in LESSON_CHECK_KINDS):
                out.append(i + 1)
            continue
        tpl = str(plan[i - 2].get("template")) if aligned else None
        if tpl in LESSON_CHECK_TEMPLATES or (not aligned and str(sl.get("kind")) in LESSON_CHECK_KINDS) or str(sl.get("kind")) in ("exit-ticket", "exit"):
            out.append(i + 1)
    return out


def lesson_gate(r, e):
    """D36 verdict for one lesson dir r, with its eval dir e (holding objectives.json)."""
    checks = lesson_checks(r)
    oj = load(f"{e}/objectives.json") if e else None
    s = oj.get("summary") if isinstance(oj, dict) else None
    if not isinstance(s, list) or not s:
        return dict(objectives=None, allTaught=False, lessonCheck=bool(checks), checkSlides=checks, objectivesChecked=0.0,
                    passed=False, missingObjectives=True, version=None)
    taught = all(o.get("taught") for o in s)
    soft = sum(1 for o in s if o.get("checked")) / len(s)
    # Greg, 9 Oct (CHECKER-AUDIT): a check placed before the teaching (a prediction or hook) does not
    # count. A lesson-level check counts only when the summary's
    # ordered `checked` lists hold it (a cite after its objective's first taught slide, score.ts v4),
    # or it is the code-placed exit ticket (always last). On by default, in step with the writer's
    # coverageExcludesPrediction; LESSONGATE_CHECK_AFTER_TEACHING=0 turns it off.
    ok = checks
    if os.environ.get("LESSONGATE_CHECK_AFTER_TEACHING") != "0":
        cited = {c if isinstance(c, int) else (c or {}).get("slide") for o in s for c in (o.get("checked") or [])}
        code_n = (load(f"{r}/lesson.json") or {}).get("exitTicket", {}) or {}
        code_n = code_n.get("slide") if isinstance(code_n, dict) else None
        ok = [n for n in checks if n in cited or n == code_n]
    return dict(objectives=len(s), allTaught=taught, lessonCheck=bool(ok), checkSlides=ok,
                untaught=[o.get("id") for o in s if not o.get("taught")], objectivesChecked=round(soft, 3),
                passed=taught and bool(ok), missingObjectives=False, version=oj.get("version"))


def eval_dir_for(runs_dir):
    p = os.path.abspath(runs_dir).rstrip("/")
    run = os.path.basename(os.path.dirname(p)) if os.path.basename(p) == "T" else os.path.basename(p)
    bake = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(p)))) if os.path.basename(p) == "T" else None
    return f"{bake}/eval/out/AB-{run}" if bake else None


def run_gate(runs_dir, eval_dir=None):
    eval_dir = eval_dir or eval_dir_for(runs_dir)
    per = {}
    for les in sorted(os.listdir(runs_dir)):
        r = os.path.join(runs_dir, les)
        if not os.path.isdir(r) or not finished(r): continue
        per[les] = lesson_gate(r, f"{eval_dir}/{les}" if eval_dir else None)
    n = len(per)
    return dict(lessons=n, passed=sum(v["passed"] for v in per.values()), allTaught=sum(v["allTaught"] for v in per.values()),
                lessonCheck=sum(v["lessonCheck"] for v in per.values()),
                objectivesCheckedSoft=round(sum(v["objectivesChecked"] for v in per.values()) / max(1, n), 3),
                missingObjectives=[k for k, v in per.items() if v["missingObjectives"]],
                versions=sorted({str(v["version"]) for v in per.values() if v["version"]}),
                failed={k: v for k, v in per.items() if not v["passed"]}, evalDir=eval_dir,
                rule="D36: every objective taught AND >= 1 hinge or exit-ticket check, every lesson; per-objective checks are soft")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a: sys.exit("usage: lessongate.py <runs dir> [<eval dir>]")
    print(json.dumps(run_gate(a[0], a[1] if len(a) > 1 else None)))
