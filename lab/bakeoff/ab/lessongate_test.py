"""D36 lesson gate: python3 -m pytest lab/bakeoff/ab/lessongate_test.py"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lessongate import eval_dir_for, lesson_gate, run_gate  # noqa: E402


def lesson(root, name, templates, kinds=None, objectives=None, done=True):
    r = root / "ab" / "runs" / "arm-1" / "T" / name; r.mkdir(parents=True)
    kinds = kinds or ["open-response"] * len(templates)
    (r / "lesson.json").write_text(json.dumps({"slides": [{"kind": "title"}, {"kind": "objectives"}] + [{"kind": k} for k in kinds]}))
    (r / "main.json").write_text(json.dumps({"text": json.dumps({"slides": [{"template": t} for t in templates]})}))
    (r / "log.jsonl").write_text('{"ev":"summary"}\n' if done else '{"ev":"start"}\n')
    if objectives is not None:
        e = root / "eval" / "out" / "AB-arm-1" / name; e.mkdir(parents=True)
        (e / "objectives.json").write_text(json.dumps({"version": "bake-objectives.v4", "summary": objectives}))
    return r


TAUGHT_CHECKED = [{"id": "o1", "taught": [3], "checked": [5]}, {"id": "o2", "taught": [4], "checked": []}]


def test_taught_with_hinge_passes_and_soft_score_is_not_a_rule(tmp_path):
    lesson(tmp_path, "a", ["visual-text", "visual-text", "hinge"], objectives=TAUGHT_CHECKED)
    g = run_gate(str(tmp_path / "ab" / "runs" / "arm-1" / "T"))
    assert g["lessons"] == 1 and g["passed"] == 1 and g["objectivesCheckedSoft"] == 0.5


def test_exit_ticket_counts_but_practice_and_discussion_do_not(tmp_path):
    root = tmp_path / "ab" / "runs" / "arm-1" / "T"
    lesson(tmp_path, "exit", ["visual-text", "exit-ticket"], objectives=TAUGHT_CHECKED)
    lesson(tmp_path, "nocheck", ["visual-text", "practice", "question-set", "discussion"], kinds=["diagram", "open-response", "starter", "discussion"], objectives=TAUGHT_CHECKED)
    g = run_gate(str(root))
    assert g["passed"] == 1 and list(g["failed"]) == ["nocheck"] and g["failed"]["nocheck"]["allTaught"]


def test_an_untaught_objective_fails_even_with_a_check(tmp_path):
    lesson(tmp_path, "a", ["visual-text", "hinge"], objectives=[{"id": "o1", "taught": [3], "checked": [4]}, {"id": "o2", "taught": [], "checked": [4]}])
    g = run_gate(str(tmp_path / "ab" / "runs" / "arm-1" / "T"))
    assert g["passed"] == 0 and g["failed"]["a"]["untaught"] == ["o2"] and g["failed"]["a"]["lessonCheck"]


def test_missing_objectives_fails_and_is_listed_unfinished_is_skipped(tmp_path):
    lesson(tmp_path, "noeval", ["hinge"])
    lesson(tmp_path, "stub", ["hinge"], objectives=TAUGHT_CHECKED, done=False)
    g = run_gate(str(tmp_path / "ab" / "runs" / "arm-1" / "T"))
    assert g["lessons"] == 1 and g["missingObjectives"] == ["noeval"] and g["passed"] == 0


def test_misaligned_plan_falls_back_to_the_shipped_kind(tmp_path):
    r = lesson(tmp_path, "a", ["visual-text"], kinds=["diagram", "hinge"], objectives=TAUGHT_CHECKED)
    assert lesson_gate(str(r), str(tmp_path / "eval" / "out" / "AB-arm-1" / "a"))["checkSlides"] == [4]


def test_eval_dir_is_derived_from_a_bakeoff_runs_dir():
    assert eval_dir_for("/x/BAKEOFF/ab/runs/base5-2/T") == "/x/BAKEOFF/eval/out/AB-base5-2"
    assert eval_dir_for("/x/BAKEOFF/ab/complete/base5-2/T") == "/x/BAKEOFF/eval/out/AB-base5-2"


def exit_lesson(root, name, on_slides, questions=("Q1?", "Q2?"), kind=None, objectives=TAUGHT_CHECKED):
    """exit1: writer plan of 3 slides after title and objectives, then the code slide s6."""
    r = lesson(root, name, ["visual-text", "practice", "discussion"], kinds=["diagram", "open-response", "discussion"], objectives=objectives)
    les = json.loads((r / "lesson.json").read_text())
    les["slides"].append({"kind": kind or ("exit-ticket" if on_slides else "explain")})
    les["exitTicket"] = {"questions": list(questions), "onSlides": on_slides, "slide": 6, "template": "exit-ticket" if on_slides else "explain"}
    (r / "lesson.json").write_text(json.dumps(les))
    return r


def test_code_placed_exit_ticket_counts_on_slides_and_on_the_worksheet(tmp_path):
    root = tmp_path / "ab" / "runs" / "arm-1" / "T"
    exit_lesson(tmp_path, "slides", True)
    exit_lesson(tmp_path, "sheet", False)
    g = run_gate(str(root))
    assert g["passed"] == 2, g["failed"]
    assert lesson_gate(str(root / "slides"), None)["checkSlides"] == [6]


def test_code_exit_ticket_needs_2_to_3_questions_and_the_exit_kind_on_slides(tmp_path):
    root = tmp_path / "ab" / "runs" / "arm-1" / "T"
    exit_lesson(tmp_path, "one", True, questions=("Q1?",))
    exit_lesson(tmp_path, "wrongkind", True, kind="discussion")
    g = run_gate(str(root))
    assert g["passed"] == 0 and sorted(g["failed"]) == ["one", "wrongkind"]


def test_code_slide_keeps_the_writer_plan_aligned(tmp_path):
    # The writer's own slides still read by template: discussion at s5 is not a check.
    r = exit_lesson(tmp_path, "a", False, questions=())
    assert lesson_gate(str(r), None)["checkSlides"] == []
