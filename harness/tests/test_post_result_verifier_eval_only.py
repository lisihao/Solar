import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS_DIR = REPO_ROOT / "harness"
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from completion_pipeline import OperatorResult, submit_result  # noqa: E402


def test_completion_pipeline_accepts_eval_only_result(tmp_path):
    eval_json = tmp_path / "eval.json"
    eval_json.write_text('{"verdict":"PASS"}\n', encoding="utf-8")

    result = submit_result(
        OperatorResult(
            session_id="sess-eval",
            node_id="E1",
            attempt_id="a1",
            eval_path=str(eval_json),
            run_dir=str(tmp_path / "run"),
        ),
        harness_dir=tmp_path,
    )

    assert result["status"] == "completed"
    rules = {rule["id"]: rule for rule in result["verdict"]["rules"]}
    assert rules["solar.post_result.handoff_exists"]["status"] == "passed"
    assert rules["solar.post_result.handoff_exists"]["severity"] == "warn"
    assert rules["solar.post_result.eval_artifact_exists"]["status"] == "passed"
