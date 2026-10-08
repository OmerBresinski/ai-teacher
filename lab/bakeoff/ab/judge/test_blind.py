"""python3 -m unittest lab/bakeoff/ab/judge/test_blind.py — synthetic runs, no network, no real decks."""
import json, os, sys, tempfile, unittest

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blind  # noqa: E402

BRIEFS = [f"y{i}-topic" for i in range(1, 7)]


def lesson(run, b, hour):
    return {"version": 1, "id": f"{run}-{b}", "title": b, "themeId": "splash", "fitVersion": 3, "subject": "Science",
            "yearGroup": "Year 1", "createdAt": f"2026-10-08T{hour}:15:00.000Z", "updatedAt": f"2026-10-08T{hour}:16:00.000Z",
            "bakeoff": {"arm": run},
            "slides": [{"id": "s1", "kind": "content", "notes": f"Say the {b} words.", "elements": [
                {"id": "AbC123xyz0", "type": "text", "name": "Heading", "x": 1, "y": 2, "w": 3, "h": 4,
                 "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": b}]}]}},
                {"id": "Zz9", "type": "image", "name": "Photo", "x": 1, "y": 2, "w": 3, "h": 4, "alt": "a hen",
                 "src": "/files/0b0b0000-0000-4000-8000-00000000ba4c/bank/01a117d5-3f10-7163-a4c3-aae407c56225.bin",
                 "request": "a hen", "source": {"provider": "pexels", "photographer": "P", "evidence": {"promptVersion": "pick.v17"}}}]}]}


class Blind(unittest.TestCase):
    def setUp(self):
        self.ab = tempfile.mkdtemp()
        for run, hour in (("arm-1", "15"), ("arm-2", "15"), ("base-3", "12"), ("base-4", "12")):
            for b in BRIEFS:
                os.makedirs(f"{self.ab}/runs/{run}/T/{b}"); os.makedirs(f"{self.ab}/share/{run}", exist_ok=True)
                json.dump(lesson(run, b, hour), open(f"{self.ab}/runs/{run}/T/{b}/lesson.json", "w"))
                im = Image.new("RGB", (40, 30), (200, 10 * len(run), 3)); exif = Image.Exif(); exif[0x0132] = "2026:10:08 12:15:00"
                im.save(f"{self.ab}/share/{run}/{b}.jpg", exif=exif)
        blind.main(["build", "--ab", self.ab, "--name", "S", "--pair", "arm-1:base-3", "--pair", "arm-2:base-4", "--seed", "7"])
        self.key = json.load(open(f"{self.ab}/S-key.json"))

    def test_counterbalanced_and_both_orders(self):
        for rep in (1, 2):
            ps = [p for p in self.key["pairs"].values() if p["rep"] == rep]
            self.assertEqual(sum(p["A"] == "arm" for p in ps), 3)
        self.assertEqual(len(os.listdir(f"{self.ab}/S/packets")), 24)
        p = next(iter(self.key["pairs"]))
        x1 = open(f"{self.ab}/S/packets/{p}-o1/X.jpg", "rb").read(); y2 = open(f"{self.ab}/S/packets/{p}-o2/Y.jpg", "rb").read()
        self.assertEqual(x1, y2)

    def test_no_leaks_after_cleaning(self):
        self.assertEqual(blind.leaks(f"{self.ab}/S", self.key), [])
        X = json.load(open(f"{self.ab}/S/packets/q01-o1/X.json"))
        self.assertNotIn("createdAt", X); self.assertNotIn("bakeoff", X)
        img = X["slides"][0]["elements"][1]
        self.assertEqual(img["src"], "picture-1"); self.assertNotIn("source", img); self.assertNotIn("request", img)
        self.assertEqual(img["id"], "s1e2")

    def test_leak_test_catches_arm_correlated_field(self):
        for p, pr in self.key["pairs"].items():
            for o, side in (("o1", "X" if pr["A"] == "arm" else "Y"), ("o2", "Y" if pr["A"] == "arm" else "X")):
                f = f"{self.ab}/S/packets/{p}-{o}/{side}.json"; L = json.load(open(f)); L["engine"] = "v9"
                json.dump(L, open(f, "w"))
        bad = blind.leaks(f"{self.ab}/S", self.key)
        self.assertTrue(any("engine" in b for b in bad), bad)

    def test_leak_test_catches_timestamp_and_constant_value(self):
        for p, pr in self.key["pairs"].items():
            f = f"{self.ab}/S/packets/{p}-o1/X.json"; L = json.load(open(f))
            L["themeId"] = "chalk" if pr["A"] == "arm" else "crayon"; L["note"] = "made 2026-10-08T12:15"
            json.dump(L, open(f, "w"))
            f = f"{self.ab}/S/packets/{p}-o1/Y.json"; L = json.load(open(f))
            L["themeId"] = "crayon" if pr["A"] == "arm" else "chalk"; json.dump(L, open(f, "w"))
        bad = blind.leaks(f"{self.ab}/S", self.key)
        self.assertTrue(any("timestamp" in b for b in bad)); self.assertTrue(any(".themeId" in b for b in bad), bad)

    def test_tally_needs_both_orders(self):
        jobs = blind.briefs_for(type("A", (), {"ab": self.ab})(), "S", ["opus"])
        self.assertEqual(len(jobs), 24)
        for j in jobs:  # judge always picks the FIRST deck (pure side bias): every pair must end a tie
            v = {"brief": j["pair"], "pick": "first", "look": "first", "teaching": "second", "picture_text": "same"}
            json.dump({"judge": f"opus-{j['order']}", "verdicts": [v]}, open(j["outfile"], "w"))
        t = blind.tally_set(self.ab, "S", ["opus"])
        self.assertTrue(t["complete"])
        for d in ("overall", "look", "teaching", "picture_text"):
            self.assertEqual((t["judges"]["opus"][d]["armWins"], t["judges"]["opus"][d]["baseWins"]), (0, 0))
        self.assertTrue(t["rule4NotWorse"])
        for j in jobs:  # now the judge prefers the base deck in both orders on look
            k = self.key["pairs"][j["pair"]]; first = k["A"] if j["order"] == "o1" else k["B"]
            v = {"brief": j["pair"], "pick": "same", "look": "first" if first == "base" else "second", "teaching": "same", "picture_text": "same"}
            json.dump({"judge": f"opus-{j['order']}", "verdicts": [v]}, open(j["outfile"], "w"))
        t = blind.tally_set(self.ab, "S", ["opus"])
        self.assertEqual(t["judges"]["opus"]["look"]["baseWins"], 12); self.assertFalse(t["rule4NotWorse"])


if __name__ == "__main__":
    unittest.main()
