"""Standard blind pairwise set for the bake-off A/B (judging v2, 8 Oct 2026; fixes checking-audit judging F1-F5).

One script replaces blind8.py-blind11.py:
  build  --name S --pair ARMRUN:BASERUN [--pair ...] --seed N   packets, briefs, key (key beside the set, never inside)
  check  --name S                                                leak test + counterbalance test (exit 1 on any leak)
  queue  --name S [--name ...] --models opus,sonnet --out FILE   the judge jobs for the orchestrator (one fresh agent each)
  tally  --name S --models opus,sonnet [--margin 0]              J5-C both-orders tally per judge model and dimension
All paths are under --ab (default $BAKEOFF_AB): runs/<run>/T/<brief>/lesson.json and share/<run>/<brief>.jpg.

Protocol (EVAL-REGISTRY J5-C, as used in J8/J9):
- Each pair has a private A/B assignment. Exactly half the pairs of each rep have the arm as A (counterbalanced, F1).
- Each pair is packed twice: <pid>-o1 shows A as X (first) and B as Y; <pid>-o2 shows B as X. Every packet is
  judged by a fresh agent per judge model; a side wins only when both orders pick it (tally.py, need=1 per model).
- Packets hold only X/Y.jpg (re-encoded, no metadata) and X/Y.json (no timestamps, ids, file names, picture
  sources or credits, writer requests, prompt versions; keys sorted; fixed mtimes) (F4).
- The judge brief is a versioned file (BRIEF), copied into the set with its sha256 in PROTOCOL.json and the key (F5).
- Tally: overall, look, teaching, picture_text per judge. "Not worse" (ROUND6 rule 4): on a dimension the arm is
  not worse than base when base's both-order wins minus the arm's both-order wins <= margin (default 0; ties and
  order splits count as not worse). Rule 4 passes only if look AND teaching are not worse under EVERY judge model.
"""
import argparse, collections, hashlib, json, os, random, re, sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from tally import load as tload, tally as ttally  # noqa: E402

BRIEF = "teacher-pair.v1"
FIELDS = ("pick", "look", "teaching", "picture_text")
FIXED_MTIME = 1767225600  # 2026-01-01T00:00:00Z on every packet file
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
ISO = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d")
DROP = {"bakeoff", "createdAt", "updatedAt", "request", "source", "promptVersion", "evidence", "photographer",
        "photographerUrl", "pageUrl", "thumbnail", "provider", "licence", "seed", "runId", "model", "cost"}
TIMEKEY = re.compile(r"(At|Time|time|Ms|_ms|timestamp|Version)$")


def arm_of(run): return re.sub(r"-\d+$", "", run)


def clean(lesson, side):
    """The deck as a judge may see it: content, layout and alt text only."""
    pics = [0]

    def walk(o, path):
        if isinstance(o, dict):
            out = {}
            for k, v in o.items():
                if k in DROP or (TIMEKEY.search(k) and k != "fitVersion"): continue
                out[k] = walk(v, path + (k,))
            return out
        if isinstance(o, list): return [walk(v, path) for v in o]
        if isinstance(o, str):
            if path[-1:] == ("src",): pics[0] += 1; return f"picture-{pics[0]}"
            return ISO.sub("<time>", UUID.sub("<id>", o))
        return o

    L = walk({k: v for k, v in lesson.items() if k not in ("id", "fitVersion")}, ())
    L["id"] = side
    for si, s in enumerate(L.get("slides", []), 1):
        for ei, e in enumerate(s.get("elements", []), 1):
            if "id" in e: e["id"] = f"s{si}e{ei}"
    return L


def write_img(src, dst):
    im = Image.open(src); im.load()
    im.convert("RGB").save(dst, "JPEG", quality=92)  # no exif, icc or comment carried over
    os.utime(dst, (FIXED_MTIME, FIXED_MTIME))


def write_json(obj, dst):
    with open(dst, "w") as f: json.dump(obj, f, sort_keys=True, ensure_ascii=False)
    os.utime(dst, (FIXED_MTIME, FIXED_MTIME))


def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()


def counterbalance(groups, rng):
    """groups: list of lists of pair ids (one list per rep). Returns {pair: True if the arm is A}.
    Exactly floor/ceil half per group, odd groups alternate so the total is exactly half (or n//2 + 1 when odd)."""
    armA, extra = {}, 0
    for g in groups:
        g = list(g); rng.shuffle(g); k = len(g) // 2
        if len(g) % 2: k += extra; extra ^= 1
        for i, p in enumerate(g): armA[p] = i < k
    return armA


def build(a):
    AB = a.ab; S = f"{AB}/{a.name}"
    if os.path.exists(S): sys.exit(f"{S} exists; pick a new --name (sets are never overwritten)")
    rng = random.Random(a.seed)
    tpl_path = f"{HERE}/{BRIEF}.md"; tpl = open(tpl_path).read()
    groups, meta = [], {}
    for r, spec in enumerate(a.pair, 1):
        arm_run, base_run = spec.split(":")
        briefs = sorted(b for b in os.listdir(f"{AB}/runs/{arm_run}/T") if all(
            os.path.exists(f"{AB}/runs/{run}/T/{b}/lesson.json") and os.path.exists(f"{AB}/share/{run}/{b}.jpg")
            for run in (arm_run, base_run)))
        g = []
        for b in briefs:
            meta[(b, r)] = {"brief": b, "rep": r, "runs": {arm_of(arm_run): arm_run, arm_of(base_run): base_run},
                            "arm": arm_of(arm_run), "base": arm_of(base_run)}
            g.append((b, r))
        groups.append(g)
    allp = [p for g in groups for p in g]
    ids = list(range(1, len(allp) + 1)); rng.shuffle(ids)
    pid = {p: f"q{n:02d}" for p, n in zip(allp, ids)}
    armA = counterbalance(groups, rng)
    os.makedirs(f"{S}/briefs"); os.makedirs(f"{S}/verdicts")
    open(f"{S}/BRIEF-{BRIEF}.md", "w").write(tpl)
    key = {"protocol": "judging v2 (J5-C both orders, one fresh agent per packet per model)", "brief": BRIEF,
           "briefSha256": sha(tpl_path), "seed": a.seed, "pairsSpec": a.pair, "pairs": {}}
    for p in allp:
        m = meta[p]; A, B = (m["arm"], m["base"]) if armA[p] else (m["base"], m["arm"])
        decks = {arm: json.load(open(f"{AB}/runs/{m['runs'][arm]}/T/{m['brief']}/lesson.json")) for arm in (A, B)}
        for o, (X, Y) in (("o1", (A, B)), ("o2", (B, A))):
            d = f"{S}/packets/{pid[p]}-{o}"; os.makedirs(d)
            for side, arm in (("X", X), ("Y", Y)):
                write_img(f"{AB}/share/{m['runs'][arm]}/{m['brief']}.jpg", f"{d}/{side}.jpg")
                write_json(clean(decks[arm], side), f"{d}/{side}.json")
        key["pairs"][pid[p]] = {"A": A, "B": B, "brief": m["brief"], "rep": m["rep"], "runs": m["runs"]}
    json.dump(key, open(f"{AB}/{a.name}-key.json", "w"), indent=1)
    json.dump({"brief": BRIEF, "briefSha256": key["briefSha256"], "packets": sorted(os.listdir(f"{S}/packets")),
               "rule": "a side wins a pair only when both orders pick it"}, open(f"{S}/PROTOCOL.json", "w"), indent=1)
    print(f"{len(allp)} pairs, {2 * len(allp)} packets -> {S}; key {AB}/{a.name}-key.json (private)")


def briefs_for(a, name, models):
    """Instantiate the brief per packet and model. Returns judge jobs."""
    AB = a.ab; S = f"{AB}/{name}"; key = json.load(open(f"{AB}/{name}-key.json"))
    tpl = open(f"{S}/BRIEF-{key['brief']}.md").read(); jobs = []
    if sha(f"{S}/BRIEF-{key['brief']}.md") != key["briefSha256"]: sys.exit(f"{name}: brief changed since build")
    for pk in sorted(os.listdir(f"{S}/packets")):
        p, o = pk.rsplit("-", 1); X = json.load(open(f"{S}/packets/{pk}/X.json"))
        for m in models:
            out = f"{S}/verdicts/{m}/{m}-{o}--{p}.json"; os.makedirs(os.path.dirname(out), exist_ok=True)
            t = tpl
            for k, v in {"{PDIR}": f"{S}/packets/{pk}", "{PAIR}": p, "{JUDGE}": f"{m}-{o}", "{OUTFILE}": out,
                         "{SUBJECT}": X.get("subject", ""), "{YEAR}": X.get("yearGroup", "")}.items():
                t = t.replace(k, v)
            bf = f"{S}/briefs/{pk}-{m}.txt"; open(bf, "w").write(t)
            jobs.append({"set": name, "packet": pk, "pair": p, "order": o, "model": m, "brief": bf, "outfile": out,
                         "done": os.path.exists(out)})
    return jobs


def queue(a):
    jobs = [j for n in a.name for j in briefs_for(a, n, a.models.split(","))]
    q = {"note": "one fresh in-session agent per job (never reuse an agent across packets); models: opus = Opus 5.5, "
                 "sonnet = Sonnet 5; never Fable. The agent's whole prompt is the brief file's text. Then: "
                 "python3 lab/bakeoff/ab/judge/blind.py tally --name <set>", "briefVersion": BRIEF,
         "count": len(jobs), "jobs": jobs}
    json.dump(q, open(a.out, "w"), indent=1)
    print(len(jobs), "jobs ->", a.out)


def flat(o, p="", out=None):
    out = {} if out is None else out
    if isinstance(o, dict):
        for k, v in o.items(): flat(v, f"{p}.{k}", out)
    elif isinstance(o, list):
        for i, v in enumerate(o): flat(v, f"{p}[{i}]", out)
    else: out.setdefault(re.sub(r"\[\d+\]", "[]", p), set()).add(json.dumps(o))
    return out


CONTENT = re.compile(r"(\.text|\.notes|\.alt|\.title|\.name|\.kind|\.shape|\.preset|\.align|\.valign|\.fit|\.type)$")


def leaks(S, key):
    """Every reason a judge could tell the arms apart other than the decks themselves. [] = clean."""
    bad = []; names = {v for pr in key["pairs"].values() for v in [pr["A"], pr["B"], *pr["runs"].values()]}
    name_re = re.compile(r"(?<![\w-])(" + "|".join(map(re.escape, sorted(names, key=len, reverse=True))) + r")(?![\w])")
    by_arm = collections.defaultdict(list)  # (path) -> [(arm, frozenset values)] over o1 packets
    for p, pr in key["pairs"].items():
        for o, (X, Y) in (("o1", (pr["A"], pr["B"])), ("o2", (pr["B"], pr["A"]))):
            d = f"{S}/packets/{p}-{o}"
            if sorted(os.listdir(d)) != ["X.jpg", "X.json", "Y.jpg", "Y.json"]: bad.append(f"{d}: unexpected files")
            if len({int(os.stat(f"{d}/{f}").st_mtime) for f in os.listdir(d)}) != 1: bad.append(f"{d}: mtimes differ")
            for side, arm in (("X", X), ("Y", Y)):
                raw = open(f"{d}/{side}.json").read(); L = json.loads(raw)
                for rx, what in ((UUID, "uuid"), (ISO, "timestamp"), (re.compile(r"/files/|\.bin\b|bank/|pexels|unsplash|wikimedia", re.I), "file/source"),
                                 (name_re, "arm or run name")):
                    if rx.search(raw): bad.append(f"{d}/{side}.json: {what} {rx.search(raw).group(0)!r}")
                for k in re.findall(r'"([A-Za-z_]+)":', raw):
                    if k in DROP or (TIMEKEY.search(k) and k != "fitVersion"): bad.append(f"{d}/{side}.json: key {k}"); break
                im = Image.open(f"{d}/{side}.jpg")
                extra = set(im.info) - {"jfif", "jfif_version", "jfif_unit", "jfif_density", "dpi", "progressive", "progression"}
                if extra or im.getexif(): bad.append(f"{d}/{side}.jpg: metadata {sorted(extra)}")
                if o == "o1":
                    for path, vals in flat(L).items(): by_arm[path].append((arm, frozenset(vals)))
    arms = sorted({pr["A"] for pr in key["pairs"].values()} | {pr["B"] for pr in key["pairs"].values()})
    n = len(key["pairs"])
    for path, seen in by_arm.items():
        cnt = collections.Counter(a for a, _ in seen)
        if any(cnt[a] != n for a in arms):  # a field only one arm's decks carry, every time
            if any(cnt[a] == n for a in arms) and any(cnt[a] == 0 for a in arms):
                bad.append(f"field {path} present only in {[a for a in arms if cnt[a] == n]}")
            continue
        if CONTENT.search(path) or n < 4: continue
        per = {a: {v for x, v in seen if x == a} for a in arms}
        if all(len(v) == 1 for v in per.values()) and len(set().union(*per.values())) == len(arms):
            bad.append(f"field {path} constant per arm and differs between arms: { {a: sorted(next(iter(v))) for a, v in per.items()} }")
    for g in sorted({pr["rep"] for pr in key["pairs"].values()}):
        ps = [pr for pr in key["pairs"].values() if pr["rep"] == g]
        for arm in arms:
            k = sum(pr["A"] == arm for pr in ps)
            if abs(2 * k - len(ps)) > 1: bad.append(f"rep {g}: {arm} is A (first in o1) in {k}/{len(ps)} pairs")
    return bad


def check(a):
    bad = []
    for n in a.name:
        b = leaks(f"{a.ab}/{n}", json.load(open(f"{a.ab}/{n}-key.json"))); bad += b
        print(n, "clean" if not b else f"{len(b)} leaks")
    for b in bad[:40]: print("  ", b)
    sys.exit(1 if bad else 0)


def tally_set(ab, name, models, margin=0):
    S = f"{ab}/{name}"; key = json.load(open(f"{ab}/{name}-key.json"))
    k2 = {p: {"A": pr["A"], "B": pr["B"]} for p, pr in key["pairs"].items()}
    arm = arm_of(key["pairsSpec"][0].split(":")[0]); base = arm_of(key["pairsSpec"][0].split(":")[1])
    out = {"set": name, "brief": key["brief"], "briefSha256": key["briefSha256"], "arm": arm, "base": base,
           "margin": margin, "judges": {}}
    for m in models:
        jm = {}
        for f in FIELDS:
            rows = tload(S, f"verdicts/{m}/*.json", f)
            t = ttally(rows, k2, judges=(m,), need=1)
            pairs_both = sum(1 for p in t["pairs"] if all(f"{m}-{o}" in {r['judge'] for r in rows if r['brief'] == p} for o in ("o1", "o2")))
            aw, bw = t["result"].get(arm, 0), t["result"].get(base, 0)
            side = collections.Counter(r["pick"] if r["pick"] == "same" else ("first" if (r["pick"] == "A") == r["judge"].endswith("o1") else "second") for r in rows)
            jm["overall" if f == "pick" else f] = {"armWins": aw, "baseWins": bw, "tieOrSplit": t["result"].get("tie", 0),
                                                   "pairsJudgedBothOrders": pairs_both, "of": len(key["pairs"]),
                                                   "orderConsistency": t["orderConsistency"], "sidePicks": dict(side),
                                                   "notWorse": bw - aw <= margin}
        out["judges"][m] = jm
    complete = all(v["pairsJudgedBothOrders"] == len(key["pairs"]) for j in out["judges"].values() for v in j.values())
    out["complete"] = complete
    out["rule4NotWorse"] = complete and bool(models) and all(out["judges"][m][d]["notWorse"] for m in models for d in ("look", "teaching"))
    return out


def tally_cmd(a):
    for n in a.name:
        t = tally_set(a.ab, n, a.models.split(","), a.margin)
        json.dump(t, open(f"{a.ab}/{n}-tally.json", "w"), indent=1)
        print(f"{n}: {t['arm']} vs {t['base']}, both orders, brief {t['brief']}, complete={t['complete']}")
        for m, jm in t["judges"].items():
            for d, v in jm.items():
                print(f"  {m:7} {d:12} {t['arm']} {v['armWins']} / {t['base']} {v['baseWins']} / tie {v['tieOrSplit']}"
                      f"  (both orders {v['pairsJudgedBothOrders']}/{v['of']}, order-consistent {v['orderConsistency'][0]}/{v['orderConsistency'][1]},"
                      f" sides {v['sidePicks']}) not worse: {v['notWorse']}")
        print(f"  rule 4 (look and teaching not worse, every judge): {t['rule4NotWorse']}")


def main(argv=None):
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("build", "check", "queue", "tally"):
        s = sub.add_parser(c); s.add_argument("--ab", default=os.environ.get("BAKEOFF_AB"))
        s.add_argument("--name", action="append" if c != "build" else "store", required=True)
        if c == "build": s.add_argument("--pair", action="append", required=True); s.add_argument("--seed", type=int, required=True)
        if c in ("queue", "tally"): s.add_argument("--models", default="opus,sonnet")
        if c == "queue": s.add_argument("--out", required=True)
        if c == "tally": s.add_argument("--margin", type=int, default=0)
    a = ap.parse_args(argv)
    if not a.ab: sys.exit("--ab or $BAKEOFF_AB is required")
    {"build": build, "check": check, "queue": queue, "tally": tally_cmd}[a.cmd](a)


if __name__ == "__main__":
    main()
