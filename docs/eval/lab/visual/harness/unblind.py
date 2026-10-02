#!/usr/bin/env python3
"""Unblind visual judgments: python3 harness/unblind.py [packetId...]
Reads judgments/<packet>-pass-*.json and packets/_keys/<packet>.json, prints per pass which deck
(ours / chalkie) was preferred, and the per-criterion scores for each side."""
import glob, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ids = sys.argv[1:] or sorted({os.path.basename(f).rsplit("-pass-", 1)[0] for f in glob.glob(f"{ROOT}/judgments/*-pass-*.json")})
for pid in ids:
    key = json.load(open(f"{ROOT}/packets/_keys/{pid}.json"))
    side = {key["ours"]: "ours", key["chalkie"]: "chalkie"}
    for f in sorted(glob.glob(f"{ROOT}/judgments/{pid}-pass-*.json")):
        j = json.load(open(f))
        who = {"deck1": side[j["deck1"]], "deck2": side[j["deck2"]]}
        pref = "tie" if j["prefer"] == "tie" else who[j["prefer"]]
        sc = {who[d]: j["scores"][d] for d in ("deck1", "deck2")}
        print(f"{pid} pass {j['pass']}: prefers {pref} ({j.get('strength')}); ours {sc['ours']} chalkie {sc['chalkie']}")
