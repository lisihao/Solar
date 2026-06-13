"""Tests for capability_token.py — Token validation and path enforcement."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from capability_token import CapabilityToken, PolicyDecision

def test_valid_token():
    t = CapabilityToken("t1", ["file:write", "shell:run"], "2099-01-01T00:00:00Z", "a1")
    v = t.validate_for_lease()
    assert v["valid"]
    assert t.has_scope("file:write")
    assert not t.has_scope("network:full")
    print("PASS: valid_token")

def test_expired_token():
    t = CapabilityToken("t1", ["file:write"], "2020-01-01T00:00:00Z", "a1")
    v = t.validate_for_lease()
    assert not v["valid"]
    assert "token_expired" in v["issues"]
    print("PASS: expired_token")

def test_allow_path():
    t = CapabilityToken("t1", ["file:write"], "2099-01-01T00:00:00Z", "a1",
                        allow_paths=["${HARNESS_DIR}"])
    r = t.check_path_access("${HARNESS_DIR}/lib/test.py")
    assert r["allowed"]
    r2 = t.check_path_access("/etc/passwd")
    assert not r2["allowed"]
    print("PASS: allow_path")

def test_deny_path():
    t = CapabilityToken("t1", ["file:write"], "2099-01-01T00:00:00Z", "a1",
                        deny_paths=["/etc", "/var"])
    r = t.check_path_access("/etc/shadow")
    assert not r["allowed"]
    r2 = t.check_path_access("/home/user/file.txt")
    assert r2["allowed"]
    print("PASS: deny_path")

def _policy_token(**overrides):
    data = {
        "token_id": "raw-token-secret-value",
        "scopes": ["file:write", "shell:run", "network:http", "git:push", "secrets:read"],
        "expires_at": "2099-01-01T00:00:00Z",
        "actor_id": "actor-b2",
        "task_id": "task-b2",
        "file_scope": {"write_paths": ["/tmp/solar-allowed"]},
        "shell_scope": {"allowed": True, "mode": "denylist", "denied_commands": ["git push"]},
        "network": {"allowed": True, "allow_domains": ["*.solar.local"]},
        "git": {"commit_allowed": True, "push_allowed": False, "allowed_remotes": ["origin"]},
        "secrets": {"allowed": True, "allowed_secret_refs": ["PROD_*"]},
    }
    data.update(overrides)
    return CapabilityToken(**data)

def _assert_policy_decision(decision):
    assert isinstance(decision, PolicyDecision)
    assert "token_id_short" in decision.audit
    assert decision.audit["token_id_short"] != "raw-token-secret-value"
    assert decision.audit["actor_id"] == "actor-b2"
    assert decision.audit["task_id"] == "task-b2"

def test_policy_file_shell_network_git_reason_codes():
    t = _policy_token()

    out_of_scope = t.check_file("write", "/tmp/outside/file.txt")
    _assert_policy_decision(out_of_scope)
    assert not out_of_scope.allowed
    assert out_of_scope.reason == "out_of_scope"

    denied_shell = t.check_shell("git", ["push", "origin", "main"])
    _assert_policy_decision(denied_shell)
    assert not denied_shell.allowed
    assert denied_shell.reason == "denied_command"
    assert denied_shell.audit["command"] == "git"
    assert denied_shell.audit["argv_head"] == "push"

    allowed_network = t.check_network("http", "api.solar.local", 443)
    _assert_policy_decision(allowed_network)
    assert allowed_network.allowed

    denied_network = t.check_network("http", "example.com", 443)
    _assert_policy_decision(denied_network)
    assert not denied_network.allowed
    assert denied_network.reason == "deny_by_default"

    denied_push = t.check_git("push", "origin")
    _assert_policy_decision(denied_push)
    assert not denied_push.allowed
    assert denied_push.reason == "push_not_allowed"
    assert "remote" not in denied_push.audit

def test_missing_runtime_scopes_deny_by_default():
    t = _policy_token(
        file_scope={},
        shell_scope={},
        network={},
        git={},
        secrets={},
    )

    assert t.check_file("write", "/tmp/solar-allowed/file.txt").reason == "deny_by_default"
    assert t.check_shell("python3", ["-m", "pytest"]).reason == "deny_by_default"
    assert t.check_network("http", "api.solar.local", 443).reason == "deny_by_default"
    assert t.check_git("push", "origin").reason == "deny_by_default"
    assert t.check_secrets("PROD_SECRET_BODY").reason == "deny_by_default"

def test_policy_secret_and_audit_allowlist_redaction():
    t = _policy_token()

    allowed_secret = t.check_secrets("PROD_SECRET_BODY")
    _assert_policy_decision(allowed_secret)
    assert allowed_secret.allowed
    assert "ref" not in allowed_secret.audit
    assert "PROD_SECRET_BODY" not in str(allowed_secret.audit)

    denied_secret = t.check_secrets("DEV_SECRET_BODY")
    _assert_policy_decision(denied_secret)
    assert not denied_secret.allowed
    assert denied_secret.reason == "secret_not_listed"
    assert "ref" not in denied_secret.audit
    assert "DEV_SECRET_BODY" not in str(denied_secret.audit)

    audit = t.audit_view()
    assert audit["token_id_short"] != "raw-token-secret-value"
    assert "token_id" not in audit
    assert "expires_at" not in audit
    assert "secrets" not in audit
    assert audit["scope_summary"]["secrets"] is True

if __name__ == "__main__":
    test_valid_token()
    test_expired_token()
    test_allow_path()
    test_deny_path()
    test_policy_file_shell_network_git_reason_codes()
    test_missing_runtime_scopes_deny_by_default()
    test_policy_secret_and_audit_allowlist_redaction()
    print("\n7/7 passed")
