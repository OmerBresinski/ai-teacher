"""Blind both-orders tally (J5-C): eval/panel/tally.py generalised, same rule. A side wins a pair only if at least
`need` judges pick it in BOTH orders (o1 first=A, o2 first=B); otherwise the pair is a tie.

usage: tally.py <dir> [--unblind] [--key PATH] [--judges J1,J2,J3] [--need 2] [--field pick] [--glob 'verdicts/J*.json']
With no options it reads and prints exactly what eval/panel/tally.py does (and writes blind-verdicts.json).
blind.py calls tally() once per judge model with judges=[model], need=1 and field in pick/look/teaching/picture_text,
so one fresh agent per order and a win only when both orders agree.
"""
import collections, glob, json, os, sys


def load(D, pattern="verdicts/J*.json", field="pick"):
    rows = []
    for f in sorted(glob.glob(os.path.join(D, pattern))):
        j = json.load(open(f)); jid = j["judge"]; first = "A" if jid.endswith("o1") else "B"; second = "B" if first == "A" else "A"
        for v in j["verdicts"]:
            pick = {"first": first, "second": second}.get(v.get(field), "same")
            rows.append({"judge": jid, "brief": v["brief"], "pick": pick, "why": v.get("why"),
                         "scope": {first: v.get("first_scope"), second: v.get("second_scope")},
                         "weakness": {first: v.get("first_weakness"), second: v.get("second_weakness")}})
    return rows


def tally(rows, key=None, judges=("J1", "J2", "J3"), need=2, echo=False):
    by = collections.defaultdict(dict)
    for r in rows: by[r["brief"]][r["judge"]] = r["pick"]
    res = collections.Counter(); votes = collections.Counter(); oagree = otot = 0; per = {}
    for b, d in by.items():
        name = (lambda x: key[b][x] if key and x in "AB" else x)
        o = {o: collections.Counter(name(d[f"{i}-{o}"]) for i in judges if f"{i}-{o}" in d) for o in ("o1", "o2")}
        win = [s for s in set(o["o1"]) | set(o["o2"]) if s != "same" and o["o1"][s] >= need and o["o2"][s] >= need]
        out = win[0] if win else "tie"; res[out] += 1; per[b] = out
        for v in d.values(): votes[name(v)] += 1
        for i in judges:
            a, c = d.get(f"{i}-o1"), d.get(f"{i}-o2")
            if a and c: otot += 1; oagree += a == c
        if echo: print(b, {k: dict(v) for k, v in o.items()}, "->", out)
    return {"result": dict(res), "votes": dict(votes), "orderConsistency": [oagree, otot], "pairs": per}


if __name__ == "__main__":
    a = sys.argv[1:]; D = os.path.abspath(a[0])
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d
    field = opt("--field", "pick")
    rows = load(D, opt("--glob", "verdicts/J*.json"), field)
    if field == "pick" and "--glob" not in a:
        json.dump(rows, open(D + "/blind-verdicts.json", "w"), indent=1, ensure_ascii=False)
    key = json.load(open(opt("--key", D + "/key.json"))) if "--unblind" in a else None
    t = tally(rows, key, tuple(opt("--judges", "J1,J2,J3").split(",")), int(opt("--need", "2")), echo=True)
    print("result", t["result"], "votes", t["votes"], f"order-consistency {t['orderConsistency'][0]}/{t['orderConsistency'][1]}")
