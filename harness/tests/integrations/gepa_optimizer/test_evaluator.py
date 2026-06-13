"""SubprocessEvaluator sandbox tests."""

from __future__ import annotations

import json
import os
import sys
import textwrap
from pathlib import Path

import pytest

from integrations.gepa_optimizer.evaluator import (
    EvaluatorError,
    EvaluatorResult,
    SubprocessEvaluator,
)


def _write_script(tmp_path: Path, body: str) -> Path:
    p = tmp_path / f"evaluator_{abs(hash(body)) & 0xFFFFFF:06x}.py"
    p.write_text(body)
    return p


def test_constructor_rejects_missing_script(tmp_path):
    with pytest.raises(EvaluatorError):
        SubprocessEvaluator(tmp_path / "no-such-file.py")


def test_constructor_rejects_nonpositive_timeout(tmp_path):
    p = _write_script(tmp_path, "import sys; sys.exit(0)")
    with pytest.raises(EvaluatorError):
        SubprocessEvaluator(p, timeout=0)


def test_happy_path_returns_score(tmp_path):
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import json, sys
            data = json.load(sys.stdin)
            print(json.dumps({"score": len(data["candidate"]) / 100.0, "info": "ok"}))
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=10.0)
    result = ev("hello world")
    assert isinstance(result, EvaluatorResult)
    assert result.ok is True
    assert result.score == pytest.approx(0.11)
    assert result.metadata.get("info") == "ok"


def test_timeout_returns_structured_failure(tmp_path):
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import time, sys, json
            json.load(sys.stdin)
            time.sleep(5)
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=0.5)
    result = ev("anything")
    assert result.ok is False
    assert result.timed_out is True
    assert "timed out" in (result.error or "").lower()


def test_exception_returns_structured_failure(tmp_path):
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import sys, json
            json.load(sys.stdin)
            raise RuntimeError("intentional boom")
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=5.0)
    result = ev("anything")
    assert result.ok is False
    assert result.exit_code is not None and result.exit_code != 0


def test_secret_env_not_forwarded(tmp_path, monkeypatch):
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import os, sys, json
            json.load(sys.stdin)
            print(json.dumps({
                "score": 1.0,
                "leaked_token": os.environ.get("MY_TEST_API_KEY"),
                "kept_path": bool(os.environ.get("PATH")),
            }))
            """
        ),
    )
    monkeypatch.setenv("MY_TEST_API_KEY", "sk-supersecret-should-not-leak")
    ev = SubprocessEvaluator(script, timeout=5.0)
    result = ev("hello")
    assert result.ok is True
    assert result.metadata.get("leaked_token") in (None, "")
    assert result.metadata.get("kept_path") is True


def test_application_level_error_in_json(tmp_path):
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import sys, json
            json.load(sys.stdin)
            print(json.dumps({"error": "bad candidate format"}))
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=5.0)
    result = ev("anything")
    assert result.ok is False
    assert "bad candidate format" in (result.error or "")


# ---------------------------------------------------------------------------
# B5: return_mode='structured' tests
# ---------------------------------------------------------------------------


def test_structured_mode_returns_asi_payload(tmp_path):
    """structured mode: subprocess returns {score, asi_payload} → result.asi_payload populated."""
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import json, sys
            data = json.load(sys.stdin)
            print(json.dumps({
                "score": 0.85,
                "asi_payload": {
                    "verifier_decision": "pass",
                    "evidence_completeness": 0.73,
                },
            }))
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=10.0, return_mode="structured")
    result = ev("test candidate")
    assert result.ok is True
    assert result.score == pytest.approx(0.85)
    assert result.asi_payload is not None
    assert result.asi_payload["verifier_decision"] == "pass"
    assert result.asi_payload["evidence_completeness"] == pytest.approx(0.73)


def test_scalar_mode_asi_payload_is_none(tmp_path):
    """scalar mode (default): asi_payload is always None even if subprocess sends it."""
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import json, sys
            json.load(sys.stdin)
            print(json.dumps({"score": 0.9, "asi_payload": {"x": 1}}))
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=10.0)
    result = ev("test candidate")
    assert result.ok is True
    assert result.asi_payload is None


def test_structured_mode_no_asi_payload_in_output(tmp_path):
    """structured mode: subprocess omits asi_payload → result.asi_payload is None."""
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import json, sys
            json.load(sys.stdin)
            print(json.dumps({"score": 0.5}))
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=10.0, return_mode="structured")
    result = ev("test candidate")
    assert result.ok is True
    assert result.score == pytest.approx(0.5)
    assert result.asi_payload is None


def test_structured_mode_crash_returns_ok_false_asi_payload_none(tmp_path):
    """structured mode: subprocess crashes → ok=False, asi_payload=None."""
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import sys, json
            json.load(sys.stdin)
            raise RuntimeError("intentional crash")
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=10.0, return_mode="structured")
    result = ev("test candidate")
    assert result.ok is False
    assert result.asi_payload is None
    assert result.exit_code is not None and result.exit_code != 0


def test_structured_mode_timeout_returns_ok_false_asi_payload_none(tmp_path):
    """structured mode: subprocess times out → ok=False, asi_payload=None."""
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import time, sys, json
            json.load(sys.stdin)
            time.sleep(5)
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=0.5, return_mode="structured")
    result = ev("test candidate")
    assert result.ok is False
    assert result.asi_payload is None
    assert result.timed_out is True


def test_structured_mode_application_error_returns_ok_false(tmp_path):
    """structured mode: subprocess returns {error} → ok=False, asi_payload=None."""
    script = _write_script(
        tmp_path,
        textwrap.dedent(
            """
            import sys, json
            json.load(sys.stdin)
            print(json.dumps({"error": "evaluation failed"}))
            """
        ),
    )
    ev = SubprocessEvaluator(script, timeout=10.0, return_mode="structured")
    result = ev("test candidate")
    assert result.ok is False
    assert result.asi_payload is None
    assert "evaluation failed" in (result.error or "")
