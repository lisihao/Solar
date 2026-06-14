"""test_actor_runtime_capability.py — U8: actor_runtime.submit policy deny paths.

Sprint: sprint-20260530-p0-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s03-core-runtime
Node: B7_unit_tests — U8
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from actor_runtime import ActorRuntime
from capability_token import CapabilityToken

TMP_SOLAR_ALLOWED = str(Path("/tmp/solar-allowed").resolve())
TMP_TARGET = str(Path("/tmp/target").resolve())


def _make_runtime(tmp_root: Path) -> ActorRuntime:
    profile_path = tmp_root / "config" / "agent-actors.json"
    profile_path.parent.mkdir(parents=True, exist_ok=True)
    profile_path.write_text(
        json.dumps(
            {
                "actors": {
                    "test-actor": {
                        "actor_id": "test-actor",
                        "capability_profile": {},
                        "risk_profile": {},
                        "cost_profile": {},
                    }
                }
            }
        )
    )
    return ActorRuntime(
        harness_dir=tmp_root,
        mailbox_base=tmp_root / "actors",
        profiles_path=profile_path,
    )


def _token_allow_write(path: str = TMP_SOLAR_ALLOWED) -> CapabilityToken:
    path = str(Path(path).resolve())
    return CapabilityToken(
        token_id="tok-u8-allow",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="actor-u8",
        file_scope={"write_paths": [path]},
    )


def _token_deny_all() -> CapabilityToken:
    return CapabilityToken(
        token_id="tok-u8-deny",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="actor-u8",
        file_scope={},
        shell_scope={},
        network={},
        git={},
        secrets={},
    )


def test_u8_submit_denied_out_of_scope_file(tmp_path: Path):
    """U8a — file write outside write_paths should fail capability_denied."""
    rt = _make_runtime(tmp_path)
    token = _token_allow_write(TMP_SOLAR_ALLOWED)

    result = rt.submit(
        {
            "task_id": "u8-deny-file",
            "policy_requests": [
                {"kind": "file", "op": "write", "path": "/etc/passwd"},
            ],
        },
        actor_id="test-actor",
        capability_token=token,
    )

    assert not result.success
    assert (result.error or "").startswith("capability_denied:")
    assert (result.error or "").endswith("out_of_scope")
    assert len(result.policy_decisions) == 1
    assert result.policy_decisions[0]["kind"] == "file"
    assert result.policy_decisions[0]["allowed"] is False
    assert result.policy_decisions[0]["reason"] == "out_of_scope"


def test_u8_submit_denied_shell_deny_by_default(tmp_path: Path):
    """U8b — shell request with empty shell_scope should be denied."""
    rt = _make_runtime(tmp_path)
    token = _token_deny_all()

    result = rt.submit(
        {
            "task_id": "u8-deny-shell",
            "policy_requests": [
                {"kind": "shell", "command": "rm", "argv": ["-rf", TMP_TARGET]},
            ],
        },
        actor_id="test-actor",
        capability_token=token,
    )

    assert not result.success
    assert (result.error or "").startswith("capability_denied:")
    assert len(result.policy_decisions) == 1
    assert result.policy_decisions[0]["kind"] == "shell"
    assert result.policy_decisions[0]["allowed"] is False


def test_u8_submit_allowed_policy_request(tmp_path: Path):
    """U8c — allowed policy request keeps submit success and records decision."""
    rt = _make_runtime(tmp_path)
    token = _token_allow_write(TMP_SOLAR_ALLOWED)

    result = rt.submit(
        {
            "task_id": "u8-allow-file",
            "policy_requests": [
                {"kind": "file", "op": "write", "path": f"{TMP_SOLAR_ALLOWED}/output.json"},
            ],
        },
        actor_id="test-actor",
        capability_token=token,
    )

    assert result.success
    assert len(result.policy_decisions) == 1
    assert result.policy_decisions[0]["kind"] == "file"
    assert result.policy_decisions[0]["allowed"] is True


def test_u8_submit_first_passes_second_fails(tmp_path: Path):
    """U8d — first request allowed, second denied keeps both decisions."""
    rt = _make_runtime(tmp_path)
    token = _token_allow_write(TMP_SOLAR_ALLOWED)

    result = rt.submit(
        {
            "task_id": "u8-mixed",
            "policy_requests": [
                {"kind": "file", "op": "write", "path": f"{TMP_SOLAR_ALLOWED}/ok.txt"},
                {"kind": "file", "op": "write", "path": "/etc/hostname"},
            ],
        },
        actor_id="test-actor",
        capability_token=token,
    )

    assert not result.success
    assert (result.error or "").startswith("capability_denied:")
    assert len(result.policy_decisions) == 2
    assert result.policy_decisions[0]["allowed"] is True
    assert result.policy_decisions[1]["allowed"] is False
    assert result.policy_decisions[1]["reason"] == "out_of_scope"


def test_u8_enforcement_off_bypasses_deny(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """U8e — SOLAR_CAPABILITY_ENFORCEMENT=off should bypass a deny."""
    monkeypatch.setenv("SOLAR_CAPABILITY_ENFORCEMENT", "off")
    rt = _make_runtime(tmp_path)
    token = _token_deny_all()

    result = rt.submit(
        {
            "task_id": "u8-enforcement-off",
            "policy_requests": [
                {"kind": "file", "op": "write", "path": "/etc/forbidden"},
            ],
        },
        actor_id="test-actor",
        capability_token=token,
    )

    assert result.success
    assert len(result.policy_decisions) == 1
    assert result.policy_decisions[0]["allowed"] is False
    assert result.policy_decisions[0].get("bypass") == "enforcement_off"


def test_u8_no_policy_requests_passes(tmp_path: Path):
    """U8f — no policy_requests should skip policy checks."""
    rt = _make_runtime(tmp_path)
    token = _token_deny_all()

    result = rt.submit(
        {"task_id": "u8-no-requests", "objective": "normal task"},
        actor_id="test-actor",
        capability_token=token,
    )

    assert result.success
    assert result.policy_decisions == []


def test_u8_expired_token_rejected(tmp_path: Path):
    """U8g — expired token rejects before policy checks."""
    rt = _make_runtime(tmp_path)
    expired = CapabilityToken(
        token_id="tok-expired",
        scopes=["file:write"],
        expires_at="2020-01-01T00:00:00Z",
        actor_id="actor-u8",
    )

    result = rt.submit(
        {
            "task_id": "u8-expired",
            "policy_requests": [{"kind": "file", "op": "read", "path": f"{TMP_SOLAR_ALLOWED}/x"}],
        },
        actor_id="test-actor",
        capability_token=expired,
    )

    assert not result.success
    assert (result.error or "").startswith("capability_token_invalid")


def test_u8_no_token_with_policy_requests_is_allowed(tmp_path: Path):
    """U8h — legacy path keeps no-capability-token flow open."""
    rt = _make_runtime(tmp_path)

    result = rt.submit(
        {
            "task_id": "u8-no-token",
            "policy_requests": [{"kind": "file", "op": "write", "path": "/etc/passwd"}],
        },
        actor_id="test-actor",
        capability_token=None,
    )

    assert result.success
