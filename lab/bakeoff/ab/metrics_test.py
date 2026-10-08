"""metrics.py v2 tests, built from the checking audit's real slides (rootcause/checking-audit.json,
metrics F1-F11 and groundTruth). Run: python3 -m unittest lab/bakeoff/ab/metrics_test.py
The last test re-checks the audit's ground truth on the saved runs when they are on disk."""
import json, os, sys, tempfile, unittest, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import metrics as M


def txt(name, s):
    return {"type": "text", "name": name, "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": s}]}]}}


def photo(alt, visible=None, provider="pexels", request=""):
    src = {"provider": provider}
    if visible is not None: src["evidence"] = {"visible": visible}
    return {"type": "image", "name": "Photo", "src": "/files/x.png", "alt": alt, "request": request, "source": src}


def svg(*labels):
    body = "".join(f"<text><tspan>{a}</tspan><tspan>{b}</tspan></text>" if isinstance(l, tuple) else f"<text>{l}</text>" for l in labels for a, b in [l if isinstance(l, tuple) else ("", "")])
    return {"type": "image", "name": "Diagram", "src": "data:image/svg+xml," + urllib.parse.quote(f"<svg>{body}</svg>")}


def slide(*els, kind="content"): return {"kind": kind, "elements": list(els)}
def hits(sl, said=(), vocab=frozenset()): return M.dangling_hits(sl, said, vocab)


class DanglingF1Pronouns(unittest.TestCase):
    def test_pronoun_this_on_text_slides_is_not_dangling(self):
        for s in ["Why might this help?", "Explain this using stores, attention, coding and rehearsal.",
                  "Does this pattern prove that rehearsal is the only route into LTM?",
                  "Evaluate a single STM store using KF, then weigh this against Glanzer and Cunitz.",
                  "gentil = kind\namusant = funny\nUse these for a male person.", "Judge this revision.",
                  "Remembering meaning without much repetition also challenges this account."]:
            self.assertEqual(hits(slide(txt("Lead", s))), [], s)

    def test_deictic_never_runs_across_a_verb(self):  # b3-r2-2 y1 s11, a golden hen photo
        sl = slide(txt("Lead", "What was this hen called when it was young?"), photo("A golden hen", ["adult hen"]))
        self.assertEqual(hits(sl), [])

    def test_deictic_noun_with_nothing_shown_is_dangling(self):  # base5-1 y2 s5, base5-2 y1 s11
        self.assertEqual(len(hits(slide(txt("Heading", "Two parts are not always halves"), txt("Lead", "These two parts are not equal."))) ), 1)
        self.assertEqual(len(hits(slide(txt("Lead", "This female chick grows up.")))), 1)


class DanglingF2Categories(unittest.TestCase):
    def test_category_words_and_verbs_are_not_subjects(self):
        cow = photo("A mother cow and her calf in a field.", ["large adult cow", "small young calf"])
        self.assertEqual(hits(slide(txt("Lead", "Name these animals. Which one is the young animal?"), cow)), [])  # base5-1 y1 s3
        bird = photo("A partly grown female chicken", provider="generated")
        self.assertEqual(hits(slide(txt("Lead", "This young bird is not fully grown."), bird), ["one partly grown female chicken"]), [])  # base4-3 y1 s12
        cake = photo("Two cakes cut into pieces", ["cake pieces"])
        self.assertEqual(hits(slide(txt("Lead", "Spot the changes. Which picture comes first?"), cake)), [])

    def test_a_category_is_checked_through_the_slides_list(self):  # base4-3 y1 s3: one longhorn for four animals
        sl = slide(txt("Lead", "Say each animal’s name."), txt("Point", "cow • sheep"), txt("Point", "hen • dog"),
                   photo("A Texas Longhorn standing in a wide grassy pasture.", ["full-grown cow", "four-legged body"],
                         request="Four separate adult animal photographs in reading order: cow, sheep, hen, dog."))
        h = hits(sl); self.assertEqual(len(h), 1); self.assertIn("sheep", h[0][1]); self.assertNotIn("cow,", h[0][1])

    def test_named_subject_missing_from_the_picture(self):  # b3-r2-2 y1 s4: a calf only, pairs for cow and sheep
        sl = slide(txt("Item", "Which young animal goes with the sheep?"), txt("Instruction", "Point to each pair."),
                   photo("A black and white calf in a field.", ["small calf"], request="a cow with her calf and a sheep with her lamb"))
        self.assertIn("sheep", hits(sl)[0][1])


class DanglingF3TextTasks(unittest.TestCase):
    def test_text_tasks_that_point_at_nothing_shown(self):
        for parts in (["Trace its route through the stores and name each transfer process."],  # base4-4 y12 s7
                      ["Mon ou ma ? / Which one?", "mon père, ma mère"],  # base4-3 y8 s5
                      ["Sketch both gas-volume-time curves.", "Label the axes and curves."],  # base5-1 y11 s12
                      ["Match these on your worksheet."]):  # polish-2 y1 s11
            self.assertEqual(hits(slide(*[txt("Item", p) for p in parts])), [], parts)

    def test_pointing_with_no_visual_is_dangling(self):  # base4-3 y1 s5, polish2-1 y1 s11, b3-r2-2 y1 s12
        self.assertEqual(len(hits(slide(txt("Item", "Point to the cow and its young.")))), 1)
        self.assertEqual(len(hits(slide(txt("Item", "Match each adult to its young."), txt("Item", "Say your answers.")))), 1)
        self.assertEqual(len(hits(slide(txt("Item", "Name each adult animal."), txt("Item", "Find all four pairs on your own.")))), 1)


class DanglingF6Verdicts(unittest.TestCase):
    REQ = ("three separated photographs in a horizontal row, with an adult hen on the left, a newly hatched female chick "
           "in the middle and a partly feathered growing female chicken on the right")

    def gen(self): return photo("An adult hen, fully feathered and clearly larger than a chick.", provider="generated", request=self.REQ)

    def test_the_request_is_never_counted_as_shown(self):
        bag = M.shows_bag(slide(self.gen()), ["The photo shows exactly three fully feathered adult hens."])
        self.assertNotIn("chick", bag); self.assertIn("hen", bag)

    def test_pictures_that_miss_the_requested_subjects(self):  # base5-1 y1 s11: three adult hens for a growth sequence
        sl = slide(txt("Item", "Which picture comes first?"), txt("Instruction", "Point to the pictures."), self.gen())
        h = hits(sl, ["The photo shows exactly three fully feathered adult hens, clearly visible."], M.bag_of("hen chick chicken eggs"))
        self.assertEqual(len(h), 2); self.assertIn("chick", h[0][1])


class TeachingAndTextOnlyF4F5(unittest.TestCase):
    def lesson(self, d, slides, plan, checks=None, geom=None):
        def put(name, obj):
            with open(f"{d}/{name}", "w") as f: json.dump(obj, f)
        put("lesson.json", {"slides": slides}); put("main.json", {"text": json.dumps({"slides": plan})})
        if checks is not None: put("checks.json", {"summary": checks})
        if geom is not None: put("geom.json", {"summary": geom})

    def test_item_steps_do_not_drop_a_worked_example(self):  # base4-3 y12 s5 'Worked example: a door code'
        with tempfile.TemporaryDirectory() as t:
            d = f"{t}/T/y12"; os.makedirs(d)
            self.lesson(d, [slide(), slide(), slide(txt("Heading", "Worked example"), txt("Item", "Step 1"), kind="worked-example"),
                            slide(txt("Lead", "Why?"), kind="discussion"), slide(txt("Lead", "x"), photo("a cow", ["cow"]))],
                        [{"template": "steps"}, {"template": "discussion"}, {"template": "visual-text"}])
            m = M.run_metrics(f"{t}/T")
            self.assertEqual((m["teach"], m["textOnlyTeach"], m["visualShownTeach"]), (2, 1, 1))
            self.assertEqual(m["textOnlyShare"], round(1 - m["visualShown"], 3))
            self.assertNotIn("lookUnmet", m); self.assertNotIn("lookVisual", m)  # F11

    def test_harness_text_only_list_wins(self):
        with tempfile.TemporaryDirectory() as t:
            d = f"{t}/T/y1"; os.makedirs(d)
            self.lesson(d, [slide(), slide(), slide(txt("Lead", "a")), slide(txt("Lead", "b"))],
                        [{"template": "explain"}, {"template": "explain"}], checks={"textOnlySlides": [3]})
            m = M.run_metrics(f"{t}/T"); self.assertEqual((m["teach"], m["textOnlyTeach"], m["harnessDisagree"]), (1, 1, 1))

    def test_overflow_counts_overlaps_and_clipping(self):  # F7: b4-ex-2 y5 s5, base2-1 y12 s9
        with tempfile.TemporaryDirectory() as t:
            d = f"{t}/T/y5"; os.makedirs(d)
            self.lesson(d, [slide()] * 2 + [slide(txt("Lead", "x"))] * 8, [{"template": "explain"}] * 8,
                        geom={"overflow": [], "offCanvas": [], "overlaps": [5], "clipping": ['s9 diagram label "Recall probability" cut 9px']})
            m = M.run_metrics(f"{t}/T")
            self.assertEqual(m["shippedOverflow"], 2); self.assertEqual(m["shippedOverflowKinds"], {"overlaps": 1, "clipping": 1})

    def test_labels_dropped_on_the_shipped_slide(self):  # F8: polish2-2 y8 s3; base5-2 y8 s3 tree moved into text
        labels = ["mon père / my father", "ma mère / my mother", "ma sœur / my sister"]
        with tempfile.TemporaryDirectory() as t:
            for name, els in (("tree", [svg(("mon père", "my father"))]), ("text", [txt("Point", "ma mère: my mother; ma sœur, my sister; mon père, my father")])):
                d = f"{t}/{name}/T/y8"; os.makedirs(d)
                self.lesson(d, [slide(), slide(), slide(*els)], [{"template": "visual-text", "figure": {"kind": "labelled-diagram", "labels": labels}}])
            a = M.run_metrics(f"{t}/tree/T"); b = M.run_metrics(f"{t}/text/T")
            self.assertEqual([x["label"] for x in a["labelsDroppedList"]], labels[1:])
            self.assertEqual((b["labelsDropped"], b["labelsLost"]), (3, 0))


class GateF9AndRecallF10(unittest.TestCase):
    def test_pass_is_per_rep_never_on_a_mean(self):  # b4-ex: 0.786 and 0.844, mean 0.815
        g = M.gate({"b4-ex-1": {"visualShown": 0.786}, "b4-ex-2": {"visualShown": 0.844}}, {"visualShown": [0.79, 0.90]})
        self.assertFalse(g["armPass"]); self.assertFalse(g["reps"]["b4-ex-1"]["pass_"]); self.assertTrue(g["reps"]["b4-ex-2"]["pass_"])

    def test_recall_by_meaning(self):
        for s, want in (("My family\nRappelle-toi : dis « My name is… » et « I am 12 years old »", True), ("Name the animals you know.", True),
                        ("Are these strawberries shared equally?", True), ("Recall: what do encoding, storage and retrieval mean?", True),
                        ("Year 1 Science", False), ("Year 8 French", False)):
            self.assertEqual(bool(M.RECALL.search(s)), want, s)


RUNS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../../quality-prd/lab/rounds/BAKEOFF/ab/runs")


@unittest.skipUnless(os.path.isdir(f"{RUNS}/base5-1/T"), "saved runs not on disk")
class GroundTruth(unittest.TestCase):
    """The audit's annotated slides (base5-1 and base4-3, 12 lessons): dangling and text-only exact."""
    DANGLING = {("base5-1", "y1", 5), ("base5-1", "y1", 7), ("base5-1", "y1", 11), ("base5-1", "y2", 5), ("base4-3", "y1", 3), ("base4-3", "y1", 5)}
    TEXT = {("base5-1", "y1", 8), ("base5-1", "y2", 5), ("base5-1", "y8", 4), ("base5-1", "y8", 10), ("base5-1", "y11", 5), ("base5-1", "y12", 5),
            ("base5-1", "y12", 6), ("base5-1", "y12", 8), ("base4-3", "y8", 5), ("base4-3", "y11", 5), ("base4-3", "y12", 4), ("base4-3", "y12", 5), ("base4-3", "y12", 7)}

    def test_dangling_and_text_only_match_the_annotators(self):
        D, T = set(), set()
        for run in ("base5-1", "base4-3"):
            for les in os.listdir(f"{RUNS}/{run}/T"):
                L = M.lesson_measures(f"{RUNS}/{run}/T/{les}")
                for n, m in (L or {"slides": {}})["slides"].items():
                    if m["danglingSlide"]: D.add((run, les.split("-")[0], n))
                    if m["textOnlyTeach"]: T.add((run, les.split("-")[0], n))
        self.assertEqual(D, self.DANGLING); self.assertEqual(T, self.TEXT)


if __name__ == "__main__":
    unittest.main()
